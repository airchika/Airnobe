import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRecentlyOpened, LibraryView, metadataLanguageClass } from "./LibraryView.js";
import type { LibraryBook } from "./library-client.js";

const base = { sourceSha256: "a".repeat(64), sourceSize: 1024, contentKind: "chinese", coverAssetId: null, annotationStatus: "not-applicable", note: "保留数据", addedAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-02T00:00:00Z" } as const;
const old: LibraryBook = { ...base, id: "01234567-89ab-4cde-8fab-0123456789ab", sourceFileName: "旧书.epub", title: "旧书", authors: ["甲"], collectionStatus: "completed", readingProgress: null };
const recent: LibraryBook = { ...base, id: "11234567-89ab-4cde-8fab-0123456789ab", sourceFileName: "新书.epub", title: "新书", authors: ["乙"], collectionStatus: "reading", readingProgress: { progress: .43, chapterLabel: "第三章", updatedAt: "2026-08-06T00:00:00Z" } };
const defaultFilterProps = { filter: "all" as const, onFilterChange: () => {} };
const renderView = (overrides = {}) => render(<LibraryView books={[old, recent]} selectedBookId={recent.id} onSelect={() => {}} onImport={() => {}} onRead={() => {}} onExport={() => {}} onUpdate={async () => {}} {...defaultFilterProps} {...overrides} />);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LibraryView", () => {
  it("sorts opened books first and exposes sortable three-column headers", () => {
    renderView();
    const list = screen.getByLabelText("书籍列表");
    expect(within(list).getAllByRole("button", { name: /新书|旧书/ })[0]).toHaveTextContent("新书");
    for (const name of ["书名", "状态", /最近打开/]) expect(within(list).getByRole("button", { name })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "作者" })).not.toBeInTheDocument();
  });

  it("shows a book icon action that returns to the last reading session", async () => {
    const user = userEvent.setup();
    const onReturnToReading = vi.fn();
    renderView({ onReturnToReading });
    const button = screen.getByRole("button", { name: "返回阅读" });
    expect(button.querySelector("svg")).toBeInTheDocument();
    await user.click(button);
    expect(onReturnToReading).toHaveBeenCalledOnce();
  });

  it("places the Novelia robot import action last", async () => {
    const user = userEvent.setup();
    const onOpenNovelia = vi.fn();
    renderView({ onOpenNovelia });
    const actions = screen.getByRole("heading", { name: "Airnobe" }).parentElement?.querySelectorAll(".library-header-actions button");
    expect([...actions!].map((button) => button.getAttribute("aria-label"))).toEqual(["导入 EPUB", "设置", "从轻小说机翻机器人导入"]);
    expect(screen.getByRole("button", { name: "从轻小说机翻机器人导入" }).querySelector("img")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "从轻小说机翻机器人导入" }));
    expect(onOpenNovelia).toHaveBeenCalledOnce();
  });

  it("uses the configured fullscreen shortcut in the library", () => {
    const onToggleFullscreen = vi.fn();
    renderView({ fullscreenShortcut: { code: "KeyG" }, onToggleFullscreen });
    fireEvent.keyDown(window, { key: "g", code: "KeyG" });
    expect(onToggleFullscreen).toHaveBeenCalledOnce();
  });

  it("moves up from the top filter or book to the header actions and back down", () => {
    renderView();
    const allFilter = screen.getByRole("button", { name: "全部2" });
    const firstBook = screen.getByRole("button", { name: "新书" });
    const importButton = screen.getByRole("button", { name: "导入 EPUB" });

    allFilter.focus();
    fireEvent.keyDown(window, { key: "w", code: "KeyW" });
    expect(importButton).toHaveFocus();
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(allFilter).toHaveFocus();

    firstBook.focus();
    fireEvent.keyDown(window, { key: "ArrowUp", code: "ArrowUp" });
    expect(importButton).toHaveFocus();
  });

  it("does not automatically select the first result when a filter takes focus", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onFilterChange = vi.fn();
    const view = renderView({ onSelect, onFilterChange });
    const completed = screen.getByRole("button", { name: "看过1" });
    await user.click(completed);
    expect(completed).toHaveFocus();
    expect(onFilterChange).toHaveBeenCalledWith("completed");
    view.rerender(<LibraryView books={[old, recent]} selectedBookId={recent.id} filter="completed" onFilterChange={onFilterChange} onSelect={onSelect} onImport={() => {}} onRead={() => {}} onExport={() => {}} onUpdate={async () => {}} />);
    expect(onSelect).toHaveBeenCalledWith("");
  });

  it("restores an empty saved filter and focuses that filter instead of all", () => {
    renderView({ filter: "dropped" });
    const dropped = screen.getByRole("button", { name: "放弃0" });
    expect(dropped).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("此分类暂无书籍")).toBeInTheDocument();
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

  it("animates details into and out of the fixed detail pane", () => {
    const view = render(<LibraryView books={[old, recent]} selectedBookId={recent.id} onSelect={() => {}} onImport={() => {}} onRead={() => {}} onExport={() => {}} onUpdate={async () => {}} {...defaultFilterProps} />);
    const entering = document.querySelector<HTMLElement>(`.library-detail-layer[data-phase="entering"]`);
    expect(entering).toHaveTextContent("新书");
    fireEvent.animationEnd(entering as HTMLElement);
    expect(document.querySelector(`.library-detail-layer[data-phase="active"]`)).toHaveTextContent("新书");
    view.rerender(<LibraryView books={[old, recent]} selectedBookId="" onSelect={() => {}} onImport={() => {}} onRead={() => {}} onExport={() => {}} onUpdate={async () => {}} {...defaultFilterProps} />);
    const exiting = document.querySelector<HTMLElement>(`.library-detail-layer[data-phase="exiting"]`);
    expect(exiting).toHaveTextContent("新书");
    fireEvent.animationEnd(exiting as HTMLElement);
    expect(document.querySelector(".library-detail-layer")).not.toBeInTheDocument();
  });

  it("crossfades old and new details when the selected book changes", () => {
    const view = render(<LibraryView books={[old, recent]} selectedBookId={recent.id} onSelect={() => {}} onImport={() => {}} onRead={() => {}} onExport={() => {}} onUpdate={async () => {}} {...defaultFilterProps} />);
    fireEvent.animationEnd(document.querySelector(`.library-detail-layer[data-phase="entering"]`) as HTMLElement);
    view.rerender(<LibraryView books={[old, recent]} selectedBookId={old.id} onSelect={() => {}} onImport={() => {}} onRead={() => {}} onExport={() => {}} onUpdate={async () => {}} {...defaultFilterProps} />);
    expect(document.querySelector(`.library-detail-layer[data-phase="exiting"]`)).toHaveTextContent("新书");
    expect(document.querySelector(`.library-detail-layer[data-phase="entering"]`)).toHaveTextContent("旧书");
  });

  it("keeps detail layers mounted through the 500ms animation fallback", () => {
    vi.useFakeTimers();
    renderView();
    expect(document.querySelector(`.library-detail-layer[data-phase="entering"]`)).toHaveTextContent("新书");
    act(() => vi.advanceTimersByTime(500));
    expect(document.querySelector(`.library-detail-layer[data-phase="entering"]`)).toHaveTextContent("新书");
    act(() => vi.advanceTimersByTime(40));
    expect(document.querySelector(`.library-detail-layer[data-phase="active"]`)).toHaveTextContent("新书");
  });

  it("skips detail animation when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    renderView();
    expect(document.querySelector(`.library-detail-layer[data-phase="active"]`)).toHaveTextContent("新书");
    expect(document.querySelector(`.library-detail-layer[data-phase="entering"]`)).not.toBeInTheDocument();
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
    const onExport = vi.fn();
    const onDelete = vi.fn();
    renderView({ onRead, onExport, onDelete });
    const title = screen.getByRole("button", { name: "新书" });
    title.focus();
    await user.keyboard(" ");
    let menu = screen.getByRole("menu", { name: "书籍操作" });
    within(menu).getByRole("button", { name: "导出 EPUB" }).focus();
    await user.keyboard(" ");
    expect(onExport).toHaveBeenCalledWith(recent);
    expect(screen.queryByRole("menu", { name: "书籍操作" })).not.toBeInTheDocument();
    title.focus();
    await user.keyboard(" ");
    menu = screen.getByRole("menu", { name: "书籍操作" });
    within(menu).getByRole("button", { name: "导出 EPUB" }).focus();
    await user.keyboard("{Enter}");
    expect(onExport).toHaveBeenCalledTimes(2);
    title.focus();
    await user.keyboard(" ");
    menu = screen.getByRole("menu", { name: "书籍操作" });
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
