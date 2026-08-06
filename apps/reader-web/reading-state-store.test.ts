import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_READING_STATE } from "./src/reading-state.js";
import { readReadingState, writeReadingState } from "./reading-state-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("reading state store", () => {
  it("treats missing and damaged state as unread", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-reading-state-"));
    directories.push(directory);
    const statePath = join(directory, "reading-state.json");
    await expect(readReadingState(statePath)).resolves.toEqual(EMPTY_READING_STATE);
    await writeFile(statePath, "not-json", "utf8");
    await expect(readReadingState(statePath)).resolves.toEqual(EMPTY_READING_STATE);
  });

  it("atomically writes a complete state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-reading-state-"));
    directories.push(directory);
    const statePath = join(directory, "reading-state.json");
    const state = await writeReadingState(statePath, {
      documentId: "document-1",
      blockId: "block-9",
      viewportOffset: -24.5,
      progress: 0.75,
      chapterLabel: "第三章",
    }, "2026-08-06T12:00:00.000Z");
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual(state);
    expect(await readReadingState(statePath)).toEqual(state);
  });
});
