import { describe, expect, it, vi } from "vitest";
import { loadBookFromFiles } from "./book-source.js";
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
    loaded.dispose();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("rejects a selection without book.json", async () => {
    await expect(loadBookFromFiles([directoryFile("documents/0000.json", "{}")])).rejects.toThrow(/没有 book\.json/);
  });
});
