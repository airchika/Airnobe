import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import type { LibraryBook } from "./library-client.js";
import { DEFAULT_READER_SETTINGS } from "./reader-settings.js";
import { createDemoBook } from "./demo-book.js";

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

  it("restores the most recently read book from the library with the shared shortcut", async () => {
    const readBook = { ...libraryBook, readingProgress: { progress: 0.4, chapterLabel: "第二章", updatedAt: "2026-08-08T12:00:00.000Z" } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/library") return json({ version: 1, books: [readBook] });
      if (url === `/api/books/${bookId}`) return json({ error: "test stop" }, 500);
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    expect(await screen.findByRole("button", { name: "返回阅读" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "e", code: "KeyE" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/books/${bookId}`));
  });

  it("opens a valid book even when saving the last-reading app state fails", async () => {
    const user = userEvent.setup();
    const demo = createDemoBook();
    const readBook = { ...libraryBook, readingProgress: { progress: 0.4, chapterLabel: "第二章", updatedAt: "2026-08-08T12:00:00.000Z" } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/app-state" && init?.method === "PUT") return json({ error: "disk full" }, 500);
      if (url === "/api/app-state") return json({ version: 1, lastReadingBookId: bookId });
      if (url === "/api/library") return json({ version: 1, books: [readBook] });
      if (url === `/api/books/${bookId}`) return json({ book: demo.book, documents: demo.documents, readingState: demo.readingState, bookmarkState: demo.bookmarkState });
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "返回阅读" }));
    expect(await screen.findByText("状态未保存")).toBeInTheDocument();
    expect(document.querySelector(".reader-app")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes("/reading-state") && init?.method === "PUT")).toBe(false);
    demo.dispose();
  });

  it("keeps the library operable after the remembered book fails to open", async () => {
    const user = userEvent.setup();
    const demo = createDemoBook();
    const otherBookId = "11234567-89ab-4cde-8fab-0123456789ab";
    const remembered = { ...libraryBook, readingProgress: { progress: 0.4, chapterLabel: null, updatedAt: "2026-08-08T12:00:00.000Z" } };
    const other = { ...libraryBook, id: otherBookId, title: "另一本文", sourceSha256: "b".repeat(64), readingProgress: null };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/app-state" && init?.method === "PUT") return json({ version: 1, lastReadingBookId: otherBookId });
      if (url === "/api/app-state") return json({ version: 1, lastReadingBookId: bookId });
      if (url === "/api/library") return json({ version: 1, books: [remembered, other] });
      if (url === `/api/books/${bookId}`) return json({ error: "damaged book" }, 500);
      if (url === `/api/books/${otherBookId}`) return json({ book: demo.book, documents: demo.documents, readingState: demo.readingState, bookmarkState: demo.bookmarkState });
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "返回阅读" }));
    expect(await screen.findByText("damaged book")).toBeInTheDocument();
    const otherTitle = screen.getByRole("button", { name: "另一本文" });
    otherTitle.focus();
    await user.keyboard(" ");
    await user.click(screen.getByRole("button", { name: "继续阅读" }));
    await waitFor(() => expect(document.querySelector(".reader-app")).toBeInTheDocument());
    demo.dispose();
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

  it("downloads a Novelia EPUB and hands it to the existing import queue", async () => {
    const user = userEvent.setup();
    let libraryReads = 0;
    let importedName = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/library") {
        libraryReads += 1;
        return json({ version: 1, books: libraryReads === 1 ? [] : [libraryBook] });
      }
      if (url === "/api/novelia/epub") return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
        status: 200,
        headers: { "content-type": "application/epub+zip", "x-airnobe-filename": encodeURIComponent("zh-jp.Ysg.再见巫师.epub") },
      });
      if (url === "/api/import-epub") {
        importedName = decodeURIComponent(String((init?.headers as Record<string, string>)["x-airnobe-filename"]));
        return json({ outcome: "imported", bookId });
      }
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    await screen.findByText("书库为空");
    await user.click(screen.getByRole("button", { name: "从轻小说机翻机器人导入" }));
    expect(await screen.findByRole("dialog", { name: "从轻小说机翻机器人导入" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "导入" }));
    expect(await screen.findByRole("heading", { name: "示例书籍" })).toBeInTheDocument();
    expect(importedName).toBe("zh-jp.Ysg.再见巫师.epub");
    expect(screen.queryByRole("dialog", { name: "从轻小说机翻机器人导入" })).not.toBeInTheDocument();
  });

  it("imports multiple selected or dropped EPUB files through one sequential queue", async () => {
    const user = userEvent.setup();
    const importedNames: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/library") return json({ version: 1, books: [] });
      if (url === "/api/import-epub") {
        importedNames.push(decodeURIComponent(String((init?.headers as Record<string, string>)["x-airnobe-filename"])));
        return json({ outcome: "imported", bookId });
      }
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    await screen.findByText("书库为空");
    const first = new File(["one"], "one.epub", { type: "application/epub+zip" });
    const second = new File(["two"], "two.epub", { type: "application/epub+zip" });
    await user.upload(screen.getByLabelText("选择 EPUB 文件"), [first, second]);
    expect(await screen.findByText(/导入 2 本/)).toBeInTheDocument();
    expect(importedNames).toEqual(["one.epub", "two.epub"]);

    const third = new File(["three"], "three.epub", { type: "application/epub+zip" });
    fireEvent.dragEnter(window, { dataTransfer: { types: ["Files"], files: [third] } });
    expect(screen.getByText("松开以导入 EPUB")).toBeInTheDocument();
    fireEvent.drop(window, { dataTransfer: { types: ["Files"], files: [third] } });
    await waitFor(() => expect(importedNames).toEqual(["one.epub", "two.epub", "three.epub"]));
  });

  it("ignores an exact duplicate without running a second conversion", async () => {
    const user = userEvent.setup();
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
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    await screen.findByRole("heading", { name: "示例书籍" });
    await user.upload(
      screen.getByLabelText("选择 EPUB 文件"),
      new File(["epub"], "sample.epub", { type: "application/epub+zip" }),
    );
    expect(await screen.findByText(/忽略 1 本/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "重复书籍" })).not.toBeInTheDocument();
    expect(imports).toBe(1);
  });

  it("offers replace, add, ignore, apply-all, and cancel for a probable duplicate", async () => {
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
    expect(await screen.findByRole("button", { name: "覆盖" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作为新书加入" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "忽略" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /对后续同类冲突/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消剩余导入" }));
    expect(screen.queryByRole("dialog", { name: "重复书籍" })).not.toBeInTheDocument();
  });

  it("applies an ignore decision to later probable duplicates", async () => {
    const user = userEvent.setup();
    let imports = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings") return json(DEFAULT_READER_SETTINGS);
      if (url === "/api/library") return json({ version: 1, books: [] });
      if (url === "/api/import-epub") { imports += 1; return json({ outcome: "possible-duplicate", candidates: [{ id: bookId, title: "旧版本", authors: ["作者"] }] }); }
      return json({ error: "unexpected request" }, 404);
    });
    render(<App />);
    await screen.findByText("书库为空");
    await user.upload(screen.getByLabelText("选择 EPUB 文件"), [new File(["1"], "one.epub"), new File(["2"], "two.epub")]);
    await user.click(await screen.findByRole("button", { name: /对后续同类冲突/ }));
    await user.click(screen.getByRole("button", { name: "忽略" }));
    expect(await screen.findByText(/忽略 2 本/)).toBeInTheDocument();
    expect(imports).toBe(2);
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
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "删除书籍" })).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("button", { name: "示例书籍" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "确认删除" })).toHaveFocus());
    await user.keyboard("d");
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await user.keyboard("a{Enter}");
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
