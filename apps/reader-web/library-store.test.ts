import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoBook } from "./src/demo-book.js";
import {
  createLibraryEntry,
  emptyLibraryIndex,
  findExactDuplicate,
  findProbableDuplicates,
  readLibraryIndex,
  updateLibraryEntry,
  writeLibraryIndexAtomically,
} from "./library-store.js";

const directories: string[] = [];
const id = "01234567-89ab-4cde-8fab-0123456789ab";
const hash = "a".repeat(64);

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function entry() {
  const book = structuredClone(createDemoBook().book);
  book.source.sha256 = hash;
  book.source.identifier = "urn:fixture:one";
  book.metadata.title = "测试 书籍";
  book.metadata.authors = ["测试作者"];
  return createLibraryEntry({
    id,
    book,
    sourceFileName: "原书.epub",
    sourceSize: 123,
    annotationStatus: "ready",
    now: "2026-08-05T00:00:00.000Z",
  });
}

describe("library store", () => {
  it("writes and reads a versioned index atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-library-"));
    directories.push(directory);
    const path = join(directory, "library.json");
    const index = { version: 1 as const, books: [entry()] };
    await writeLibraryIndexAtomically(path, index);
    await expect(readLibraryIndex(path)).resolves.toEqual(index);
    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
  });

  it("returns an empty index only when library.json is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-library-"));
    directories.push(directory);
    const path = join(directory, "library.json");
    await expect(readLibraryIndex(path)).resolves.toEqual(emptyLibraryIndex());
    await writeFile(path, "not-json", "utf8");
    await expect(readLibraryIndex(path)).rejects.toBeTruthy();
  });

  it("distinguishes exact hashes from probable metadata matches", () => {
    const existing = entry();
    const index = { version: 1 as const, books: [existing] };
    expect(findExactDuplicate(index, hash)?.id).toBe(id);
    expect(findExactDuplicate(index, "b".repeat(64))).toBeUndefined();
    expect(findProbableDuplicates(index, {
      sourceSha256: "b".repeat(64),
      title: "  测试　书籍 ",
      authors: ["测试作者"],
    })).toEqual([existing]);
    expect(findProbableDuplicates(index, {
      sourceSha256: "b".repeat(64),
      title: "不同标题",
      authors: ["其他作者"],
      identifier: "URN:FIXTURE:ONE",
    })).toEqual([existing]);
  });

  it("preserves mutable library state when replacing a source", () => {
    const previous = { ...entry(), collectionStatus: "reading" as const, note: "保留备注" };
    const book = structuredClone(createDemoBook().book);
    book.source.sha256 = "b".repeat(64);
    const replacement = createLibraryEntry({
      book,
      sourceFileName: "新版.epub",
      sourceSize: 456,
      annotationStatus: "not-applicable",
      previous,
      now: "2026-08-06T00:00:00.000Z",
    });
    expect(replacement.id).toBe(previous.id);
    expect(replacement.collectionStatus).toBe("reading");
    expect(replacement.note).toBe("保留备注");
    expect(replacement.addedAt).toBe(previous.addedAt);
    expect(replacement.updatedAt).not.toBe(previous.updatedAt);
  });

  it("updates only mutable library state and refreshes updatedAt", () => {
    const original = entry();
    const result = updateLibraryEntry(
      { version: 1, books: [original] },
      id,
      { collectionStatus: "reading", note: "正在读" },
      "2026-08-06T00:00:00.000Z",
    );
    expect(result?.entry).toEqual({
      ...original,
      collectionStatus: "reading",
      note: "正在读",
      updatedAt: "2026-08-06T00:00:00.000Z",
    });
    expect(result?.index.books).toEqual([result?.entry]);
    expect(updateLibraryEntry({ version: 1, books: [original] }, crypto.randomUUID(), { note: "missing" })).toBeUndefined();
  });
});
