import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryView } from "./LibraryView.js";
import type { LibraryBook } from "./library-client.js";

const first: LibraryBook = {
  id: "01234567-89ab-4cde-8fab-0123456789ab",
  sourceSha256: "a".repeat(64),
  sourceFileName: "旧书.epub",
  sourceSize: 1024,
  title: "旧书",
  authors: ["甲"],
  contentKind: "chinese",
  coverAssetId: null,
  annotationStatus: "not-applicable",
  collectionStatus: "completed",
  note: "已经读完",
  addedAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  readingProgress: null,
};

const second: LibraryBook = {
  id: "11234567-89ab-4cde-8fab-0123456789ab",
  sourceSha256: "b".repeat(64),
  sourceFileName: "新书.epub",
  sourceSize: 2 * 1024 * 1024,
  title: "新书",
  authors: ["乙"],
  contentKind: "parallel",
  coverAssetId: "cover.jpg",
  annotationStatus: "ready",
  collectionStatus: "wish",
  note: "准备开始",
  addedAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  readingProgress: null,
};

afterEach(cleanup);

describe("LibraryView", () => {
  it("sorts by recent update, shows counts, filters, and selects visible books", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <LibraryView
        books={[first, second]}
        selectedBookId={second.id}
        onSelect={onSelect}
        onImport={() => {}}
        onRead={() => {}}
        onUpdate={async () => {}}
      />,
    );
    const rows = within(screen.getByLabelText("书籍列表")).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual(["新书准备开始想看", "旧书已经读完看过"]);
    const filters = screen.getByLabelText("藏书状态");
    expect(within(filters).getByRole("button", { name: "全部2" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "想看1" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "看过1" })).toBeInTheDocument();

    await user.click(within(filters).getByRole("button", { name: "看过1" }));
    expect(screen.getByLabelText("书籍列表")).toHaveTextContent("旧书");
    expect(onSelect).toHaveBeenLastCalledWith(first.id);

    rerender(
      <LibraryView
        books={[first, second]}
        selectedBookId={first.id}
        onSelect={onSelect}
        onImport={() => {}}
        onRead={() => {}}
        onUpdate={async () => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "旧书" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("supports selection, double-click reading, cover, and original EPUB export", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRead = vi.fn();
    render(
      <LibraryView
        books={[first, second]}
        selectedBookId={second.id}
        onSelect={onSelect}
        onImport={() => {}}
        onRead={onRead}
        onUpdate={async () => {}}
      />,
    );
    expect(screen.getByRole("img", { name: "新书封面" })).toHaveAttribute(
      "src",
      `/api/books/${second.id}/assets/cover.jpg`,
    );
    const exportLink = screen.getByRole("link", { name: "导出 EPUB" });
    expect(exportLink).toHaveAttribute("href", `/api/books/${second.id}/source`);
    expect(exportLink).toHaveAttribute("download", "新书.epub");
    await user.click(screen.getByRole("button", { name: "继续阅读" }));
    expect(onRead).toHaveBeenCalledWith(second.id, "continue");
    await user.click(screen.getByRole("button", { name: "从头阅读" }));
    expect(onRead).toHaveBeenCalledWith(second.id, "beginning");
    await user.dblClick(within(screen.getByLabelText("书籍列表")).getByRole("button", { name: /旧书/ }));
    expect(onRead).toHaveBeenLastCalledWith(first.id);
  });

  it("offers stored-source reimport and current-book deletion", async () => {
    const user = userEvent.setup();
    const onReimport = vi.fn();
    const onDelete = vi.fn();
    render(
      <LibraryView
        books={[second]}
        selectedBookId={second.id}
        onSelect={() => {}}
        onImport={() => {}}
        onRead={() => {}}
        onUpdate={async () => {}}
        onReimport={onReimport}
        onDelete={onDelete}
      />,
    );
    await user.click(screen.getByRole("button", { name: "重新导入" }));
    expect(onReimport).toHaveBeenCalledWith(second.id);
    await user.click(screen.getByRole("button", { name: "删除当前书籍" }));
    expect(onDelete).toHaveBeenCalledWith(second.id);
  });

  it("navigates the three-column library with WASD and opens the focused book with Space", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRead = vi.fn();
    render(
      <LibraryView
        books={[first, second]}
        selectedBookId={second.id}
        onSelect={onSelect}
        onImport={() => {}}
        onRead={onRead}
        onUpdate={async () => {}}
      />,
    );
    const list = screen.getByLabelText("书籍列表");
    const newBook = within(list).getByRole("button", { name: /新书/ });
    const oldBook = within(list).getByRole("button", { name: /旧书/ });
    await waitFor(() => expect(newBook).toHaveFocus());

    await user.keyboard("w");
    expect(oldBook).toHaveFocus();
    expect(onSelect).toHaveBeenLastCalledWith(first.id);
    await user.keyboard(" ");
    expect(onRead).toHaveBeenCalledWith(first.id);

    await user.keyboard("a");
    expect(within(screen.getByLabelText("藏书状态")).getByRole("button", { name: "全部2" })).toHaveFocus();
    await user.keyboard("w");
    expect(within(screen.getByLabelText("藏书状态")).getByRole("button", { name: "放弃0" })).toHaveFocus();
  });

  it("enters note editing explicitly and does not treat typed WASD as navigation", async () => {
    const user = userEvent.setup();
    render(
      <LibraryView
        books={[second]}
        selectedBookId={second.id}
        onSelect={() => {}}
        onImport={() => {}}
        onRead={() => {}}
        onUpdate={async () => {}}
      />,
    );
    const noteEntry = screen.getByText("备注").closest("label");
    if (!(noteEntry instanceof HTMLElement)) throw new Error("Missing note navigation entry.");
    noteEntry.focus();
    await user.keyboard(" ");
    const note = screen.getByRole("textbox", { name: "备注" });
    expect(note).toHaveFocus();
    await user.type(note, "wasd");
    expect(note).toHaveValue(`${second.note}wasd`);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(noteEntry).toHaveFocus());
    expect(note).toHaveValue(second.note);
  });

  it("shows reading progress only in the selected book details", () => {
    const reading = {
      ...second,
      readingProgress: {
        progress: 0.426,
        chapterLabel: "第三章",
        updatedAt: "2026-08-06T00:00:00.000Z",
      },
    };
    render(
      <LibraryView
        books={[first, reading]}
        selectedBookId={reading.id}
        onSelect={() => {}}
        onImport={() => {}}
        onRead={() => {}}
        onUpdate={async () => {}}
      />,
    );
    expect(screen.getByLabelText("书籍详情")).toHaveTextContent("进度43%");
    expect(screen.getByLabelText("书籍详情")).toHaveTextContent("章节第三章");
    expect(screen.getByLabelText("书籍列表")).not.toHaveTextContent("43%");
  });

  it("saves status and notes, restores notes with Escape, and rolls back failed saves", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn(async () => {});
    render(
      <LibraryView
        books={[second]}
        selectedBookId={second.id}
        onSelect={() => {}}
        onImport={() => {}}
        onRead={() => {}}
        onUpdate={onUpdate}
      />,
    );
    const status = screen.getByRole("group", { name: "收藏状态" });
    await user.click(within(status).getByRole("button", { name: "在看" }));
    expect(onUpdate).toHaveBeenCalledWith(second.id, { collectionStatus: "reading" });

    const note = screen.getByRole("textbox", { name: "备注" });
    await user.clear(note);
    await user.type(note, "新备注{Control>}{Enter}{/Control}");
    expect(onUpdate).toHaveBeenCalledWith(second.id, { note: "新备注" });

    await user.clear(note);
    await user.type(note, "不保存{Escape}");
    expect(note).toHaveValue(second.note);

    onUpdate.mockRejectedValueOnce(new Error("保存失败"));
    await user.clear(note);
    await user.type(note, "失败内容");
    await user.tab();
    await waitFor(() => expect(note).toHaveValue(second.note));
  });
});
