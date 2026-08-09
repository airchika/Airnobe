import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, isThemeId } from "./themes.js";

export const NAVIGATION_SHORTCUT_ACTIONS = ["topBackward", "topForward", "bottomBackward", "bottomForward", "pageUp", "pageDown"] as const;
export const DISPLAY_SHORTCUT_ACTIONS = ["toggleJapanese", "toggleAssistedRuby", "toggleKatakanaRomaji", "toggleSidebar", "toggleFullscreen", "addBookmark", "returnLibrary"] as const;
export const SHORTCUT_ACTIONS = [...NAVIGATION_SHORTCUT_ACTIONS, ...DISPLAY_SHORTCUT_ACTIONS] as const;
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number];
export type ShortcutModifier = "Control" | "Alt" | "Shift";
export interface ShortcutBinding { code: string; modifier?: ShortcutModifier }
export type ShortcutAssignment = ShortcutBinding | null;
export type ShortcutMap = Record<ShortcutAction, ShortcutAssignment>;
export type ThemeMode = "day" | "night" | "system";

export interface ReaderAppearance {
  theme: { mode: ThemeMode; lightThemeId: string; darkThemeId: string };
  typography: { fontSize: number; fontWeight: 400 | 600 | 800; lineHeight: number; paragraphSpacing: number; columnWidth: number; chineseOpacity: number; japaneseOpacity: number; rubyScale: number };
  display: { showJapanese: boolean; showAssistedRuby: boolean; showKatakanaRomaji: boolean; showJapaneseRule: boolean; showProgressBars: boolean };
}
export interface ReaderSettings {
  version: 13;
  navigation: { textSteps: number };
  shortcuts: ShortcutMap;
  pageTransitions: boolean;
  appearance: ReaderAppearance;
}

export const DEFAULT_READER_APPEARANCE: ReaderAppearance = {
  theme: { mode: "night", lightThemeId: DEFAULT_LIGHT_THEME_ID, darkThemeId: DEFAULT_DARK_THEME_ID },
  typography: { fontSize: 19, fontWeight: 400, lineHeight: 1.6, paragraphSpacing: 1, columnWidth: 760, chineseOpacity: 1, japaneseOpacity: 0.6, rubyScale: 0.6 },
  display: { showJapanese: false, showAssistedRuby: false, showKatakanaRomaji: false, showJapaneseRule: true, showProgressBars: true },
};
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  toggleJapanese: { code: "Digit1" }, toggleAssistedRuby: { code: "Digit2" }, toggleKatakanaRomaji: { code: "Digit3" },
  topBackward: { code: "KeyZ" }, topForward: { code: "KeyX" }, bottomBackward: { code: "KeyW" }, bottomForward: { code: "KeyS" },
  pageUp: { code: "KeyA" }, pageDown: { code: "KeyD" }, toggleSidebar: { code: "KeyQ" },
  toggleFullscreen: { code: "KeyF" }, returnLibrary: { code: "KeyE" }, addBookmark: { code: "KeyC" },
};
export const DEFAULT_READER_SETTINGS: ReaderSettings = { version: 13, navigation: { textSteps: 2 }, shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS), pageTransitions: false, appearance: structuredClone(DEFAULT_READER_APPEARANCE) };

export function isNavigationStepCount(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10; }
export function isShortcutCode(value: unknown): value is string { return typeof value === "string" && /^(Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Space)$/.test(value); }
export function shortcutBindingId(binding: ShortcutAssignment): string | undefined { return binding ? `${binding.modifier ?? "None"}+${binding.code}` : undefined; }

export function assignShortcutBinding(shortcuts: ShortcutMap, action: ShortcutAction, binding: ShortcutAssignment): ShortcutMap {
  const next = cloneShortcuts(shortcuts);
  const previous = next[action];
  const bindingId = shortcutBindingId(binding);
  const conflict = bindingId
    ? SHORTCUT_ACTIONS.find((candidate) => candidate !== action && shortcutBindingId(next[candidate]) === bindingId)
    : undefined;
  next[action] = binding ? { ...binding } : null;
  if (conflict) next[conflict] = previous ? { ...previous } : null;
  return next;
}
function finiteRange(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum; }

export function parseReaderAppearance(value: unknown): ReaderAppearance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const theme = record.theme as Record<string, unknown> | undefined;
  const typography = record.typography as Record<string, unknown> | undefined;
  const display = record.display as Record<string, unknown> | undefined;
  if (!theme || !typography || !display) return undefined;
  if (!["day", "night", "system"].includes(String(theme.mode)) || !isThemeId(theme.lightThemeId) || !isThemeId(theme.darkThemeId)) return undefined;
  if (!Number.isInteger(typography.fontSize) || !finiteRange(typography.fontSize, 14, 30) || ![400, 600, 800].includes(Number(typography.fontWeight))) return undefined;
  if (!finiteRange(typography.lineHeight, 1.4, 2.2) || !finiteRange(typography.paragraphSpacing, 0, 2) || !Number.isInteger(typography.columnWidth) || !finiteRange(typography.columnWidth, 520, 1200) || !finiteRange(typography.chineseOpacity, 0.2, 1) || !finiteRange(typography.japaneseOpacity, 0.2, 1) || !finiteRange(typography.rubyScale, 0.45, 0.8)) return undefined;
  const displayKeys = ["showJapanese", "showAssistedRuby", "showKatakanaRomaji", "showJapaneseRule", "showProgressBars"] as const;
  if (displayKeys.some((key) => typeof display[key] !== "boolean")) return undefined;
  return {
    theme: { mode: theme.mode as ThemeMode, lightThemeId: theme.lightThemeId, darkThemeId: theme.darkThemeId },
    typography: typography as ReaderAppearance["typography"],
    display: Object.fromEntries(displayKeys.map((key) => [key, display[key]])) as unknown as ReaderAppearance["display"],
  };
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
  next.typography = { fontSize: Number(typography.fontSize), fontWeight: typography.fontWeight as 400 | 600, lineHeight, paragraphSpacing: legacyV5 ? 1 : Number(typography.paragraphSpacing), columnWidth: Number(typography.columnWidth), chineseOpacity: 1, japaneseOpacity: Number(typography.japaneseOpacity), rubyScale: 0.6 };
  next.display = { ...next.display, showJapanese: Boolean(defaults.showJapanese), showAssistedRuby: Boolean(defaults.showAssistedRuby), showKatakanaRomaji: Boolean(defaults.showKatakanaRomaji) };
  return parseReaderAppearance(next);
}

function parseBinding(value: unknown): ShortcutBinding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!isShortcutCode(record.code) || (record.modifier !== undefined && !["Control", "Alt", "Shift"].includes(String(record.modifier)))) return undefined;
  return record.modifier ? { code: record.code, modifier: record.modifier as ShortcutModifier } : { code: record.code };
}
function parseBindings(value: unknown): ShortcutMap | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const result = {} as ShortcutMap;
  const used = new Set<string>();
  for (const action of SHORTCUT_ACTIONS) {
    const raw = record[action];
    if (raw === null) { result[action] = null; continue; }
    const binding = parseBinding(raw);
    const id = binding ? shortcutBindingId(binding) : undefined;
    if (!binding || !id || used.has(id)) return undefined;
    result[action] = binding;
    used.add(id);
  }
  return result;
}
function migratedNavigation(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return undefined;
  return Math.min(10, value);
}

function migrateV9Appearance(value: unknown): ReaderAppearance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!record.typography || typeof record.typography !== "object" || !record.display || typeof record.display !== "object") return undefined;
  return parseReaderAppearance({
    ...record,
    typography: { chineseOpacity: 1, ...(record.typography as Record<string, unknown>) },
    display: record.display as Record<string, unknown>,
  });
}

export function parseReaderSettings(value: unknown): ReaderSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const version = Number(record.version);
  const navigation = record.navigation as Record<string, unknown> | undefined;
  if (!navigation) return undefined;
  if (version === 1) {
    if (typeof navigation.backwardTextSteps !== "number" || typeof navigation.forwardTextSteps !== "number") return undefined;
    const next = cloneReaderSettings(DEFAULT_READER_SETTINGS);
    next.pageTransitions = Boolean(record.pageTransitions);
    return next;
  }
  const textSteps = version >= 10 && version <= 13
    ? isNavigationStepCount(navigation.textSteps) ? navigation.textSteps : undefined
    : migratedNavigation(navigation.textSteps);
  if (textSteps === undefined) return undefined;
  if (version >= 10 && version <= 13) {
    const shortcuts = version === 13 ? parseBindings(record.shortcuts) : cloneShortcuts(DEFAULT_SHORTCUTS);
    const appearance = parseReaderAppearance(record.appearance);
    if (!shortcuts || !appearance) return undefined;
    return { version: 13, navigation: { textSteps }, shortcuts, pageTransitions: typeof record.pageTransitions === "boolean" ? record.pageTransitions : false, appearance };
  }
  if (version === 9 || version === 8 || version === 7) {
    const appearance = migrateV9Appearance(record.appearance);
    if (!appearance) return undefined;
    return { version: 13, navigation: { textSteps }, shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS), pageTransitions: Boolean(record.pageTransitions), appearance };
  }
  if (version < 2 || version > 6) return undefined;
  const appearance = legacyAppearance(record.appearance, version);
  if (!appearance) return undefined;
  return { version: 13, navigation: { textSteps }, shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS), pageTransitions: Boolean(record.pageTransitions), appearance };
}

function cloneShortcuts(shortcuts: ShortcutMap): ShortcutMap { return Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action, shortcuts[action] ? { ...shortcuts[action] } : null])) as ShortcutMap; }
export function cloneReaderSettings(settings: ReaderSettings): ReaderSettings { return { version: 13, navigation: { ...settings.navigation }, shortcuts: cloneShortcuts(settings.shortcuts), pageTransitions: settings.pageTransitions, appearance: structuredClone(settings.appearance) }; }
async function settingsResponse(response: Response): Promise<ReaderSettings> { let value: unknown; try { value = await response.json(); } catch { throw new Error("阅读设置服务返回了无效响应。"); } if (!response.ok) throw new Error(typeof value === "object" && value && "error" in value ? String((value as { error: unknown }).error) : `阅读设置请求失败（${response.status}）。`); const settings = parseReaderSettings(value); if (!settings) throw new Error("阅读设置服务返回了无效设置。"); return settings; }
export async function loadReaderSettings(): Promise<ReaderSettings> { return settingsResponse(await fetch("/api/settings")); }
export async function saveReaderSettings(settings: ReaderSettings): Promise<ReaderSettings> { return settingsResponse(await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) })); }
