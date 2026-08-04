import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
    await expect(readReaderSettings(settingsPath)).resolves.toEqual({
      version: 1,
      navigation: { backwardTextSteps: 2, forwardTextSteps: 2 },
    });
    await writeFile(settingsPath, "not-json", "utf8");
    await expect(readReaderSettings(settingsPath)).resolves.toEqual({
      version: 1,
      navigation: { backwardTextSteps: 2, forwardTextSteps: 2 },
    });
  });

  it("writes a complete valid user.json", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-settings-"));
    directories.push(directory);
    const settingsPath = join(directory, "nested", "user.json");
    await writeReaderSettings(settingsPath, {
      version: 1,
      navigation: { backwardTextSteps: 4, forwardTextSteps: 7 },
    });
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
      version: 1,
      navigation: { backwardTextSteps: 4, forwardTextSteps: 7 },
    });
  });
});
