import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRecentlyOpened, LibraryView, metadataLanguageClass } from "./LibraryView.js";
import type { LibraryBook } from "./library-client.js";

const base = { sourceSha256: "a".repeat(64), sourceSize: 1024, contentKind: "chinese", coverAssetId: null, annotationStatus: "not-applicable", note: "保留数据", addedAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-02T00:00:00Z" } as const;
const old: LibraryBook = { ...base, id: "01234567-89ab-4cde-8fab-0123456789ab", sourceFileName: "旧书.epub", title: "旧书", authors: ["甲"], collectionStatus: "completed", readingProgress: null };
const recent: LibraryBook = { ...base, id: "11234567-89ab-4cde-8fab-0123456789ab", sourceFileName: "新书.epub", title: "新书", authors: ["乙"], collectionStatus: "reading", readingProgress: { progress: .43, chapterLabel: "第三章", updatedAt: "2026-08-06T00:00:00Z" } };
const renderView = (overrides = {}) => render(<LibraryView books={[old, recent]} selectedBookId={recent.id} onSelect={() => {}} onImport={() => {}} onRead={() => {}} onUpdate={async () => {}} {...overrides} />);

afterEach(cleanup);

describe("LibraryView", () => {
  it("sorts opened books first and exposes sortable three-column headers", () => {
    renderView();
    const list = screen.getByLabelText("书籍列表");
    expect(within(list).getAllByRole("button", { name: /新书|旧书/ })[0]).toHaveTextContent("新书");
    for (const name of ["书名", "状态", /最近打开/]) expect(within(list).getByRole("button", { name })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "作者" })).not.toBeInTheDocument();
  });

  it("does not automatically select the first result when a filter takes focus", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderView({ onSelect });
    const completed = screen.getByRole("button", { name: "看过1" });
    await user.click(completed);
    expect(completed).toHaveFocus();
    expect(onSelect).toHaveBeenCalledWith("");
  });

  it("keeps details informational and applies Japanese metadata fonts", () => {
    renderView();
    const detail = screen.getByLabelText("书籍详情");
    expect(detail).toHaveTextContent("纯中文 · 无需程序注音 · 1.0 KB");
    expect(detail).toHaveTextContent("43% · 第三章");
    expect(within(detail).queryByRole("button")).not.toBeInTheDocument();
    expect(metadataLanguageClass({ ...recent, contentKind: "parallel" }, "告白")).toBe("font-japanese");
    expect(metadataLanguageClass(recent, "カタカナ")).toBe("font-japanese");
  });

  it("opens status picker from the action menu and updates the selected status", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn(async () => {});
    renderView({ onUpdate });
    fireEvent.contextMenu(screen.getByRole("button", { name: "新书" }));
    await user.click(screen.getByRole("button", { name: "修改状态" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("menu", { name: "书籍操作" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "修改状态" }));
    const picker = screen.getByRole("menu", { name: "选择收藏状态" });
    await user.click(within(picker).getByRole("button", { name: "看过" }));
    expect(onUpdate).toHaveBeenCalledWith(recent.id, { collectionStatus: "completed" });
  });

  it("opens the book menu with Space or right click and invokes its actions", async () => {
    const user = userEvent.setup();
    const onRead = vi.fn();
    const onDelete = vi.fn();
    renderView({ onRead, onDelete });
    const title = screen.getByRole("button", { name: "新书" });
    title.focus();
    await user.keyboard(" ");
    let menu = screen.getByRole("menu", { name: "书籍操作" });
    expect(within(menu).getByRole("link", { name: "导出 EPUB" })).toHaveAttribute("download", "新书.epub");
    await user.click(within(menu).getByRole("button", { name: "继续阅读" }));
    expect(onRead).toHaveBeenCalledWith(recent.id, "continue");
    fireEvent.contextMenu(title, { clientX: 20, clientY: 30 });
    menu = screen.getByRole("menu", { name: "书籍操作" });
    await user.click(within(menu).getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith(recent.id);
  });

  it("formats recent reading time without using library updatedAt", () => {
    expect(formatRecentlyOpened(old, new Date("2026-08-06T12:00:00Z"))).toBe("未打开");
    expect(formatRecentlyOpened(recent, new Date("2026-08-06T12:00:00Z"))).toBe("12小时前");
    expect(formatRecentlyOpened({ ...recent, readingProgress: { ...recent.readingProgress!, updatedAt: "2026-08-06T11:58:00Z" } }, new Date("2026-08-06T12:00:00Z"))).toBe("2分钟前");
    expect(formatRecentlyOpened({ ...recent, readingProgress: { ...recent.readingProgress!, updatedAt: "2026-06-06T12:00:00Z" } }, new Date("2026-08-06T12:00:00Z"))).toBe("2月前");
  });
});
