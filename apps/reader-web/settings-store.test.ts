import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_READER_SETTINGS } from "./src/reader-settings.js";
import { readReaderSettings, writeReaderSettings } from "./settings-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("reader settings store", () => {
  it("returns defaults for a missing or invalid user.json", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-settings-"));
    directories.push(directory);
    const settingsPath = join(directory, "user.json");
    await expect(readReaderSettings(settingsPath)).resolves.toEqual(DEFAULT_READER_SETTINGS);
    await writeFile(settingsPath, "not-json", "utf8");
    await expect(readReaderSettings(settingsPath)).resolves.toEqual(DEFAULT_READER_SETTINGS);
  });

  it("migrates v1 while preserving page transitions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-settings-"));
    directories.push(directory);
    const settingsPath = join(directory, "user.json");
    await writeFile(settingsPath, JSON.stringify({
      version: 1,
      navigation: { backwardTextSteps: 4, forwardTextSteps: 7 },
      pageTransitions: true,
    }), "utf8");
    await expect(readReaderSettings(settingsPath)).resolves.toEqual({ ...DEFAULT_READER_SETTINGS, pageTransitions: true });
  });

  it("writes a complete valid v4 user.json", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-settings-"));
    directories.push(directory);
    const settingsPath = join(directory, "nested", "user.json");
    const settings = structuredClone(DEFAULT_READER_SETTINGS);
    settings.navigation.textSteps = 4;
    settings.shortcuts.topBackward = { code: "ArrowUp", modifier: "Control" };
    settings.pageTransitions = true;
    await writeReaderSettings(settingsPath, settings);
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual(settings);
  });
});
