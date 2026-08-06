import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_THEMES } from "./src/themes.js";
import { readCustomThemes, writeCustomTheme } from "./theme-store.js";

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("theme store", () => {
  it("writes and reloads a complete custom theme atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-themes-"));
    temporaryDirectories.push(directory);
    const theme = structuredClone(BUILTIN_THEMES[0]);
    if (!theme) throw new Error("Missing theme fixture.");
    theme.id = "custom-night";
    theme.name = "Custom Night";
    await writeCustomTheme(directory, theme);
    expect(await readCustomThemes(directory)).toEqual([theme]);
    expect(JSON.parse(await readFile(join(directory, "custom-night.json"), "utf8"))).toEqual(theme);
  });

  it("ignores damaged files and refuses to replace built-ins", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-themes-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "broken.json"), "{", "utf8");
    expect(await readCustomThemes(directory)).toEqual([]);
    const builtin = BUILTIN_THEMES[0];
    if (!builtin) throw new Error("Missing theme fixture.");
    await expect(writeCustomTheme(directory, builtin)).rejects.toThrow(/内置主题/);
  });

  it("reads legacy v1 files as normalized v2 themes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-themes-"));
    temporaryDirectories.push(directory);
    const current = structuredClone(BUILTIN_THEMES[0]!);
    const legacy = { ...current, version: 1, id: "legacy-night", colors: { ...current.colors, rubyReused: "#112233", rubyGenerated: "#223344", rubyRomaji: "#334455" } };
    await writeFile(join(directory, "legacy-night.json"), JSON.stringify(legacy), "utf8");
    const [theme] = await readCustomThemes(directory);
    expect(theme?.version).toBe(2);
    expect(theme?.colors).not.toHaveProperty("rubyGenerated");
  });
});
