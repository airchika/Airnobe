import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ThemeEditor } from "./ThemeEditor.js";
import { assignShortcutBinding, cloneReaderSettings, isNavigationStepCount, isShortcutCode, parseReaderAppearance, type ReaderAppearance, type ReaderSettings, type ShortcutAction, type ShortcutBinding, type ThemeMode } from "./reader-settings.js";
import { shortcutModifier, ShortcutBindingButton, SHORTCUT_LABELS } from "./shortcut-bindings.js";
import { useSpatialNavigation } from "./spatial-navigation.js";
import { BUILTIN_THEMES, parseThemeDefinition, type ThemeDefinition } from "./themes.js";
import { deleteTheme, type AvailableTheme } from "./theme-client.js";
import { DesktopSettingsSection } from "./DesktopSettingsSection.js";
import type { DesktopSettings } from "./desktop-settings.js";
import { READER_FONT_IDS, READER_FONTS, type ReaderFontId } from "./reader-fonts.js";

interface SettingsPanelProps {
  settings: ReaderSettings; themes: AvailableTheme[]; scope?: "library" | "reader"; embedded?: boolean;
  onPreview(settings: ReaderSettings): void; onSave(settings: ReaderSettings): Promise<void>;
  onImport(theme: ThemeDefinition): Promise<AvailableTheme>; onThemesChange(themes: AvailableTheme[]): void; onClose?(): void;
  desktopSettings?: DesktopSettings; onSaveDesktopShortcut?(shortcut: string | null): Promise<void>; onSaveDesktopAutostart?(enabled: boolean): Promise<void>;
}
type NumberKey = Exclude<keyof ReaderAppearance["typography"], "chineseFont" | "japaneseFont">;
const NUMBER_FIELDS: Array<{ key: NumberKey; label: string; min: number; max: number; step: number; suffix: string }> = [
  { key: "fontSize", label: "字号", min: 14, max: 30, step: 1, suffix: "px" }, { key: "rubyScale", label: "注音字号", min: 0.45, max: 0.8, step: 0.05, suffix: "倍" },
  { key: "lineHeight", label: "段内间距", min: 1.4, max: 2.2, step: 0.05, suffix: "倍" }, { key: "paragraphSpacing", label: "段落间距", min: 0, max: 2, step: 0.1, suffix: "em" },
  { key: "columnWidth", label: "栏宽", min: 520, max: 1200, step: 10, suffix: "px" }, { key: "chineseOpacity", label: "中文透明度", min: 0.2, max: 1, step: 0.05, suffix: "" },
  { key: "japaneseOpacity", label: "日文透明度", min: 0.2, max: 1, step: 0.05, suffix: "" },
];
function typographyInputs(appearance: ReaderAppearance): Record<NumberKey, string> { return Object.fromEntries(NUMBER_FIELDS.map(({ key }) => [key, String(appearance.typography[key])])) as Record<NumberKey, string>; }

export function SettingsPanel({ settings, themes, scope = "reader", embedded = false, onPreview, onSave, onImport, onThemesChange, onClose, desktopSettings, onSaveDesktopShortcut, onSaveDesktopAutostart }: SettingsPanelProps) {
  const typographyId = useId();
  const [typographyCollapsed, setTypographyCollapsed] = useState(() => {
    try { return localStorage.getItem("airnobe.typography-collapsed") === "true"; } catch { return false; }
  });
  const toggleTypography = (): void => {
    const next = !typographyCollapsed;
    setTypographyCollapsed(next);
    try { localStorage.setItem("airnobe.typography-collapsed", String(next)); } catch { /* Keep working when storage is unavailable. */ }
  };
  const rootRef = useRef<HTMLDivElement>(null); const persistedRef = useRef(cloneReaderSettings(settings)); const draftRef = useRef(cloneReaderSettings(settings)); const editSnapshotRef = useRef<ReaderSettings | undefined>(undefined); const timerRef = useRef<number | undefined>(undefined);
  const [draft, setDraft] = useState(() => cloneReaderSettings(settings)); const [numbers, setNumbers] = useState(() => typographyInputs(settings.appearance)); const [navigationInput, setNavigationInput] = useState(String(settings.navigation.textSteps)); const [editing, setEditing] = useState(false); const [capturingLibraryShortcut, setCapturingLibraryShortcut] = useState<ShortcutAction>(); const [localError, setLocalError] = useState<string>(); const [editorBase, setEditorBase] = useState<ThemeDefinition>();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  useEffect(() => { draftRef.current = cloneReaderSettings(settings); setDraft(cloneReaderSettings(settings)); setNumbers(typographyInputs(settings.appearance)); setNavigationInput(String(settings.navigation.textSteps)); }, [settings]);
  useEffect(() => { const query = window.matchMedia?.("(prefers-color-scheme: dark)"); if (!query) return; const change = () => setSystemDark(query.matches); query.addEventListener("change", change); return () => query.removeEventListener("change", change); }, []);
  const persist = useCallback(async (next = draftRef.current) => { if (timerRef.current) clearTimeout(timerRef.current); try { await onSave(next); persistedRef.current = cloneReaderSettings(next); } catch { const rollback = cloneReaderSettings(persistedRef.current); draftRef.current = rollback; setDraft(rollback); setNumbers(typographyInputs(rollback.appearance)); setNavigationInput(String(rollback.navigation.textSteps)); onPreview(rollback); } }, [onPreview, onSave]);
  const updateSettings = useCallback((next: ReaderSettings, immediate = false) => { draftRef.current = next; setDraft(next); setNumbers(typographyInputs(next.appearance)); setNavigationInput(String(next.navigation.textSteps)); onPreview(next); if (timerRef.current) clearTimeout(timerRef.current); if (immediate) void persist(next); else timerRef.current = window.setTimeout(() => void persist(next), 300); }, [onPreview, persist]);
  const updateAppearance = (appearance: ReaderAppearance, immediate = false): void => updateSettings({ ...draftRef.current, appearance }, immediate);
  useSpatialNavigation({ rootRef, enabled: !embedded && !editorBase, editing: editing || Boolean(capturingLibraryShortcut), keys: "both", onActivate: (element) => { if (!element.classList.contains("appearance-number-entry")) return false; setEditing(true); requestAnimationFrame(() => { const input = element.querySelector("input"); input?.focus(); input?.select(); }); return true; }, onCancel: () => { if (capturingLibraryShortcut) setCapturingLibraryShortcut(undefined); else void close(); return true; } });
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const close = async (): Promise<void> => { await persist(); onClose?.(); };
  useEffect(() => { if (embedded || editorBase) return; const listener = (event: KeyboardEvent) => { if (event.key === "Escape" && !editing && !capturingLibraryShortcut) { event.preventDefault(); void close(); } }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); });
  useEffect(() => {
    if (!capturingLibraryShortcut) return;
    const listener = (event: KeyboardEvent): void => {
      if (event.key === "Tab") { setCapturingLibraryShortcut(undefined); setLocalError(undefined); return; }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { setCapturingLibraryShortcut(undefined); setLocalError(undefined); return; }
      if (event.key === "Backspace") {
        const current = draftRef.current.shortcuts[capturingLibraryShortcut];
        setCapturingLibraryShortcut(undefined);
        setLocalError(undefined);
        if (current) updateSettings({ ...draftRef.current, shortcuts: assignShortcutBinding(draftRef.current.shortcuts, capturingLibraryShortcut, null) }, true);
        return;
      }
      if (event.repeat || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
      const modifier = shortcutModifier(event);
      if (modifier === "invalid") { setLocalError("只支持一个 Ctrl、Alt 或 Shift 附加键。"); return; }
      if (!isShortcutCode(event.code)) { setLocalError("这个按键不能用于阅读快捷键。"); return; }
      const candidate: ShortcutBinding = modifier ? { code: event.code, modifier } : { code: event.code };
      setCapturingLibraryShortcut(undefined);
      setLocalError(undefined);
      updateSettings({ ...draftRef.current, shortcuts: assignShortcutBinding(draftRef.current.shortcuts, capturingLibraryShortcut, candidate) }, true);
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [capturingLibraryShortcut, updateSettings]);
  const previewEdit = (next: ReaderSettings): void => { draftRef.current = next; setDraft(next); onPreview(next); };
  const beginEditing = (): void => { if (!editing) editSnapshotRef.current = cloneReaderSettings(draftRef.current); if (timerRef.current) clearTimeout(timerRef.current); setEditing(true); };
  const finishEditing = (commit: boolean): void => {
    const snapshot = editSnapshotRef.current;
    editSnapshotRef.current = undefined;
    setEditing(false);
    if (commit) { void persist(draftRef.current); return; }
    if (!snapshot) return;
    draftRef.current = snapshot; setDraft(snapshot); setNumbers(typographyInputs(snapshot.appearance)); setNavigationInput(String(snapshot.navigation.textSteps)); onPreview(snapshot);
  };
  const editKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => { if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); finishEditing(event.key === "Enter"); event.currentTarget.parentElement?.focus(); } };
  const updateNumber = (key: NumberKey, raw: string, slider = false): void => { if (!slider) setNumbers((current) => ({ ...current, [key]: raw })); const appearance = parseReaderAppearance({ ...draftRef.current.appearance, typography: { ...draftRef.current.appearance.typography, [key]: Number(raw) } }); if (appearance && raw.trim()) { if (slider) updateAppearance(appearance); else previewEdit({ ...draftRef.current, appearance }); } };
  const updateNavigation = (raw: string, slider = false): void => { setNavigationInput(raw); const value = Number(raw); if (raw.trim() && isNavigationStepCount(value)) { const next = { ...draftRef.current, navigation: { textSteps: value } }; if (slider) updateSettings(next); else previewEdit(next); } };
  const selectTheme = (id: string, variant: "light" | "dark"): void => updateAppearance({ ...draft.appearance, theme: { ...draft.appearance.theme, [variant === "light" ? "lightThemeId" : "darkThemeId"]: id } }, true);
  const content = <div className={`settings-panel${embedded ? " settings-panel--embedded" : ""}`} ref={rootRef} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : true} aria-label={embedded ? undefined : scope === "library" ? "书库设置" : "阅读设置"}>
    {!embedded && <header><h2>{scope === "library" ? "书库设置" : "阅读设置"}</h2><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="0" onClick={() => void close()} aria-label="关闭设置">×</button></header>}
    <section>{(() => { const variant = draft.appearance.theme.mode === "day" ? "light" : draft.appearance.theme.mode === "night" ? "dark" : systemDark ? "dark" : "light"; return <><div className="settings-section-heading"><h3>主题</h3><div className="theme-heading-actions"><button type="button" className="theme-add-button" aria-label="自定义主题" title="自定义主题" data-spatial-item data-spatial-zone="settings" data-spatial-row="1" onClick={() => {
        const variant = draft.appearance.theme.mode === "day" ? "light" : draft.appearance.theme.mode === "night" ? "dark" : systemDark ? "dark" : "light";
        const id = draft.appearance.theme[variant === "light" ? "lightThemeId" : "darkThemeId"];
        setEditorBase(themes.find((item) => item.theme.id === id)?.theme ?? BUILTIN_THEMES.find((theme) => theme.id === id) ?? BUILTIN_THEMES[0]!);
      }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button><div className="settings-segmented" aria-label="主题模式">{([ ["day", "浅色"], ["night", "深色"], ["system", "系统"] ] as const).map(([mode, label]) => <button key={mode} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="1" aria-pressed={draft.appearance.theme.mode === mode} onClick={() => updateAppearance({ ...draft.appearance, theme: { ...draft.appearance.theme, mode: mode as ThemeMode } }, true)}>{label}</button>)}</div></div></div>
      <div className="theme-options">{themes.filter((item) => item.theme.variant === variant).map((item, index) => <button key={item.theme.id} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row={String(2 + Math.floor(index / 2))} aria-pressed={draft.appearance.theme[variant === "light" ? "lightThemeId" : "darkThemeId"] === item.theme.id} onClick={() => selectTheme(item.theme.id, variant)}><i style={{ background: item.theme.colors.background }} /><i style={{ background: item.theme.colors.accent }} /><span>{item.theme.name}</span></button>)}</div></>; })()}
</section>
    {scope === "library" && <section><h3>快捷键</h3>{(["toggleFullscreen", "returnLibrary"] as const).map((action, index) => <div className="reader-menu-shortcut-row settings-interface-shortcut" key={action}><span>{SHORTCUT_LABELS[action]}</span><ShortcutBindingButton action={action} binding={draft.shortcuts[action]} capturing={capturingLibraryShortcut === action} onCapture={() => { setLocalError(undefined); setCapturingLibraryShortcut(action); }} spatialRow={String(23 + index)} spatialZone="settings" /></div>)}</section>}
    {scope === "library" && desktopSettings && onSaveDesktopShortcut && onSaveDesktopAutostart && <DesktopSettingsSection settings={desktopSettings} onSaveShortcut={onSaveDesktopShortcut} onSaveAutostart={onSaveDesktopAutostart} onError={setLocalError} />}
    {scope === "reader" && <><section><h3><button type="button" className="typography-toggle" data-spatial-item data-spatial-zone="settings" data-spatial-row="27" aria-expanded={!typographyCollapsed} aria-controls={typographyId} onClick={toggleTypography}><span>排版与样式</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 7 7-7 7" /></svg></button></h3><div id={typographyId} hidden={typographyCollapsed}>
      {([ ["chineseFont", "zh", "中文字体"], ["japaneseFont", "ja", "日文字体"] ] as const).map(([key, language, label], index) => <label className="reader-font-choice" key={key}><span>{label}</span><select aria-label={label} data-spatial-item data-spatial-zone="settings" data-spatial-row={String(28 + index)} value={draft.appearance.typography[key]} onChange={(event) => updateAppearance({ ...draftRef.current.appearance, typography: { ...draftRef.current.appearance.typography, [key]: event.target.value as ReaderFontId } }, true)}>{READER_FONT_IDS.map((id) => <option key={id} value={id}>{READER_FONTS[language][id].label}</option>)}</select></label>)}
      {NUMBER_FIELDS.map((field, index) => <label className="appearance-number" key={field.key}><span>{field.label}</span><input className="appearance-slider" aria-label={`${field.label}滑块`} type="range" min={field.min} max={field.max} step={field.step} value={draft.appearance.typography[field.key]} onChange={(event) => updateNumber(field.key, event.target.value, true)} /><span className="appearance-number-entry" tabIndex={0} data-spatial-item data-spatial-zone="settings" data-spatial-row={String(30 + index)}><input aria-label={field.label} type="number" min={field.min} max={field.max} step={field.step} value={numbers[field.key]} onFocus={beginEditing} onBlur={() => { if (editSnapshotRef.current) finishEditing(true); setNumbers(typographyInputs(draftRef.current.appearance)); }} onKeyDown={editKeyDown} onChange={(event) => updateNumber(field.key, event.target.value)} />{field.suffix}</span></label>)}
      <label className="appearance-number"><span>滚动段数</span><input className="appearance-slider" aria-label="滚动段数滑块" type="range" min="1" max="10" step="1" value={draft.navigation.textSteps} onChange={(event) => updateNavigation(event.target.value, true)} /><span className="appearance-number-entry" tabIndex={0} data-spatial-item data-spatial-zone="settings" data-spatial-row="37"><input aria-label="滚动段数" type="number" min="1" max="10" step="1" value={navigationInput} onFocus={beginEditing} onBlur={() => { if (editSnapshotRef.current) finishEditing(true); setNavigationInput(String(draftRef.current.navigation.textSteps)); }} onKeyDown={editKeyDown} onChange={(event) => updateNavigation(event.target.value)} /></span></label>
      <div className="settings-choice-row settings-weight-row"><span>字重</span>{([400, 600, 800] as const).map((weight) => <button key={weight} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="38" aria-pressed={draft.appearance.typography.fontWeight === weight} onClick={() => updateAppearance({ ...draft.appearance, typography: { ...draft.appearance.typography, fontWeight: weight } })}>{weight === 400 ? "正常" : weight === 600 ? "半粗" : "粗体"}</button>)}</div>
      </div>
      {([ ["showJapanese", "显示日文"], ["showAssistedRuby", "显示振假名"], ["showKatakanaRomaji", "显示片假名罗马音"], ["showJapaneseRule", "显示日文引用线"], ["showProgressBars", "显示阅读进度条"] ] as const).map(([key, label], index) => <button className="settings-toggle" key={key} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row={String(39 + index)} aria-pressed={draft.appearance.display[key]} onClick={() => updateAppearance({ ...draft.appearance, display: { ...draft.appearance.display, [key]: !draft.appearance.display[key] } }, true)}><span>{label}</span><b>{draft.appearance.display[key] ? "开" : "关"}</b></button>)}
      <button className="settings-toggle" type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="45" aria-pressed={draft.pageTransitions} onClick={() => updateSettings({ ...draftRef.current, pageTransitions: !draftRef.current.pageTransitions }, true)}><span>翻页淡入淡出</span><b>{draft.pageTransitions ? "开" : "关"}</b></button></section></>}
    {localError && <p className="settings-error" role="alert">{localError}</p>}
  </div>;
  if (editorBase) return <>{content}<ThemeEditor base={editorBase} themes={themes} onReadClipboard={async () => parseThemeClipboard(await navigator.clipboard.readText())} onDelete={async (id) => {
    const next = cloneReaderSettings(draftRef.current);
    for (const variant of ["light", "dark"] as const) {
      const key = variant === "light" ? "lightThemeId" : "darkThemeId";
      if (next.appearance.theme[key] === id) next.appearance.theme[key] = BUILTIN_THEMES.find((theme) => theme.variant === variant)!.id;
    }
    await onSave(next);
    const remaining = await deleteTheme(id);
    onThemesChange(remaining); onPreview(next);
    return BUILTIN_THEMES.find((theme) => theme.variant === editorBase.variant)!;
  }} onClose={() => setEditorBase(undefined)} onSave={async (theme) => {
    const imported = await onImport(theme);
    const next = { ...draftRef.current, appearance: { ...draftRef.current.appearance, theme: { ...draftRef.current.appearance.theme, mode: theme.variant === "dark" ? "night" as const : "day" as const, [theme.variant === "dark" ? "darkThemeId" : "lightThemeId"]: theme.id } } };
    await onSave(next);
    onThemesChange([...themes.filter((item) => item.theme.id !== theme.id), imported]);
    onPreview(next);
  }} /></>;
  return embedded ? content : <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) void close(); }}>{content}</div>;
}

export function parseThemeClipboard(raw: string): ThemeDefinition {
  if (new TextEncoder().encode(raw).byteLength > 64 * 1024) throw new Error("剪贴板主题不能超过 64 KB。");
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  let value: unknown;
  try { value = JSON.parse(fenced?.[1] ?? trimmed); } catch { throw new Error("剪贴板中没有有效的主题 JSON。"); }
  const theme = parseThemeDefinition(value);
  if (!theme) throw new Error("主题 JSON 不符合 Airnobe 主题格式。");
  return theme;
}
