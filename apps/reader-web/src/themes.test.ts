import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, BUILTIN_THEMES, deriveThemeColors, parseThemeDefinition, THEME_COLOR_KEYS } from "./themes.js";

const LEGACY_DERIVED_COLORS = {
  surfaceRaised: "#25292c",
  mutedText: "#878c8e",
  border: "#dfe5e724",
  accentText: "#000000",
  accentSoft: "#d7a85c2e",
  link: "#d7a85c",
  readingText: "#dfe5e7",
  japaneseRule: "#d7a85c",
  danger: "#ff6b6b",
};

afterEach(() => document.documentElement.removeAttribute("style"));

describe("themes", () => {
  it("loads seven five-color v4 built-in themes", () => {
    expect(BUILTIN_THEMES.map((theme) => theme.id)).toEqual([
      "airnobe-night", "absolutely", "one-dark", "xcode-dark", "calibre-night", "warm-paper", "calibre-day",
    ]);
    expect(BUILTIN_THEMES.every((theme) => theme.version === 4)).toBe(true);
    expect(BUILTIN_THEMES.every((theme) => Object.keys(theme.colors).join(",") === THEME_COLOR_KEYS.join(","))).toBe(true);
    expect(BUILTIN_THEMES.at(-1)?.variant).toBe("light");
    const calibreNight = BUILTIN_THEMES.find((theme) => theme.id === "calibre-night");
    expect(calibreNight?.colors.background).toBe("#121212");
    expect(calibreNight?.colors.sidebar).toBe("#2d2d2d");
  });

  it("rejects missing, unsafe and unknown v4 values", () => {
    const valid = structuredClone(BUILTIN_THEMES[0]!);
    expect(parseThemeDefinition(valid)).toEqual(valid);
    expect(parseThemeDefinition({ ...valid, id: "../theme" })).toBeUndefined();
    expect(parseThemeDefinition({ ...valid, colors: { ...valid.colors, background: "url(x)" } })).toBeUndefined();
    const { sidebar: _sidebar, ...missingSidebar } = valid.colors;
    expect(parseThemeDefinition({ ...valid, colors: missingSidebar })).toBeUndefined();
    expect(parseThemeDefinition({ ...valid, colors: { ...valid.colors, mutedText: "#777777" } })).toBeUndefined();
    expect(parseThemeDefinition({ ...valid, css: "body{}" })).toBeUndefined();
  });

  it("normalizes legacy v1, v2 and v3 themes to the five v4 colors", () => {
    const current = structuredClone(BUILTIN_THEMES[0]!);
    const common = { ...current.colors, ...LEGACY_DERIVED_COLORS };
    const legacyV1 = {
      ...current,
      version: 1,
      colors: { ...common, rubySource: "#bda579", rubyReused: "#112233", rubyGenerated: "#223344", rubyRomaji: "#334455" },
    };
    const legacyV2 = { ...current, version: 2, colors: { ...common, rubySource: "#bda579" } };
    const legacyV3 = { ...current, version: 3, colors: common };
    for (const legacy of [legacyV1, legacyV2, legacyV3]) {
      const parsed = parseThemeDefinition(legacy);
      expect(parsed?.version).toBe(4);
      expect(parsed?.colors).toEqual(current.colors);
    }
  });

  it("derives shared colors with fixed ratios and independent contrast text", () => {
    const theme = BUILTIN_THEMES[0]!;
    expect(deriveThemeColors(theme)).toEqual({
      surfaceRaised: "#25292c",
      mutedText: "#878c8e",
      border: "#dfe5e724",
      accentText: "#000000",
      accentSoft: "#d7a85c99",
      danger: "#ff6b6b",
      dangerText: "#000000",
    });
    expect(deriveThemeColors({ ...theme, colors: { ...theme.colors, accent: "#101010" } }).accentText).toBe("#ffffff");
    expect(deriveThemeColors(BUILTIN_THEMES.find((item) => item.variant === "light")!)).toMatchObject({
      danger: "#b42318",
      dangerText: "#ffffff",
    });
  });

  it("applies core and derived variables while clearing obsolete inline aliases", () => {
    document.documentElement.style.setProperty("--reading-text", "#123456");
    document.documentElement.style.setProperty("--link", "#123456");
    document.documentElement.style.setProperty("--japanese-rule", "#123456");
    applyTheme(BUILTIN_THEMES[0]!);
    expect(document.documentElement.style.getPropertyValue("--surface-raised")).toBe("#25292c");
    expect(document.documentElement.style.getPropertyValue("--danger-text")).toBe("#000000");
    expect(document.documentElement.style.getPropertyValue("--reading-text")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--link")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--japanese-rule")).toBe("");
  });

  it("keeps semantic aliases and limits sidebar color to the reader sidebars", () => {
    const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
    expect(styles).toMatch(/--reading-text:\s*var\(--text\)/);
    expect(styles).toMatch(/--link:\s*var\(--accent\)/);
    expect(styles).toMatch(/--japanese-rule:\s*var\(--accent\)/);
    expect(styles).toMatch(/--focus-fill:\s*color-mix\(in srgb, var\(--accent\) 75%, var\(--surface\)\)/);
    expect(styles).toMatch(/\.library-filters\s*\{[^}]*background:\s*var\(--surface\)/s);
    expect(styles).toMatch(/\.reader-sidebar-toc,\s*\n\.reader-sidebar-settings\s*\{[^}]*background:\s*var\(--sidebar\)/s);
    expect(styles).toContain("color: var(--danger-text); background: var(--danger)");
    expect(styles).toMatch(/progress::?-webkit-progress-bar[^}]*background:\s*var\(--background\)/s);
    expect(styles).toMatch(/progress::?-webkit-progress-value[^}]*background:\s*var\(--accent\)/s);
    expect(styles).toMatch(/\.reader-bookmarks li\s*\{[^}]*background:\s*var\(--surface\)/s);
    expect(styles).toMatch(/\.reader-bookmarks \.bookmark-target\s*\{[^}]*background:\s*transparent/s);
    expect(styles).toMatch(/\.reader-bookmarks \.bookmark-target:hover\s*\{[^}]*background:\s*var\(--hover-fill\)/s);
    expect(styles).toMatch(/\.reader-bookmarks \.bookmark-target:focus-visible\s*\{[^}]*background:\s*var\(--focus-fill\)/s);
    expect(styles).toMatch(/\.text-block > \.content-variant--ja::before\s*\{\s*top:\s*0\.25em;\s*bottom:\s*0\.25em;/s);
    expect(styles).toMatch(/\.japanese-collapse::before\s*\{\s*top:\s*0\.9em;\s*bottom:\s*0\.3em;/s);
  });
});
