import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, isThemeId } from "./themes.js";

const READING_ACTIONS = ["toggleJapanese", "toggleAssistedRuby", "toggleKatakanaRomaji", "topBackward", "topForward", "bottomBackward", "bottomForward", "pageUp", "pageDown"] as const;
const OLD_ACTIONS = [...READING_ACTIONS, "toggleMenu", "toggleToc"] as const;
export const SHORTCUT_ACTIONS = [...READING_ACTIONS, "toggleSidebar", "returnLibrary"] as const;
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number];
type OldShortcutAction = typeof OLD_ACTIONS[number];
export type ShortcutModifier = "Control" | "Alt" | "Shift";
export interface ShortcutBinding { code: string; modifier?: ShortcutModifier }
export type ThemeMode = "day" | "night" | "system";

export interface ReaderAppearance {
  theme: { mode: ThemeMode; lightThemeId: string; darkThemeId: string };
  typography: { fontSize: number; fontWeight: 400 | 600; lineHeight: number; paragraphSpacing: number; columnWidth: number; japaneseOpacity: number; rubyScale: number };
  display: { showJapanese: boolean; showAssistedRuby: boolean; showKatakanaRomaji: boolean; showJapaneseRule: boolean; showProgressBars: boolean };
}
export interface ReaderSettings {
  version: 8;
  navigation: { textSteps: number };
  shortcuts: Record<ShortcutAction, ShortcutBinding>;
  pageTransitions: boolean;
  appearance: ReaderAppearance;
}

export const DEFAULT_READER_APPEARANCE: ReaderAppearance = {
  theme: { mode: "night", lightThemeId: DEFAULT_LIGHT_THEME_ID, darkThemeId: DEFAULT_DARK_THEME_ID },
  typography: { fontSize: 19, fontWeight: 400, lineHeight: 1.6, paragraphSpacing: 1, columnWidth: 760, japaneseOpacity: 0.6, rubyScale: 0.6 },
  display: { showJapanese: false, showAssistedRuby: false, showKatakanaRomaji: false, showJapaneseRule: true, showProgressBars: true },
};
export const DEFAULT_SHORTCUTS: Record<ShortcutAction, ShortcutBinding> = {
  toggleJapanese: { code: "KeyQ" }, toggleAssistedRuby: { code: "KeyE" }, toggleKatakanaRomaji: { code: "KeyZ" },
  topBackward: { code: "KeyR" }, topForward: { code: "KeyF" }, bottomBackward: { code: "KeyW" }, bottomForward: { code: "KeyS" },
  pageUp: { code: "KeyA" }, pageDown: { code: "KeyD" }, toggleSidebar: { code: "Digit1" }, returnLibrary: { code: "Digit2" },
};
export const DEFAULT_READER_SETTINGS: ReaderSettings = { version: 8, navigation: { textSteps: 2 }, shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS), pageTransitions: false, appearance: structuredClone(DEFAULT_READER_APPEARANCE) };

export function isNavigationStepCount(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 99; }
export function isShortcutCode(value: unknown): value is string { return typeof value === "string" && /^(Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Space)$/.test(value); }
export function shortcutBindingId(binding: ShortcutBinding): string { return `${binding.modifier ?? "None"}+${binding.code}`; }
function finiteRange(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum; }

export function parseReaderAppearance(value: unknown): ReaderAppearance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const theme = record.theme as Record<string, unknown> | undefined;
  const typography = record.typography as Record<string, unknown> | undefined;
  const display = record.display as Record<string, unknown> | undefined;
  if (!theme || !typography || !display) return undefined;
  if (!["day", "night", "system"].includes(String(theme.mode)) || !isThemeId(theme.lightThemeId) || !isThemeId(theme.darkThemeId)) return undefined;
  if (!Number.isInteger(typography.fontSize) || !finiteRange(typography.fontSize, 14, 30) || (typography.fontWeight !== 400 && typography.fontWeight !== 600)) return undefined;
  if (!finiteRange(typography.lineHeight, 1.4, 2.2) || !finiteRange(typography.paragraphSpacing, 0, 2) || !Number.isInteger(typography.columnWidth) || !finiteRange(typography.columnWidth, 520, 1200) || !finiteRange(typography.japaneseOpacity, 0.2, 1) || !finiteRange(typography.rubyScale, 0.45, 0.8)) return undefined;
  const displayKeys = ["showJapanese", "showAssistedRuby", "showKatakanaRomaji", "showJapaneseRule", "showProgressBars"] as const;
  if (displayKeys.some((key) => typeof display[key] !== "boolean")) return undefined;
  return { theme: { mode: theme.mode as ThemeMode, lightThemeId: theme.lightThemeId, darkThemeId: theme.darkThemeId }, typography: typography as ReaderAppearance["typography"], display: display as ReaderAppearance["display"] };
}

function legacyAppearance(value: unknown, version: number): ReaderAppearance | undefined {
  if (!value || typeof value !== "object") return version <= 4 ? structuredClone(DEFAULT_READER_APPEARANCE) : undefined;
  const record = value as Record<string, unknown>;
  const typography = record.typography as Record<string, unknown> | undefined;
  const defaults = record.defaults as Record<string, unknown> | undefined;
  if (!typography || !defaults || !isThemeId(record.themeId)) return undefined;
  const legacyV5 = version === 5;
  const lineHeight = legacyV5 && typography.lineHeight === 2.05 ? 1.6 : Math.min(2.2, Math.max(1.4, Number(typography.lineHeight)));
  const next = structuredClone(DEFAULT_READER_APPEARANCE);
  next.theme.darkThemeId = record.themeId;
  if (record.themeId === DEFAULT_LIGHT_THEME_ID) { next.theme.lightThemeId = record.themeId; next.theme.mode = "day"; }
  next.typography = { fontSize: Number(typography.fontSize), fontWeight: typography.fontWeight as 400 | 600, lineHeight, paragraphSpacing: legacyV5 ? 1 : Number(typography.paragraphSpacing), columnWidth: Number(typography.columnWidth), japaneseOpacity: Number(typography.japaneseOpacity), rubyScale: 0.6 };
  next.display = { ...next.display, showJapanese: Boolean(defaults.showJapanese), showAssistedRuby: Boolean(defaults.showAssistedRuby), showKatakanaRomaji: Boolean(defaults.showKatakanaRomaji) };
  return parseReaderAppearance(next);
}

function parseBinding(value: unknown): ShortcutBinding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!isShortcutCode(record.code) || (record.modifier !== undefined && !["Control", "Alt", "Shift"].includes(String(record.modifier)))) return undefined;
  return record.modifier ? { code: record.code, modifier: record.modifier as ShortcutModifier } : { code: record.code };
}
function parseBindings<Action extends string>(value: unknown, actions: readonly Action[]): Record<Action, ShortcutBinding> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const result = {} as Record<Action, ShortcutBinding>;
  for (const action of actions) { const binding = parseBinding(record[action]); if (!binding) return undefined; result[action] = binding; }
  return new Set(actions.map((action) => shortcutBindingId(result[action]))).size === actions.length ? result : undefined;
}
const MODIFIERS: Array<ShortcutModifier | undefined> = [undefined, "Control", "Alt", "Shift"];
function freeBinding(occupied: Set<string>, codes: string[]): ShortcutBinding {
  for (const modifier of MODIFIERS) for (const code of codes) { const binding = modifier ? { code, modifier } : { code }; if (!occupied.has(shortcutBindingId(binding))) return binding; }
  throw new Error("无法分配未占用的阅读快捷键。");
}
function migrateOldShortcuts(old: Record<OldShortcutAction, ShortcutBinding>): Record<ShortcutAction, ShortcutBinding> {
  const reading = Object.fromEntries(READING_ACTIONS.map((action) => [action, old[action]])) as Pick<Record<ShortcutAction, ShortcutBinding>, typeof READING_ACTIONS[number]>;
  const occupied = new Set(READING_ACTIONS.map((action) => shortcutBindingId(reading[action])));
  let toggleSidebar = old.toggleMenu;
  if (occupied.has(shortcutBindingId(toggleSidebar))) toggleSidebar = freeBinding(occupied, ["Digit1", "Digit3", "KeyM"]);
  occupied.add(shortcutBindingId(toggleSidebar));
  let returnLibrary = old.toggleToc;
  if (occupied.has(shortcutBindingId(returnLibrary))) returnLibrary = freeBinding(occupied, ["Digit2", "Digit3", "KeyB"]);
  return { ...reading, toggleSidebar, returnLibrary } as Record<ShortcutAction, ShortcutBinding>;
}
function oldDefaults(): Record<OldShortcutAction, ShortcutBinding> { return { ...Object.fromEntries(READING_ACTIONS.map((action) => [action, DEFAULT_SHORTCUTS[action]])), toggleMenu: { code: "Digit1" }, toggleToc: { code: "Digit2" } } as Record<OldShortcutAction, ShortcutBinding>; }

export function parseReaderSettings(value: unknown): ReaderSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const version = Number(record.version);
  const navigation = record.navigation as Record<string, unknown> | undefined;
  if (!navigation) return undefined;
  if (version === 1) {
    if (!isNavigationStepCount(navigation.backwardTextSteps) || !isNavigationStepCount(navigation.forwardTextSteps)) return undefined;
    const next = cloneReaderSettings(DEFAULT_READER_SETTINGS);
    next.pageTransitions = Boolean(record.pageTransitions);
    return next;
  }
  if (!isNavigationStepCount(navigation.textSteps)) return undefined;
  if (version === 8) {
    const shortcuts = parseBindings(record.shortcuts, SHORTCUT_ACTIONS);
    const appearance = parseReaderAppearance(record.appearance);
    if (!shortcuts || !appearance) return undefined;
    return { version: 8, navigation: { textSteps: navigation.textSteps }, shortcuts, pageTransitions: typeof record.pageTransitions === "boolean" ? record.pageTransitions : false, appearance };
  }
  if (version === 7) {
    const old = parseBindings(record.shortcuts, OLD_ACTIONS);
    const appearance = parseReaderAppearance(record.appearance);
    if (!old || !appearance) return undefined;
    return { version: 8, navigation: { textSteps: navigation.textSteps }, shortcuts: migrateOldShortcuts(old), pageTransitions: Boolean(record.pageTransitions), appearance };
  }
  if (version < 2 || version > 6) return undefined;
  const old = oldDefaults();
  const supplied = record.shortcuts as Record<string, unknown> | undefined;
  for (const action of READING_ACTIONS) { const binding = supplied ? parseBinding(supplied[action]) : undefined; if (version >= 2 && !binding) return undefined; if (binding) old[action] = binding; }
  if (version >= 4) { const menu = supplied ? parseBinding(supplied.toggleMenu) : undefined; const toc = supplied ? parseBinding(supplied.toggleToc) : undefined; if (!menu || !toc) return undefined; old.toggleMenu = menu; old.toggleToc = toc; }
  else if (version === 3) { const toc = supplied ? parseBinding(supplied.toggleToc) : undefined; if (!toc) return undefined; old.toggleToc = toc; }
  const appearance = legacyAppearance(record.appearance, version);
  if (!appearance) return undefined;
  return { version: 8, navigation: { textSteps: navigation.textSteps }, shortcuts: migrateOldShortcuts(old), pageTransitions: Boolean(record.pageTransitions), appearance };
}

function cloneShortcuts(shortcuts: Record<ShortcutAction, ShortcutBinding>): Record<ShortcutAction, ShortcutBinding> { return Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action, { ...shortcuts[action] }])) as Record<ShortcutAction, ShortcutBinding>; }
export function cloneReaderSettings(settings: ReaderSettings): ReaderSettings { return { version: 8, navigation: { ...settings.navigation }, shortcuts: cloneShortcuts(settings.shortcuts), pageTransitions: settings.pageTransitions, appearance: structuredClone(settings.appearance) }; }
async function settingsResponse(response: Response): Promise<ReaderSettings> { let value: unknown; try { value = await response.json(); } catch { throw new Error("阅读设置服务返回了无效响应。"); } if (!response.ok) throw new Error(typeof value === "object" && value && "error" in value ? String((value as { error: unknown }).error) : `阅读设置请求失败（${response.status}）。`); const settings = parseReaderSettings(value); if (!settings) throw new Error("阅读设置服务返回了无效设置。"); return settings; }
export async function loadReaderSettings(): Promise<ReaderSettings> { return settingsResponse(await fetch("/api/settings")); }
export async function saveReaderSettings(settings: ReaderSettings): Promise<ReaderSettings> { return settingsResponse(await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) })); }
