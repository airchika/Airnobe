import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import themePrompt from "../../../THEME_PROMPT.md?raw";
import { cloneReaderSettings, isNavigationStepCount, parseReaderAppearance, type ReaderAppearance, type ReaderSettings, type ThemeMode } from "./reader-settings.js";
import { useSpatialNavigation } from "./spatial-navigation.js";
import { BUILTIN_THEME_IDS, parseThemeDefinition, type ThemeDefinition } from "./themes.js";
import type { AvailableTheme } from "./theme-client.js";

interface SettingsPanelProps {
  settings: ReaderSettings; themes: AvailableTheme[]; scope?: "library" | "reader"; embedded?: boolean;
  onPreview(settings: ReaderSettings): void; onSave(settings: ReaderSettings): Promise<void>;
  onImport(theme: ThemeDefinition): Promise<AvailableTheme>; onThemesChange(themes: AvailableTheme[]): void; onClose?(): void;
}
type NumberKey = keyof ReaderAppearance["typography"];
const NUMBER_FIELDS: Array<{ key: NumberKey; label: string; min: number; max: number; step: number; suffix: string }> = [
  { key: "fontSize", label: "字号", min: 14, max: 30, step: 1, suffix: "px" }, { key: "rubyScale", label: "注音字号", min: 0.45, max: 0.8, step: 0.05, suffix: "倍" },
  { key: "lineHeight", label: "段内间距", min: 1.4, max: 2.2, step: 0.05, suffix: "倍" }, { key: "paragraphSpacing", label: "段落间距", min: 0, max: 2, step: 0.1, suffix: "em" },
  { key: "columnWidth", label: "栏宽", min: 520, max: 1200, step: 10, suffix: "px" }, { key: "japaneseOpacity", label: "日文透明度", min: 0.2, max: 1, step: 0.05, suffix: "" },
];
function typographyInputs(appearance: ReaderAppearance): Record<NumberKey, string> { return Object.fromEntries(NUMBER_FIELDS.map(({ key }) => [key, String(appearance.typography[key])])) as Record<NumberKey, string>; }

export function SettingsPanel({ settings, themes, scope = "reader", embedded = false, onPreview, onSave, onImport, onThemesChange, onClose }: SettingsPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null); const persistedRef = useRef(cloneReaderSettings(settings)); const draftRef = useRef(cloneReaderSettings(settings)); const editSnapshotRef = useRef<ReaderSettings | undefined>(undefined); const timerRef = useRef<number | undefined>(undefined);
  const [draft, setDraft] = useState(() => cloneReaderSettings(settings)); const [numbers, setNumbers] = useState(() => typographyInputs(settings.appearance)); const [navigationInput, setNavigationInput] = useState(String(settings.navigation.textSteps)); const [editing, setEditing] = useState(false); const [replaceTheme, setReplaceTheme] = useState<ThemeDefinition>(); const [localError, setLocalError] = useState<string>(); const [promptCopied, setPromptCopied] = useState(false);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  useEffect(() => { draftRef.current = cloneReaderSettings(settings); setDraft(cloneReaderSettings(settings)); setNumbers(typographyInputs(settings.appearance)); setNavigationInput(String(settings.navigation.textSteps)); }, [settings]);
  useEffect(() => { const query = window.matchMedia?.("(prefers-color-scheme: dark)"); if (!query) return; const change = () => setSystemDark(query.matches); query.addEventListener("change", change); return () => query.removeEventListener("change", change); }, []);
  const persist = useCallback(async (next = draftRef.current) => { if (timerRef.current) clearTimeout(timerRef.current); try { await onSave(next); persistedRef.current = cloneReaderSettings(next); } catch { const rollback = cloneReaderSettings(persistedRef.current); draftRef.current = rollback; setDraft(rollback); setNumbers(typographyInputs(rollback.appearance)); setNavigationInput(String(rollback.navigation.textSteps)); onPreview(rollback); } }, [onPreview, onSave]);
  const updateSettings = useCallback((next: ReaderSettings, immediate = false) => { draftRef.current = next; setDraft(next); setNumbers(typographyInputs(next.appearance)); setNavigationInput(String(next.navigation.textSteps)); onPreview(next); if (timerRef.current) clearTimeout(timerRef.current); if (immediate) void persist(next); else timerRef.current = window.setTimeout(() => void persist(next), 300); }, [onPreview, persist]);
  const updateAppearance = (appearance: ReaderAppearance, immediate = false): void => updateSettings({ ...draftRef.current, appearance }, immediate);
  useSpatialNavigation({ rootRef, enabled: !embedded, editing, keys: "both", onActivate: (element) => { if (!element.classList.contains("appearance-number-entry")) return false; setEditing(true); requestAnimationFrame(() => { const input = element.querySelector("input"); input?.focus(); input?.select(); }); return true; }, onCancel: () => { if (!replaceTheme) return false; setReplaceTheme(undefined); return true; } });
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const close = async (): Promise<void> => { await persist(); onClose?.(); };
  useEffect(() => { if (embedded) return; const listener = (event: KeyboardEvent) => { if (event.key === "Escape" && !editing && !replaceTheme) { event.preventDefault(); void close(); } }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); });
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
  const importTheme = async (theme: ThemeDefinition): Promise<void> => { try { setLocalError(undefined); const imported = await onImport(theme); onThemesChange([...themes.filter((item) => item.theme.id !== theme.id), imported]); selectTheme(theme.id, theme.variant); } catch (error) { setLocalError((error as Error).message); } };
  const acceptTheme = async (raw: string): Promise<void> => { try { setLocalError(undefined); const theme = parseThemeClipboard(raw); if (BUILTIN_THEME_IDS.has(theme.id)) throw new Error("不能覆盖内置主题。"); if (themes.some((item) => item.theme.id === theme.id && !item.builtin)) setReplaceTheme(theme); else await importTheme(theme); } catch (error) { setLocalError((error as Error).message); } };
  const copyPrompt = async (): Promise<void> => { try { await navigator.clipboard.writeText(themePrompt); setPromptCopied(true); window.setTimeout(() => setPromptCopied(false), 1600); } catch { setLocalError("无法写入剪贴板，请检查浏览器剪贴板权限。"); } };
  const importClipboard = async (): Promise<void> => { try { await acceptTheme(await navigator.clipboard.readText()); } catch { setLocalError("无法读取剪贴板，请检查浏览器剪贴板权限。"); } };
  const content = <div className={`settings-panel${embedded ? " settings-panel--embedded" : ""}`} ref={rootRef} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : true} aria-label={embedded ? undefined : scope === "library" ? "书库设置" : "阅读设置"}>
    {!embedded && <header><h2>{scope === "library" ? "书库设置" : "阅读设置"}</h2><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="0" onClick={() => void close()} aria-label="关闭设置">×</button></header>}
    <section>{(() => { const variant = draft.appearance.theme.mode === "day" ? "light" : draft.appearance.theme.mode === "night" ? "dark" : systemDark ? "dark" : "light"; return <><div className="settings-section-heading"><h3>主题</h3><div className="settings-segmented" aria-label="主题模式">{([ ["day", "浅色"], ["night", "深色"], ["system", "系统"] ] as const).map(([mode, label]) => <button key={mode} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="1" aria-pressed={draft.appearance.theme.mode === mode} onClick={() => updateAppearance({ ...draft.appearance, theme: { ...draft.appearance.theme, mode: mode as ThemeMode } }, true)}>{label}</button>)}</div></div>
      <div className="theme-options">{themes.filter((item) => item.theme.variant === variant).map((item, index) => <button key={item.theme.id} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row={String(2 + Math.floor(index / 2))} aria-pressed={draft.appearance.theme[variant === "light" ? "lightThemeId" : "darkThemeId"] === item.theme.id} onClick={() => selectTheme(item.theme.id, variant)}><i style={{ background: item.theme.colors.background }} /><i style={{ background: item.theme.colors.accent }} /><span>{item.theme.name}</span></button>)}</div></>; })()}
      <div className="theme-import-actions"><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="22" onClick={() => void copyPrompt()}>{promptCopied ? "已复制提示词" : "复制导入主题提示词"}</button><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="22" onClick={() => void importClipboard()}>从剪贴板导入主题</button></div></section>
    {scope === "reader" && <><section><h3>排版与样式</h3>{NUMBER_FIELDS.map((field, index) => <label className="appearance-number" key={field.key}><span>{field.label}</span><input className="appearance-slider" aria-label={`${field.label}滑块`} type="range" min={field.min} max={field.max} step={field.step} value={draft.appearance.typography[field.key]} onChange={(event) => updateNumber(field.key, event.target.value, true)} /><span className="appearance-number-entry" tabIndex={0} data-spatial-item data-spatial-zone="settings" data-spatial-row={String(30 + index)}><input aria-label={field.label} type="number" min={field.min} max={field.max} step={field.step} value={numbers[field.key]} onFocus={beginEditing} onBlur={() => { if (editSnapshotRef.current) finishEditing(true); setNumbers(typographyInputs(draftRef.current.appearance)); }} onKeyDown={editKeyDown} onChange={(event) => updateNumber(field.key, event.target.value)} />{field.suffix}</span></label>)}
      <label className="appearance-number"><span>回退/快进段数</span><input className="appearance-slider" aria-label="回退/快进段数滑块" type="range" min="1" max="10" step="1" value={draft.navigation.textSteps} onChange={(event) => updateNavigation(event.target.value, true)} /><span className="appearance-number-entry" tabIndex={0} data-spatial-item data-spatial-zone="settings" data-spatial-row="36"><input aria-label="回退/快进段数" type="number" min="1" max="10" step="1" value={navigationInput} onFocus={beginEditing} onBlur={() => { if (editSnapshotRef.current) finishEditing(true); setNavigationInput(String(draftRef.current.navigation.textSteps)); }} onKeyDown={editKeyDown} onChange={(event) => updateNavigation(event.target.value)} /></span></label>
      <div className="settings-choice-row settings-weight-row"><span>字重</span>{([400, 600, 800] as const).map((weight) => <button key={weight} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="37" aria-pressed={draft.appearance.typography.fontWeight === weight} onClick={() => updateAppearance({ ...draft.appearance, typography: { ...draft.appearance.typography, fontWeight: weight } })}>{weight === 400 ? "正常" : weight === 600 ? "半粗" : "粗体"}</button>)}</div>
      {([ ["showJapanese", "显示日文"], ["showAssistedRuby", "显示振假名"], ["showKatakanaRomaji", "显示片假名罗马音"], ["showJapaneseRule", "显示日文引用线"], ["showProgressBars", "显示阅读进度条"] ] as const).map(([key, label], index) => <button className="settings-toggle" key={key} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row={String(38 + index)} aria-pressed={draft.appearance.display[key]} onClick={() => updateAppearance({ ...draft.appearance, display: { ...draft.appearance.display, [key]: !draft.appearance.display[key] } }, true)}><span>{label}</span><b>{draft.appearance.display[key] ? "开" : "关"}</b></button>)}
      <button className="settings-toggle" type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="43" aria-pressed={draft.pageTransitions} onClick={() => updateSettings({ ...draftRef.current, pageTransitions: !draftRef.current.pageTransitions }, true)}><span>翻页淡入淡出</span><b>{draft.pageTransitions ? "开" : "关"}</b></button></section></>}
    {localError && <p className="settings-error" role="alert">{localError}</p>}{replaceTheme && <div className="settings-confirm"><p>替换同名自定义主题“{replaceTheme.name}”？</p><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="24" onClick={() => { const theme = replaceTheme; setReplaceTheme(undefined); void importTheme(theme); }}>替换</button><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-row="24" onClick={() => setReplaceTheme(undefined)}>取消</button></div>}
  </div>;
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
