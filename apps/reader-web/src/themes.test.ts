import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, parseThemeDefinition } from "./themes.js";

describe("themes", () => {
  it("loads five complete built-in themes", () => {
    expect(BUILTIN_THEMES.map((theme) => theme.id)).toEqual([
      "airnobe-night", "absolutely", "one-dark", "xcode-dark", "warm-paper",
    ]);
    expect(BUILTIN_THEMES.at(-1)?.variant).toBe("light");
  });

  it("rejects unsafe values and unknown tokens", () => {
    const valid = structuredClone(BUILTIN_THEMES[0]!);
    expect(parseThemeDefinition(valid)).toEqual(valid);
    expect(parseThemeDefinition({ ...valid, id: "../theme" })).toBeUndefined();
    expect(parseThemeDefinition({ ...valid, colors: { ...valid.colors, background: "url(x)" } })).toBeUndefined();
    expect(parseThemeDefinition({ ...valid, colors: { ...valid.colors, customCss: "body{}" } })).toBeUndefined();
    expect(parseThemeDefinition({ ...valid, css: "body{}" })).toBeUndefined();
  });

  it("normalizes legacy v1 themes while dropping obsolete ruby colors", () => {
    const current = structuredClone(BUILTIN_THEMES[0]!);
    const legacy = {
      ...current,
      version: 1,
      colors: { ...current.colors, rubyReused: "#112233", rubyGenerated: "#223344", rubyRomaji: "#334455" },
    };
    const parsed = parseThemeDefinition(legacy);
    expect(parsed?.version).toBe(2);
    expect(parsed?.colors).not.toHaveProperty("rubyReused");
    expect(parseThemeDefinition({ ...current, colors: { ...current.colors, rubyReused: "#112233" } })).toBeUndefined();
  });
});
