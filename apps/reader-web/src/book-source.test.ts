import { describe, expect, it, vi } from "vitest";
import { loadBookFromFiles, saveReadingPosition } from "./book-source.js";
import { createDemoBook } from "./demo-book.js";

function directoryFile(relativePath: string, contents: string, type = "application/json"): File {
  const file = new File([contents], relativePath.split("/").at(-1) ?? "file", { type });
  Object.defineProperty(file, "webkitRelativePath", { value: `selected-book/${relativePath}` });
  Object.defineProperty(file, "text", { value: async () => contents });
  return file;
}

describe("loadBookFromFiles", () => {
  it("loads and validates a selected converted-book directory", async () => {
    const demo = createDemoBook();
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const loaded = await loadBookFromFiles([
      directoryFile("book.json", JSON.stringify(demo.book)),
      directoryFile("documents/0000.json", JSON.stringify(demo.documents[0])),
      directoryFile("report.json", JSON.stringify(demo.report)),
    ]);
    expect(loaded.book.metadata.title).toBe("Airnobe 阅读演示");
    expect(loaded.documents).toHaveLength(1);
    expect(loaded.sourceLabel).toBe("selected-book");
    expect(loaded.readingState.position).toBeNull();
    loaded.dispose();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("saves a validated reading position for a library book", async () => {
    const bookId = "01234567-89ab-4cde-8fab-0123456789ab";
    const position = {
      documentId: "document-1",
      blockId: "block-2",
      viewportOffset: 24,
      progress: 0.5,
      chapterLabel: "第二章",
    };
    const state = { version: 1, position, updatedAt: "2026-08-06T00:00:00.000Z" } as const;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(state)));
    await expect(saveReadingPosition(bookId, position)).resolves.toEqual(state);
    expect(fetch).toHaveBeenCalledWith(`/api/books/${bookId}/reading-state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ position }),
    });
  });

  it("rejects a selection without book.json", async () => {
    await expect(loadBookFromFiles([directoryFile("documents/0000.json", "{}")])).rejects.toThrow(/没有 book\.json/);
  });

  it("asks the user to reimport an old converted-book directory", async () => {
    const demo = createDemoBook();
    const oldBook = { ...demo.book, version: 1 };
    await expect(loadBookFromFiles([
      directoryFile("book.json", JSON.stringify(oldBook)),
      directoryFile("documents/0000.json", JSON.stringify(demo.documents[0])),
    ])).rejects.toThrow(/旧版.*重新导入原始 EPUB/);
  });
});
