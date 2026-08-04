import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { createDemoBook } from "./demo-book.js";
import { DEFAULT_READER_SETTINGS } from "./reader-settings.js";

describe("App", () => {
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
      if (url === "/api/import-epub") return new Response(JSON.stringify({ bookId: "0123456789abcdef" }), {
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
    expect(screen.getByRole("button", { name: /日文/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /注音/ })).toBeEnabled();
  });
});
