import { afterEach, describe, expect, it, vi } from "vitest";
import { coverUrl, loadLibrary, sourceEpubUrl, updateLibraryBook, type LibraryBook } from "./library-client.js";

const book: LibraryBook = {
  id: "01234567-89ab-4cde-8fab-0123456789ab",
  sourceSha256: "a".repeat(64),
  sourceFileName: "sample.epub",
  sourceSize: 123,
  title: "示例",
  authors: [],
  contentKind: "japanese",
  coverAssetId: "abc.jpg",
  annotationStatus: "ready",
  collectionStatus: "wish",
  note: "",
  addedAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  readingProgress: null,
};

afterEach(() => vi.restoreAllMocks());

describe("library client", () => {
  it("loads the versioned library and derives public book URLs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: 1, books: [book] })));
    await expect(loadLibrary()).resolves.toEqual([book]);
    expect(fetch).toHaveBeenCalledWith("/api/library");
    expect(coverUrl(book)).toBe(`/api/books/${book.id}/assets/abc.jpg`);
    expect(sourceEpubUrl(book)).toBe(`/api/books/${book.id}/source`);
    expect(coverUrl({ ...book, coverAssetId: null })).toBeUndefined();
  });

  it("patches only the requested mutable values", async () => {
    const updated = { ...book, collectionStatus: "reading" as const };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(updated)));
    await expect(updateLibraryBook(book.id, { collectionStatus: "reading" })).resolves.toEqual(updated);
    expect(fetch).toHaveBeenCalledWith(`/api/library/books/${book.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collectionStatus: "reading" }),
    });
  });

  it("rejects malformed library responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: 1, books: [{ id: "bad" }] })));
    await expect(loadLibrary()).rejects.toThrow("书库响应不符合当前格式");
  });
});
