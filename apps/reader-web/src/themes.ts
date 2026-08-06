import airnobeNight from "./themes/airnobe-night.json";
import absolutely from "./themes/absolutely.json";
import oneDark from "./themes/one-dark.json";
import warmPaper from "./themes/warm-paper.json";
import xcodeDark from "./themes/xcode-dark.json";

export const THEME_COLOR_KEYS = [
  "background", "surface", "surfaceRaised", "sidebar", "text", "mutedText", "border", "accent",
  "accentText", "accentSoft", "link", "readingText", "japaneseRule", "rubySource", "danger",
] as const;

const LEGACY_RUBY_COLOR_KEYS = ["rubyReused", "rubyGenerated", "rubyRomaji"] as const;

export type ThemeColorKey = typeof THEME_COLOR_KEYS[number];

export interface ThemeDefinition {
  version: 2;
  id: string;
  name: string;
  variant: "dark" | "light";
  colors: Record<ThemeColorKey, string>;
}

const COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isThemeId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function parseThemeDefinition(value: unknown): ThemeDefinition | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["version", "id", "name", "variant", "colors"].includes(key))) return undefined;
  if ((record.version !== 1 && record.version !== 2) || !isThemeId(record.id)) return undefined;
  if (typeof record.name !== "string" || record.name.trim().length === 0 || record.name.length > 60) return undefined;
  if (record.variant !== "dark" && record.variant !== "light") return undefined;
  if (typeof record.colors !== "object" || record.colors === null) return undefined;
  const colorRecord = record.colors as Record<string, unknown>;
  const entries = THEME_COLOR_KEYS.map((key) => {
    const color = colorRecord[key];
    return typeof color === "string" && COLOR_PATTERN.test(color) ? [key, color.toLowerCase()] as const : undefined;
  });
  if (entries.some((entry) => entry === undefined)) return undefined;
  const allowedColorKeys: readonly string[] = record.version === 1
    ? [...THEME_COLOR_KEYS, ...LEGACY_RUBY_COLOR_KEYS]
    : THEME_COLOR_KEYS;
  if (record.version === 1 && LEGACY_RUBY_COLOR_KEYS.some((key) => typeof colorRecord[key] !== "string" || !COLOR_PATTERN.test(colorRecord[key] as string))) return undefined;
  if (Object.keys(colorRecord).some((key) => !allowedColorKeys.includes(key))) return undefined;
  const colors = Object.fromEntries(entries as Array<readonly [ThemeColorKey, string]>) as Record<ThemeColorKey, string>;
  return { version: 2, id: record.id, name: record.name.trim(), variant: record.variant, colors };
}

function builtin(value: unknown): ThemeDefinition {
  const theme = parseThemeDefinition(value);
  if (!theme) throw new Error("内置主题配置无效。");
  return theme;
}

export const BUILTIN_THEMES: ThemeDefinition[] = [airnobeNight, absolutely, oneDark, xcodeDark, warmPaper].map(builtin);
export const BUILTIN_THEME_IDS = new Set(BUILTIN_THEMES.map((theme) => theme.id));
export const DEFAULT_DARK_THEME_ID = "airnobe-night";
export const DEFAULT_LIGHT_THEME_ID = "warm-paper";
export const DEFAULT_THEME_ID = DEFAULT_DARK_THEME_ID;

const CSS_VARIABLES: Record<ThemeColorKey, string> = {
  background: "--background", surface: "--surface", surfaceRaised: "--surface-raised", sidebar: "--sidebar",
  text: "--text", mutedText: "--muted", border: "--line", accent: "--accent", accentText: "--accent-text",
  accentSoft: "--accent-soft", link: "--link", readingText: "--reading-text", japaneseRule: "--japanese-rule",
  rubySource: "--ruby-source", danger: "--danger",
};

export function applyTheme(theme: ThemeDefinition): void {
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.variant;
  for (const key of THEME_COLOR_KEYS) document.documentElement.style.setProperty(CSS_VARIABLES[key], theme.colors[key]);
}
