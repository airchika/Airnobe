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
    const state = { version: 2 as const, lastReadingBookId: "01234567-89ab-4cde-8fab-0123456789ab", libraryFilter: "reading" as const };
    await writeAppState(statePath, state);
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual(state);
    await expect(readAppState(statePath)).resolves.toEqual(state);
    await writeAppState(statePath, { version: 2, lastReadingBookId: null, libraryFilter: "all" });
    await expect(readAppState(statePath)).resolves.toEqual({ version: 2, lastReadingBookId: null, libraryFilter: "all" });
  });

  it("migrates version 1 without losing the last reading book", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-app-state-"));
    directories.push(directory);
    const statePath = join(directory, "app-state.json");
    await writeFile(statePath, JSON.stringify({ version: 1, lastReadingBookId: "01234567-89ab-4cde-8fab-0123456789ab" }), "utf8");
    await expect(readAppState(statePath)).resolves.toEqual({ version: 2, lastReadingBookId: "01234567-89ab-4cde-8fab-0123456789ab", libraryFilter: "all" });
  });
});
