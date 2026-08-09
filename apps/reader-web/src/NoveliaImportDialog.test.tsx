import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoveliaImportDialog } from "./NoveliaImportDialog.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NoveliaImportDialog", () => {
  it("shows the fixed settings and uses two-stage Escape from the URL editor", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NoveliaImportDialog onDownload={vi.fn()} onDownloaded={vi.fn()} onClose={onClose} />);
    const input = screen.getByLabelText("小说地址");
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByText("中日 · Sakura → GPT 优先 · EPUB · 中文文件名")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("小说地址输入项")).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the input and dialog open after download failure", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn(async () => { throw new Error("下载失败"); });
    render(<NoveliaImportDialog onDownload={onDownload} onDownloaded={vi.fn()} onClose={vi.fn()} />);
    const input = await screen.findByLabelText("小说地址");
    fireEvent.change(input, { target: { value: "n.novelia.cc/novel/syosetu/test" } });
    await user.click(screen.getByRole("button", { name: "导入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("下载失败");
    expect(input).toHaveValue("n.novelia.cc/novel/syosetu/test");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("passes the downloaded file to the existing import handoff", async () => {
    const user = userEvent.setup();
    const file = new File(["epub"], "下载.epub", { type: "application/epub+zip" });
    const onDownloaded = vi.fn();
    render(<NoveliaImportDialog onDownload={async () => file} onDownloaded={onDownloaded} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => expect(onDownloaded).toHaveBeenCalledWith(file));
  });
});
