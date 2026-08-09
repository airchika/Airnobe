import airnobeNight from "./themes/airnobe-night.json";
import absolutely from "./themes/absolutely.json";
import oneDark from "./themes/one-dark.json";
import warmPaper from "./themes/warm-paper.json";
import xcodeDark from "./themes/xcode-dark.json";
import calibreDay from "./themes/calibre-day.json";
import calibreNight from "./themes/calibre-night.json";

export const THEME_COLOR_KEYS = ["background", "surface", "sidebar", "text", "accent"] as const;

const LEGACY_DERIVED_COLOR_KEYS = [
  "surfaceRaised", "mutedText", "border", "accentText", "accentSoft", "link", "readingText", "japaneseRule", "danger",
] as const;
const LEGACY_RUBY_COLOR_KEYS = ["rubySource", "rubyReused", "rubyGenerated", "rubyRomaji"] as const;

export type ThemeColorKey = typeof THEME_COLOR_KEYS[number];

export interface ThemeDefinition {
  version: 4;
  id: string;
  name: string;
  variant: "dark" | "light";
  colors: Record<ThemeColorKey, string>;
}

export interface DerivedThemeColors {
  surfaceRaised: string;
  mutedText: string;
  border: string;
  accentText: "#000000" | "#ffffff";
  accentSoft: string;
  danger: string;
  dangerText: "#000000" | "#ffffff";
}

interface RgbaColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

const COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const THEME_KEYS = ["version", "id", "name", "variant", "colors"];
const LEGACY_COLOR_KEYS = [...THEME_COLOR_KEYS, ...LEGACY_DERIVED_COLOR_KEYS, ...LEGACY_RUBY_COLOR_KEYS];

export function isThemeId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function parseThemeDefinition(value: unknown): ThemeDefinition | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !THEME_KEYS.includes(key))) return undefined;
  if (![1, 2, 3, 4].includes(record.version as number) || !isThemeId(record.id)) return undefined;
  if (typeof record.name !== "string" || record.name.trim().length === 0 || record.name.length > 60) return undefined;
  if (record.variant !== "dark" && record.variant !== "light") return undefined;
  if (typeof record.colors !== "object" || record.colors === null) return undefined;

  const colorRecord = record.colors as Record<string, unknown>;
  const allowedColorKeys: readonly string[] = record.version === 4 ? THEME_COLOR_KEYS : LEGACY_COLOR_KEYS;
  if (Object.keys(colorRecord).some((key) => !allowedColorKeys.includes(key))) return undefined;

  const entries = THEME_COLOR_KEYS.map((key) => {
    const color = colorRecord[key];
    return typeof color === "string" && COLOR_PATTERN.test(color) ? [key, color.toLowerCase()] as const : undefined;
  });
  if (entries.some((entry) => entry === undefined)) return undefined;
  for (const color of Object.values(colorRecord)) {
    if (typeof color !== "string" || !COLOR_PATTERN.test(color)) return undefined;
  }

  const colors = Object.fromEntries(entries as Array<readonly [ThemeColorKey, string]>) as Record<ThemeColorKey, string>;
  return { version: 4, id: record.id, name: record.name.trim(), variant: record.variant, colors };
}

function parseColor(color: string): RgbaColor {
  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
    alpha: color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) : 255,
  };
}

function hexChannel(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

function serializeColor(color: RgbaColor, includeAlpha = color.alpha < 255): string {
  const rgb = `${hexChannel(color.red)}${hexChannel(color.green)}${hexChannel(color.blue)}`;
  return `#${rgb}${includeAlpha ? hexChannel(color.alpha) : ""}`;
}

function mixColors(left: string, right: string, rightWeight: number): string {
  const a = parseColor(left);
  const b = parseColor(right);
  const leftWeight = 1 - rightWeight;
  return serializeColor({
    red: a.red * leftWeight + b.red * rightWeight,
    green: a.green * leftWeight + b.green * rightWeight,
    blue: a.blue * leftWeight + b.blue * rightWeight,
    alpha: a.alpha * leftWeight + b.alpha * rightWeight,
  });
}

function withOpacity(color: string, opacity: number): string {
  const parsed = parseColor(color);
  return serializeColor({ ...parsed, alpha: parsed.alpha * opacity }, true);
}

function relativeLuminance(color: string): number {
  const parsed = parseColor(color);
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(parsed.red) + 0.7152 * linear(parsed.green) + 0.0722 * linear(parsed.blue);
}

function contrastText(color: string): "#000000" | "#ffffff" {
  const luminance = relativeLuminance(color);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

export function deriveThemeColors(theme: ThemeDefinition): DerivedThemeColors {
  const danger = theme.variant === "dark" ? "#ff6b6b" : "#b42318";
  return {
    surfaceRaised: mixColors(theme.colors.surface, theme.colors.text, 0.08),
    mutedText: mixColors(theme.colors.background, theme.colors.text, 0.58),
    border: withOpacity(theme.colors.text, 0.14),
    accentText: contrastText(theme.colors.accent),
    accentSoft: withOpacity(theme.colors.accent, 0.6),
    danger,
    dangerText: contrastText(danger),
  };
}

function builtin(value: unknown): ThemeDefinition {
  const theme = parseThemeDefinition(value);
  if (!theme) throw new Error("内置主题配置无效。");
  return theme;
}

export const BUILTIN_THEMES: ThemeDefinition[] = [airnobeNight, absolutely, oneDark, xcodeDark, calibreNight, warmPaper, calibreDay].map(builtin);
export const BUILTIN_THEME_IDS = new Set(BUILTIN_THEMES.map((theme) => theme.id));
export const DEFAULT_DARK_THEME_ID = "airnobe-night";
export const DEFAULT_LIGHT_THEME_ID = "warm-paper";
export const DEFAULT_THEME_ID = DEFAULT_DARK_THEME_ID;

const CSS_VARIABLES: Record<ThemeColorKey | keyof DerivedThemeColors, string> = {
  background: "--background",
  surface: "--surface",
  sidebar: "--sidebar",
  text: "--text",
  accent: "--accent",
  surfaceRaised: "--surface-raised",
  mutedText: "--muted",
  border: "--line",
  accentText: "--accent-text",
  accentSoft: "--accent-soft",
  danger: "--danger",
  dangerText: "--danger-text",
};

const LEGACY_INLINE_VARIABLES = ["--link", "--reading-text", "--japanese-rule"];

export function applyTheme(theme: ThemeDefinition): void {
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.variant;
  const colors = { ...theme.colors, ...deriveThemeColors(theme) };
  for (const [key, cssVariable] of Object.entries(CSS_VARIABLES)) {
    document.documentElement.style.setProperty(cssVariable, colors[key as keyof typeof colors]);
  }
  for (const cssVariable of LEGACY_INLINE_VARIABLES) document.documentElement.style.removeProperty(cssVariable);
}
