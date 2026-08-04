import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { createDemoBook } from "./demo-book.js";
import { DEFAULT_READER_SETTINGS } from "./reader-settings.js";

describe("App", () => {
  const bookId = "01234567-89ab-4cde-8fab-0123456789ab";
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the welcome screen minimal and EPUB-first", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Airnobe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开 EPUB" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开转换结果" })).toBeInTheDocument();
    expect(screen.queryByText(/从中文开始/)).not.toBeInTheDocument();
  });

  it("imports a selected EPUB through the local service", async () => {
    const user = userEvent.setup();
    const demo = createDemoBook();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings") return new Response(JSON.stringify(DEFAULT_READER_SETTINGS), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      if (url === "/api/import-epub") return new Response(JSON.stringify({ outcome: "imported", bookId }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      return new Response(JSON.stringify({
        book: demo.book,
        documents: demo.documents,
        report: demo.report,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    render(<App />);
    await user.upload(
      screen.getByLabelText("选择 EPUB 文件"),
      new File(["epub"], "sample.epub", { type: "application/epub+zip" }),
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "第一章　雨后" })).toBeInTheDocument());
    const reader = document.querySelector(".reader-app");
    expect(reader).toBeInTheDocument();
    if (reader) await user.pointer({ target: reader, keys: "[MouseRight]" });
    expect(screen.getByRole("link", { name: "导出原始 EPUB" })).toHaveAttribute("href", `/api/books/${bookId}/source`);
    expect(screen.getByRole("button", { name: /日文/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /注音/ })).toBeEnabled();
  });

  it("asks before opening an exact duplicate and avoids a second conversion", async () => {
    const user = userEvent.setup();
    const demo = createDemoBook();
    let imports = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings") return new Response(JSON.stringify(DEFAULT_READER_SETTINGS));
      if (url === "/api/import-epub") {
        imports += 1;
        return new Response(JSON.stringify({
          outcome: "exact-duplicate",
          book: { id: bookId, title: "已存在的书", authors: ["作者"] },
        }));
      }
      return new Response(JSON.stringify({ book: demo.book, documents: demo.documents, report: demo.report }));
    });
    render(<App />);
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
      if (String(input) === "/api/settings") return new Response(JSON.stringify(DEFAULT_READER_SETTINGS));
      return new Response(JSON.stringify({
        outcome: "possible-duplicate",
        candidates: [{ id: bookId, title: "旧版本", authors: ["作者"] }],
      }));
    });
    render(<App />);
    await user.upload(
      screen.getByLabelText("选择 EPUB 文件"),
      new File(["epub"], "sample.epub", { type: "application/epub+zip" }),
    );
    expect(await screen.findByRole("button", { name: "替换" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "另存为新书" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });
});
