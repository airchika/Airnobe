import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { cloneReaderSettings, DEFAULT_READER_APPEARANCE, parseReaderAppearance, type ReaderAppearance, type ReaderSettings } from "./reader-settings.js";
import { useSpatialNavigation } from "./spatial-navigation.js";
import { BUILTIN_THEME_IDS, parseThemeDefinition, type ThemeDefinition } from "./themes.js";
import type { AvailableTheme } from "./theme-client.js";

interface SettingsPanelProps {
  settings: ReaderSettings;
  themes: AvailableTheme[];
  onPreview(settings: ReaderSettings): void;
  onSave(settings: ReaderSettings): Promise<void>;
  onImport(theme: ThemeDefinition): Promise<AvailableTheme>;
  onThemesChange(themes: AvailableTheme[]): void;
  onClose(): void;
}

type NumberKey = keyof ReaderAppearance["typography"];
const NUMBER_FIELDS: Array<{ key: NumberKey; label: string; min: number; max: number; step: number; suffix: string }> = [
  { key: "fontSize", label: "字号", min: 14, max: 30, step: 1, suffix: "px" },
  { key: "lineHeight", label: "行距", min: 1.75, max: 2.6, step: 0.05, suffix: "" },
  { key: "columnWidth", label: "栏宽", min: 520, max: 1200, step: 10, suffix: "px" },
  { key: "japaneseOpacity", label: "日文透明度", min: 0.2, max: 1, step: 0.05, suffix: "" },
];

function typographyInputs(appearance: ReaderAppearance): Record<NumberKey, string> {
  return Object.fromEntries(NUMBER_FIELDS.map(({ key }) => [key, String(appearance.typography[key])])) as Record<NumberKey, string>;
}

export function SettingsPanel({ settings, themes, onPreview, onSave, onImport, onThemesChange, onClose }: SettingsPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const persistedRef = useRef(cloneReaderSettings(settings));
  const draftRef = useRef(cloneReaderSettings(settings));
  const timerRef = useRef<number | undefined>(undefined);
  const revisionRef = useRef(0);
  const [draft, setDraft] = useState(() => cloneReaderSettings(settings));
  const [numberInputs, setNumberInputs] = useState(() => typographyInputs(settings.appearance));
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [replaceTheme, setReplaceTheme] = useState<ThemeDefinition>();
  const [localError, setLocalError] = useState<string>();

  const persist = useCallback(async (next = draftRef.current): Promise<void> => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    const revision = ++revisionRef.current;
    try {
      await onSave(next);
      if (revision === revisionRef.current) persistedRef.current = cloneReaderSettings(next);
    } catch {
      if (revision !== revisionRef.current) return;
      const rollback = cloneReaderSettings(persistedRef.current);
      draftRef.current = rollback;
      setDraft(rollback);
      setNumberInputs(typographyInputs(rollback.appearance));
      onPreview(rollback);
    }
  }, [onPreview, onSave]);

  const update = useCallback((appearance: ReaderAppearance, syncNumbers = true) => {
    const next = { ...draftRef.current, appearance };
    draftRef.current = next;
    setDraft(next);
    if (syncNumbers) setNumberInputs(typographyInputs(appearance));
    onPreview(next);
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void persist(next), 300);
  }, [onPreview, persist]);

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("[data-spatial-item]")?.focus({ preventScroll: true });
    return () => { if (timerRef.current !== undefined) window.clearTimeout(timerRef.current); };
  }, []);

  const activateSpatialItem = useCallback((element: HTMLElement): boolean => {
    if (!element.classList.contains("appearance-number-entry")) return false;
    setEditing(true);
    const input = element.querySelector<HTMLInputElement>("input");
    requestAnimationFrame(() => { input?.focus(); input?.select(); });
    return true;
  }, []);

  useSpatialNavigation({ rootRef, enabled: true, editing, onActivate: activateSpatialItem });

  const close = async (): Promise<void> => {
    await persist();
    onClose();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || editing) return;
      event.preventDefault();
      if (confirmReset) { setConfirmReset(false); return; }
      if (replaceTheme) { setReplaceTheme(undefined); return; }
      void close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const updateTypography = (key: NumberKey, value: number): void => {
    const appearance = parseReaderAppearance({ ...draft.appearance, typography: { ...draft.appearance.typography, [key]: value } });
    if (appearance) update(appearance);
  };

  const updateNumberInput = (key: NumberKey, raw: string): void => {
    setNumberInputs((current) => ({ ...current, [key]: raw }));
    const appearance = parseReaderAppearance({ ...draftRef.current.appearance, typography: { ...draftRef.current.appearance.typography, [key]: Number(raw) } });
    if (appearance && raw.trim() !== "") update(appearance, false);
  };

  const performImport = async (theme: ThemeDefinition): Promise<void> => {
    try {
      setLocalError(undefined);
      const imported = await onImport(theme);
      const nextThemes = [...themes.filter((item) => item.theme.id !== theme.id), imported];
      onThemesChange(nextThemes);
      update({ ...draftRef.current.appearance, themeId: theme.id });
    } catch (error) { setLocalError((error as Error).message); }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      if (file.size > 64 * 1024) throw new Error("主题文件不能超过 64 KB。");
      const theme = parseThemeDefinition(JSON.parse(await file.text()));
      if (!theme) throw new Error("主题 JSON 不符合 Airnobe 主题格式。");
      if (BUILTIN_THEME_IDS.has(theme.id)) throw new Error("不能覆盖内置主题。");
      if (themes.some((item) => item.theme.id === theme.id && !item.builtin)) setReplaceTheme(theme);
      else await performImport(theme);
    } catch (error) { setLocalError((error as Error).message); }
  };

  return (
    <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) void close(); }}>
      <div className="settings-panel" ref={rootRef} role="dialog" aria-modal="true" aria-label="阅读设置">
        <header><h2>阅读设置</h2><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="0" onClick={() => void close()} aria-label="关闭设置">×</button></header>
        <section>
          <h3>主题</h3>
          <div className="theme-options">
            {themes.map((item, index) => <button key={item.theme.id} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row={String(index + 1)} aria-pressed={draft.appearance.themeId === item.theme.id} onClick={() => update({ ...draft.appearance, themeId: item.theme.id })}>
              <i style={{ background: item.theme.colors.background }} /><i style={{ background: item.theme.colors.accent }} /><span>{item.theme.name}</span>
            </button>)}
          </div>
          <input ref={fileRef} className="file-input" type="file" accept="application/json,.json" onChange={(event) => void onFile(event)} />
          <button type="button" className="secondary-action settings-import" data-spatial-item data-spatial-zone="settings" data-spatial-row="7" onClick={() => fileRef.current?.click()}>导入主题 JSON</button>
        </section>
        <section>
          <h3>排版</h3>
          {NUMBER_FIELDS.map((field, index) => <label className="appearance-number" key={field.key}>
            <span>{field.label}</span>
            <input className="appearance-slider" aria-label={`${field.label}滑块`} type="range" min={field.min} max={field.max} step={field.step} value={draft.appearance.typography[field.key]} onChange={(event) => updateTypography(field.key, Number(event.target.value))} />
            <span className="appearance-number-entry" tabIndex={0} data-spatial-item data-spatial-zone="settings" data-spatial-row={String(index + 8)}>
              <input aria-label={field.label} type="number" min={field.min} max={field.max} step={field.step} value={numberInputs[field.key]} onFocus={() => setEditing(true)} onBlur={() => { setEditing(false); setNumberInputs((current) => ({ ...current, [field.key]: String(draftRef.current.appearance.typography[field.key]) })); }} onChange={(event) => updateNumberInput(field.key, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setNumberInputs((current) => ({ ...current, [field.key]: String(draftRef.current.appearance.typography[field.key]) })); event.currentTarget.blur(); } }} />{field.suffix}
            </span>
          </label>)}
          <div className="settings-choice-row"><span>字重</span>{([400, 600] as const).map((weight) => <button key={weight} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="12" aria-pressed={draft.appearance.typography.fontWeight === weight} onClick={() => update({ ...draft.appearance, typography: { ...draft.appearance.typography, fontWeight: weight } })}>{weight === 400 ? "正常 400" : "半粗 600"}</button>)}</div>
        </section>
        <section>
          <h3>打开书籍时</h3>
          {([ ["showJapanese", "显示日文"], ["showAssistedRuby", "显示辅助注音"], ["showKatakanaRomaji", "显示片假名罗马音"] ] as const).map(([key, label], index) => <button className="settings-toggle" key={key} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row={String(index + 13)} aria-pressed={draft.appearance.defaults[key]} onClick={() => update({ ...draft.appearance, defaults: { ...draft.appearance.defaults, [key]: !draft.appearance.defaults[key] } })}><span>{label}</span><b>{draft.appearance.defaults[key] ? "开" : "关"}</b></button>)}
        </section>
        <button type="button" className="settings-reset" data-spatial-item data-spatial-zone="settings" data-spatial-row="16" onClick={() => setConfirmReset(true)}>恢复阅读外观默认值</button>
        {localError && <p className="settings-error" role="alert">{localError}</p>}
        {confirmReset && <div className="settings-confirm"><p>只重置主题、排版和默认显示状态。</p><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="17" onClick={() => { setConfirmReset(false); update(structuredClone(DEFAULT_READER_APPEARANCE)); }}>确认恢复</button><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="17" onClick={() => setConfirmReset(false)}>取消</button></div>}
        {replaceTheme && <div className="settings-confirm"><p>替换同名自定义主题“{replaceTheme.name}”？</p><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="17" onClick={() => { const theme = replaceTheme; setReplaceTheme(undefined); void performImport(theme); }}>替换</button><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="17" onClick={() => setReplaceTheme(undefined)}>取消</button></div>}
      </div>
    </div>
  );
}
