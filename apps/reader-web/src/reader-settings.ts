import { DEFAULT_THEME_ID, isThemeId } from "./themes.js";

const V2_SHORTCUT_ACTIONS = [
  "toggleJapanese",
  "toggleAssistedRuby",
  "toggleKatakanaRomaji",
  "topBackward",
  "topForward",
  "bottomBackward",
  "bottomForward",
  "pageUp",
  "pageDown",
] as const;

export const SHORTCUT_ACTIONS = [
  ...V2_SHORTCUT_ACTIONS,
  "toggleMenu",
  "toggleToc",
] as const;

const V3_SHORTCUT_ACTIONS = [
  ...V2_SHORTCUT_ACTIONS,
  "toggleToc",
] as const;

export type ShortcutAction = typeof SHORTCUT_ACTIONS[number];
export type ShortcutModifier = "Control" | "Alt" | "Shift";

export interface ShortcutBinding {
  code: string;
  modifier?: ShortcutModifier;
}

export interface ReaderSettings {
  version: 6;
  navigation: {
    textSteps: number;
  };
  shortcuts: Record<ShortcutAction, ShortcutBinding>;
  pageTransitions: boolean;
  appearance: ReaderAppearance;
}

export interface ReaderAppearance {
  themeId: string;
  typography: {
    fontSize: number;
    fontWeight: 400 | 600;
    lineHeight: number;
    paragraphSpacing: number;
    columnWidth: number;
    japaneseOpacity: number;
  };
  defaults: {
    showJapanese: boolean;
    showAssistedRuby: boolean;
    showKatakanaRomaji: boolean;
  };
}

export const DEFAULT_READER_APPEARANCE: ReaderAppearance = {
  themeId: DEFAULT_THEME_ID,
  typography: { fontSize: 19, fontWeight: 400, lineHeight: 1.6, paragraphSpacing: 1, columnWidth: 760, japaneseOpacity: 0.6 },
  defaults: { showJapanese: false, showAssistedRuby: false, showKatakanaRomaji: false },
};

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, ShortcutBinding> = {
  toggleJapanese: { code: "KeyQ" },
  toggleAssistedRuby: { code: "KeyE" },
  toggleKatakanaRomaji: { code: "KeyZ" },
  topBackward: { code: "KeyR" },
  topForward: { code: "KeyF" },
  bottomBackward: { code: "KeyW" },
  bottomForward: { code: "KeyS" },
  pageUp: { code: "KeyA" },
  pageDown: { code: "KeyD" },
  toggleMenu: { code: "Digit1" },
  toggleToc: { code: "Digit2" },
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  version: 6,
  navigation: {
    textSteps: 2,
  },
  shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS),
  pageTransitions: false,
  appearance: structuredClone(DEFAULT_READER_APPEARANCE),
};

export function isNavigationStepCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 99;
}

export function isShortcutCode(value: unknown): value is string {
  return typeof value === "string" && /^(Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Space)$/.test(value);
}

export function shortcutBindingId(binding: ShortcutBinding): string {
  return `${binding.modifier ?? "None"}+${binding.code}`;
}

function finiteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function parseAppearance(value: unknown, legacyV5 = false): ReaderAppearance | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const typography = typeof record.typography === "object" && record.typography !== null
    ? record.typography as Record<string, unknown>
    : undefined;
  const defaults = typeof record.defaults === "object" && record.defaults !== null
    ? record.defaults as Record<string, unknown>
    : undefined;
  if (!isThemeId(record.themeId) || !typography || !defaults) return undefined;
  if (!Number.isInteger(typography.fontSize) || !finiteRange(typography.fontSize, 14, 30)) return undefined;
  if (typography.fontWeight !== 400 && typography.fontWeight !== 600) return undefined;
  if (!finiteRange(typography.lineHeight, legacyV5 ? 1.75 : 1.4, legacyV5 ? 2.6 : 2.2)) return undefined;
  if (!legacyV5 && !finiteRange(typography.paragraphSpacing, 0, 2)) return undefined;
  if (!Number.isInteger(typography.columnWidth) || !finiteRange(typography.columnWidth, 520, 1200)) return undefined;
  if (!finiteRange(typography.japaneseOpacity, 0.2, 1)) return undefined;
  if (typeof defaults.showJapanese !== "boolean" || typeof defaults.showAssistedRuby !== "boolean" || typeof defaults.showKatakanaRomaji !== "boolean") return undefined;
  return {
    themeId: record.themeId,
    typography: {
      fontSize: typography.fontSize,
      fontWeight: typography.fontWeight,
      lineHeight: legacyV5
        ? typography.lineHeight === 2.05 ? 1.6 : Math.min(2.2, Math.max(1.4, typography.lineHeight))
        : typography.lineHeight,
      paragraphSpacing: legacyV5 ? 1 : typography.paragraphSpacing as number,
      columnWidth: typography.columnWidth,
      japaneseOpacity: typography.japaneseOpacity,
    },
    defaults: {
      showJapanese: defaults.showJapanese,
      showAssistedRuby: defaults.showAssistedRuby,
      showKatakanaRomaji: defaults.showKatakanaRomaji,
    },
  };
}

export function parseReaderAppearance(value: unknown): ReaderAppearance | undefined {
  return parseAppearance(value);
}

function parseShortcutBinding(value: unknown): ShortcutBinding | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!isShortcutCode(record.code)) return undefined;
  const modifier = record.modifier;
  if (modifier !== undefined && modifier !== "Control" && modifier !== "Alt" && modifier !== "Shift") return undefined;
  return modifier === undefined ? { code: record.code } : { code: record.code, modifier };
}

function parseShortcutsForActions<Action extends ShortcutAction>(
  value: unknown,
  actions: readonly Action[],
): Record<Action, ShortcutBinding> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const entries = actions.map((action) => {
    const binding = parseShortcutBinding(record[action]);
    return binding ? [action, binding] as const : undefined;
  });
  if (entries.some((entry) => entry === undefined)) return undefined;
  const shortcuts = Object.fromEntries(entries as Array<readonly [Action, ShortcutBinding]>) as Record<Action, ShortcutBinding>;
  const ids = actions.map((action) => shortcutBindingId(shortcuts[action]));
  return new Set(ids).size === ids.length ? shortcuts : undefined;
}

function migratedTocBinding(shortcuts: Record<typeof V2_SHORTCUT_ACTIONS[number], ShortcutBinding>): ShortcutBinding {
  const occupied = new Set(V2_SHORTCUT_ACTIONS.map((action) => shortcutBindingId(shortcuts[action])));
  const candidates = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "KeyT"];
  const code = candidates.find((candidate) => !occupied.has(shortcutBindingId({ code: candidate }))) as string;
  return { code };
}

const FALLBACK_MODIFIERS: Array<ShortcutModifier | undefined> = [undefined, "Control", "Alt", "Shift"];

function firstFreeBinding(occupied: Set<string>, preferredCodes: string[]): ShortcutBinding {
  for (const modifier of FALLBACK_MODIFIERS) {
    for (const code of preferredCodes) {
      const binding = modifier ? { code, modifier } : { code };
      if (!occupied.has(shortcutBindingId(binding))) return binding;
    }
  }
  throw new Error("无法为阅读界面分配未占用的快捷键。");
}

function migrateV3Shortcuts(
  shortcuts: Record<typeof V3_SHORTCUT_ACTIONS[number], ShortcutBinding>,
): Record<ShortcutAction, ShortcutBinding> {
  const { toggleToc: previousToc, ...readingShortcuts } = shortcuts;
  const occupied = new Set(V2_SHORTCUT_ACTIONS.map((action) => shortcutBindingId(readingShortcuts[action])));
  let toggleToc = previousToc;
  let toggleMenu: ShortcutBinding;
  if (shortcutBindingId(previousToc) === shortcutBindingId({ code: "Digit1" }) && !occupied.has(shortcutBindingId({ code: "Digit1" }))) {
    toggleMenu = { code: "Digit1" };
    occupied.add(shortcutBindingId(toggleMenu));
    toggleToc = firstFreeBinding(occupied, ["Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "KeyT"]);
  } else {
    occupied.add(shortcutBindingId(toggleToc));
    toggleMenu = firstFreeBinding(occupied, ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "KeyM"]);
  }
  return { ...readingShortcuts, toggleMenu, toggleToc };
}

export function parseReaderSettings(value: unknown): ReaderSettings | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.navigation !== "object" || record.navigation === null) return undefined;
  const navigation = record.navigation as Record<string, unknown>;
  if (record.version === 1) {
    if (!isNavigationStepCount(navigation.backwardTextSteps) || !isNavigationStepCount(navigation.forwardTextSteps)) return undefined;
    return {
      ...cloneReaderSettings(DEFAULT_READER_SETTINGS),
      pageTransitions: typeof record.pageTransitions === "boolean" ? record.pageTransitions : false,
    };
  }
  if (record.version === 2) {
    if (!isNavigationStepCount(navigation.textSteps)) return undefined;
    const legacyShortcuts = parseShortcutsForActions(record.shortcuts, V2_SHORTCUT_ACTIONS);
    if (!legacyShortcuts) return undefined;
    return {
      version: 6,
      navigation: { textSteps: navigation.textSteps },
      shortcuts: migrateV3Shortcuts({ ...legacyShortcuts, toggleToc: migratedTocBinding(legacyShortcuts) }),
      pageTransitions: typeof record.pageTransitions === "boolean" ? record.pageTransitions : false,
      appearance: structuredClone(DEFAULT_READER_APPEARANCE),
    };
  }
  if (record.version === 3) {
    if (!isNavigationStepCount(navigation.textSteps)) return undefined;
    const shortcuts = parseShortcutsForActions(record.shortcuts, V3_SHORTCUT_ACTIONS);
    if (!shortcuts) return undefined;
    return {
      version: 6,
      navigation: { textSteps: navigation.textSteps },
      shortcuts: migrateV3Shortcuts(shortcuts),
      pageTransitions: typeof record.pageTransitions === "boolean" ? record.pageTransitions : false,
      appearance: structuredClone(DEFAULT_READER_APPEARANCE),
    };
  }
  if (record.version !== 4 && record.version !== 5 && record.version !== 6) return undefined;
  if (!isNavigationStepCount(navigation.textSteps)) return undefined;
  const shortcuts = parseShortcutsForActions(record.shortcuts, SHORTCUT_ACTIONS);
  const appearance = record.version === 5
    ? parseAppearance(record.appearance, true)
    : record.version === 6
      ? parseReaderAppearance(record.appearance)
      : structuredClone(DEFAULT_READER_APPEARANCE);
  if (!shortcuts || !appearance) return undefined;
  return {
    version: 6,
    navigation: { textSteps: navigation.textSteps },
    shortcuts,
    pageTransitions: typeof record.pageTransitions === "boolean" ? record.pageTransitions : false,
    appearance,
  };
}

function cloneShortcuts(shortcuts: Record<ShortcutAction, ShortcutBinding>): Record<ShortcutAction, ShortcutBinding> {
  return Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action, { ...shortcuts[action] }])) as Record<ShortcutAction, ShortcutBinding>;
}

export function cloneReaderSettings(settings: ReaderSettings): ReaderSettings {
  return {
    version: 6,
    navigation: { ...settings.navigation },
    shortcuts: cloneShortcuts(settings.shortcuts),
    pageTransitions: settings.pageTransitions,
    appearance: structuredClone(settings.appearance),
  };
}

async function settingsResponse(response: Response): Promise<ReaderSettings> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("阅读设置服务返回了无效响应。");
  }
  if (!response.ok) {
    const message = typeof value === "object" && value !== null && "error" in value
      ? String((value as { error: unknown }).error)
      : `阅读设置请求失败（${response.status}）。`;
    throw new Error(message);
  }
  const settings = parseReaderSettings(value);
  if (!settings) throw new Error("阅读设置服务返回了无效设置。");
  return settings;
}

export async function loadReaderSettings(): Promise<ReaderSettings> {
  return settingsResponse(await fetch("/api/settings"));
}

export async function saveReaderSettings(settings: ReaderSettings): Promise<ReaderSettings> {
  return settingsResponse(await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  }));
}
