import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addBookmark, deleteBookmark, readBookmarkState } from "./bookmark-store.js";
import { EMPTY_BOOKMARK_STATE } from "./src/bookmarks.js";

const directories: string[] = [];
const position = { documentId: "document-1", blockId: "block-2", viewportOffset: -18, progress: 0.4, chapterLabel: "第二章" };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("bookmark store", () => {
  it("treats missing and damaged files as empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-bookmarks-"));
    directories.push(directory);
    const statePath = join(directory, "bookmarks.json");
    await expect(readBookmarkState(statePath)).resolves.toEqual(EMPTY_BOOKMARK_STATE);
    await writeFile(statePath, "broken", "utf8");
    await expect(readBookmarkState(statePath)).resolves.toEqual(EMPTY_BOOKMARK_STATE);
  });

  it("atomically creates, deduplicates and deletes bookmarks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-bookmarks-"));
    directories.push(directory);
    const statePath = join(directory, "bookmarks.json");
    const id = "01234567-89ab-4cde-8fab-0123456789ab";
    const created = await addBookmark(statePath, { position, excerpt: "正文摘要" }, id, "2026-08-09T00:00:00.000Z");
    expect(created.outcome).toBe("created");
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual(created.state);
    const duplicate = await addBookmark(statePath, { position: { ...position, viewportOffset: 2 }, excerpt: "不同摘要" });
    expect(duplicate).toEqual({ outcome: "duplicate", state: created.state });
    await expect(deleteBookmark(statePath, id)).resolves.toEqual(EMPTY_BOOKMARK_STATE);
  });
});
