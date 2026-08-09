import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAppState, writeAppState } from "./app-state-store.js";
import { EMPTY_APP_STATE } from "./src/app-state.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("app state store", () => {
  it("treats missing and damaged state as empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-app-state-"));
    directories.push(directory);
    const statePath = join(directory, "app-state.json");
    await expect(readAppState(statePath)).resolves.toEqual(EMPTY_APP_STATE);
    await writeFile(statePath, "not-json", "utf8");
    await expect(readAppState(statePath)).resolves.toEqual(EMPTY_APP_STATE);
  });

  it("atomically writes a complete state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-app-state-"));
    directories.push(directory);
    const statePath = join(directory, "nested", "app-state.json");
    const state = { version: 1 as const, lastReadingBookId: "01234567-89ab-4cde-8fab-0123456789ab" };
    await writeAppState(statePath, state);
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual(state);
    await expect(readAppState(statePath)).resolves.toEqual(state);
    await writeAppState(statePath, { version: 1, lastReadingBookId: null });
    await expect(readAppState(statePath)).resolves.toEqual({ version: 1, lastReadingBookId: null });
  });
});
