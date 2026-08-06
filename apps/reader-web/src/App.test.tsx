import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { createDemoBook } from "./demo-book.js";
import type { LibraryBook } from "./library-client.js";
import { DEFAULT_READER_SETTINGS } from "./reader-settings.js";

describe("App", () => {
  const bookId = "01234567-89ab-4cde-8fab-0123456789ab";
  const libraryBook: LibraryBook = {
    id: bookId,
    sourceSha256: "a".repeat(64),
    sourceFileName: "sample.epub",
    sourceSize: 1234,
    title: "示例书籍",
    authors: ["作者"],
    contentKind: "parallel",
    coverAssetId: null,
    annotationStatus: "ready",
    collectionStatus: "wish",
    note: "",
    addedAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    readingProgress: null,
  };

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("opens into the minimal library view", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/library") return json({ version: 1, books: [] });
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    expect(screen.getByRole("heading", { name: "Airnobe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入 EPUB" })).toBeInTheDocument();
    expect(await screen.findByText("书库为空")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开转换结果" })).not.toBeInTheDocument();
  });

  it("imports an EPUB, stays in the library, and selects the new book", async () => {
    const user = userEvent.setup();
    let libraryReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/library") {
        libraryReads += 1;
        return json({ version: 1, books: libraryReads === 1 ? [] : [libraryBook] });
      }
      if (url === "/api/import-epub") return json({ outcome: "imported", bookId });
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    await screen.findByText("书库为空");
    await user.upload(
      screen.getByLabelText("选择 EPUB 文件"),
      new File(["epub"], "sample.epub", { type: "application/epub+zip" }),
    );
    expect(await screen.findByRole("heading", { name: "示例书籍" })).toBeInTheDocument();
    expect(document.querySelector(".reader-app")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: "示例书籍" }));
    expect(screen.getByRole("link", { name: "导出 EPUB" })).toHaveAttribute("href", `/api/books/${bookId}/source`);
    expect(screen.getByRole("link", { name: "导出 EPUB" })).toHaveAttribute("download", "sample.epub");
  });

  it("asks before opening an exact duplicate and avoids a second conversion", async () => {
    const user = userEvent.setup();
    const demo = createDemoBook();
    let imports = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/library") return json({ version: 1, books: [libraryBook] });
      if (url === "/api/import-epub") {
        imports += 1;
        return json({
          outcome: "exact-duplicate",
          book: { id: bookId, title: "已存在的书", authors: ["作者"] },
        });
      }
      if (url === `/api/books/${bookId}`) return json({ book: demo.book, documents: demo.documents, report: demo.report });
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    await screen.findByRole("heading", { name: "示例书籍" });
    await user.upload(
      screen.getByLabelText("选择 EPUB 文件"),
      new File(["epub"], "sample.epub", { type: "application/epub+zip" }),
    );
    expect(await screen.findByRole("dialog", { name: "重复书籍" })).toHaveTextContent("这本书已在书库中");
    expect(screen.getByText("已存在的书")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开已有书" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "第一章　雨后" })).toBeInTheDocument());
    expect(imports).toBe(1);
  });

  it("offers replace, add, and cancel for a probable duplicate", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/library") return json({ version: 1, books: [] });
      if (url === "/api/import-epub") return json({
        outcome: "possible-duplicate",
        candidates: [{ id: bookId, title: "旧版本", authors: ["作者"] }],
      });
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    await screen.findByText("书库为空");
    await user.upload(
      screen.getByLabelText("选择 EPUB 文件"),
      new File(["epub"], "sample.epub", { type: "application/epub+zip" }),
    );
    expect(await screen.findByRole("button", { name: "替换" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "另存为新书" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "替换" })).toHaveFocus());
    await user.keyboard("d");
    expect(screen.getByRole("button", { name: "另存为新书" })).toHaveFocus();
    await user.keyboard("d");
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.queryByRole("dialog", { name: "重复书籍" })).not.toBeInTheDocument();
  });

  it("confirms permanent deletion from the row action menu", async () => {
    const user = userEvent.setup();
    let libraryReads = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/library") {
        libraryReads += 1;
        return json({ version: 1, books: libraryReads < 2 ? [libraryBook] : [] });
      }
      if (url === `/api/library/books/${bookId}` && init?.method === "DELETE") return json({ deletedBookId: bookId });
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    await screen.findByRole("heading", { name: "示例书籍" });

    fireEvent.contextMenu(screen.getByRole("button", { name: "示例书籍" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "删除书籍" });
    expect(dialog).toHaveTextContent("保存的原始 EPUB 都会被永久删除");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "删除书籍" })).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("button", { name: "示例书籍" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("书库为空")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/library/books/${bookId}`, { method: "DELETE" });
  });

  it("gives an error toast temporary keyboard priority and closes it with Space", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings") return json({ error: "设置损坏" }, 500);
      if (url === "/api/library") return json({ version: 1, books: [] });
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    const close = await screen.findByRole("button", { name: "关闭错误" });
    await waitFor(() => expect(close).toHaveFocus());
    await user.keyboard(" ");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
