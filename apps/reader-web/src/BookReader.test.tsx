import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BlockNode, ImageBlock, TextBlock } from "@airnobe/book-format";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookReader, captureReadingAnchor, currentTocEntry, findNavigationTarget, flattenToc, JAPANESE_VISIBILITY_TIMING, useStagedVisibility, type ReaderRow, type VisibilityTiming } from "./BookReader.js";
import type { LoadedBook } from "./book-source.js";
import { createDemoBook } from "./demo-book.js";
import { DEFAULT_READER_SETTINGS } from "./reader-settings.js";

const readerSettingsProps = {
  settings: DEFAULT_READER_SETTINGS,
  onSaveSettings: async (): Promise<void> => {},
};

function createLongBook(blockCount = 200, withLink = false): LoadedBook {
  const loaded = createDemoBook();
  const originalDocument = loaded.documents[0];
  const template = originalDocument?.blocks.find((block): block is TextBlock => block.type === "text" && block.role === "paragraph");
  if (!originalDocument || !template) throw new Error("Demo book is missing its paragraph fixture.");
  const blocks: BlockNode[] = Array.from({ length: blockCount }, (_, index) => {
    const block = structuredClone(template);
    block.id = `long-paragraph-${index}`;
    for (const variant of block.variants) variant.sourceRef.nodeIndex = index;
    return block;
  });
  if (withLink) {
    const first = blocks[0] as TextBlock;
    const chinese = first.variants.find((variant) => variant.language === "zh-CN");
    if (!chinese) throw new Error("Demo book is missing its Chinese fixture.");
    chinese.content = [{
      type: "link",
      target: { kind: "internal", documentId: originalDocument.id, fragmentId: "last" },
      children: [{ type: "text", value: "跳到结尾" }],
    }];
  }
  const document = {
    ...originalDocument,
    anchors: { last: `long-paragraph-${blockCount - 1}` },
    blocks,
  };
  loaded.documents = [document];
  loaded.documentById = new Map([[document.id, document]]);
  return loaded;
}

function openReaderMenu(): void {
  const app = document.querySelector(".reader-app");
  if (!app) throw new Error("Reader did not render.");
  fireEvent.contextMenu(app);
}

function VisibilityPhaseHarness({ visible, timing }: { visible: boolean; timing?: Readonly<VisibilityTiming> }) {
  return <div data-testid="visibility-phase" data-phase={useStagedVisibility(visible, timing)} />;
}

function navigationRows(kinds: Array<"text" | "image" | "divider" | "spacer">): ReaderRow[] {
  return kinds.map((kind, index) => {
    const id = `navigation-${kind}-${index}`;
    const block: BlockNode = kind === "text"
      ? {
          id,
          type: "text",
          role: "paragraph",
          variants: [{
            language: "zh-CN",
            origin: "translation",
            order: 0,
            content: [{ type: "text", value: id }],
            sourceRef: { sourcePath: "Text/test.xhtml", nodeIndex: index },
          }],
        }
      : kind === "image"
        ? {
            id,
            type: "image",
            role: "illustration",
            assetId: "asset-test",
            alt: "插画",
            sourceRef: { sourcePath: "Text/test.xhtml", nodeIndex: index },
          } satisfies ImageBlock
        : kind === "divider" ? {
            id,
            type: "divider",
            sourceRef: { sourcePath: "Text/test.xhtml", nodeIndex: index },
          } : {
            id,
            type: "spacer",
            sourceRef: { sourcePath: "Text/test.xhtml", nodeIndex: index },
          };
    return { block, documentId: "document-test", documentRole: "chapter", documentStart: index === 0 };
  });
}

describe("BookReader", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Reflect.deleteProperty(document, "startViewTransition");
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(document, "exitFullscreen");
  });

  it("keeps 1, 2, and 3 independent while publisher ruby remains visible", async () => {
    const user = userEvent.setup();
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);

    const mountedRows = document.querySelectorAll("[data-virtual-row]").length;
    expect(document.querySelectorAll("[data-japanese-variant]").length).toBeGreaterThan(0);
    expect(document.querySelector(".japanese-collapse")).toHaveAttribute("data-phase", "hidden");
    await user.keyboard("1");
    expect(document.querySelectorAll("[data-japanese-variant]").length).toBeGreaterThan(0);
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.getByText("とびら").parentElement).toHaveClass("ruby--hidden");
    expect(screen.getByText("まど").parentElement).toHaveClass("ruby--hidden");
    expect(screen.getByText("konpyūtā").parentElement).toHaveClass("ruby--hidden");

    await user.keyboard("2");
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.getByText("とびら")).toBeInTheDocument();
    expect(screen.getByText("まど")).toBeInTheDocument();
    expect(screen.getByText("konpyūtā").parentElement).toHaveClass("ruby--hidden");

    await user.keyboard("3");
    expect(screen.getByText("konpyūtā")).toBeInTheDocument();
    expect(screen.getByText("まど")).toBeInTheDocument();

    await user.keyboard("1");
    expect(document.querySelector(".japanese-collapse")).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelectorAll("[data-virtual-row]")).toHaveLength(mountedRows);
    openReaderMenu();
    expect(screen.getByLabelText("阅读侧边栏")).toBeInTheDocument();
  });

  it("expands before fading in and fades out before collapsing", () => {
    vi.useFakeTimers();
    const view = render(<VisibilityPhaseHarness visible={false} />);
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "hidden");
    view.rerender(<VisibilityPhaseHarness visible />);
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "expanding");
    act(() => vi.advanceTimersByTime(160));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "entering");
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "visible");
    view.rerender(<VisibilityPhaseHarness visible={false} />);
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "fading");
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "collapsing");
    act(() => vi.advanceTimersByTime(160));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "hidden");
  });

  it("keeps Japanese opening timings while doubling only its closing stages", () => {
    vi.useFakeTimers();
    const view = render(<VisibilityPhaseHarness visible={false} timing={JAPANESE_VISIBILITY_TIMING} />);
    view.rerender(<VisibilityPhaseHarness visible timing={JAPANESE_VISIBILITY_TIMING} />);
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "expanding");
    act(() => vi.advanceTimersByTime(160));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "entering");
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "visible");

    view.rerender(<VisibilityPhaseHarness visible={false} timing={JAPANESE_VISIBILITY_TIMING} />);
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "fading");
    act(() => vi.advanceTimersByTime(359));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "fading");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "collapsing");
    act(() => vi.advanceTimersByTime(319));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "collapsing");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "hidden");
  });

  it("reverses a staged visibility transition without jumping to hidden", () => {
    vi.useFakeTimers();
    const view = render(<VisibilityPhaseHarness visible />);
    view.rerender(<VisibilityPhaseHarness visible={false} />);
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "fading");
    act(() => vi.advanceTimersByTime(80));
    view.rerender(<VisibilityPhaseHarness visible />);
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "entering");
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "visible");
  });

  it("finishes display changes immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const view = render(<VisibilityPhaseHarness visible={false} />);
    view.rerender(<VisibilityPhaseHarness visible />);
    expect(screen.getByTestId("visibility-phase")).toHaveAttribute("data-phase", "visible");
  });

  it("maps paragraph spacing directly to em while keeping line height unitless", () => {
    const settings = structuredClone(DEFAULT_READER_SETTINGS);
    settings.appearance.typography.lineHeight = 1.6;
    settings.appearance.typography.paragraphSpacing = 2;
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={settings} onSaveSettings={async () => {}} />);
    const reader = document.querySelector<HTMLElement>(".reader-app");
    expect(reader?.style.getPropertyValue("--reader-line-height")).toBe("1.6");
    expect(reader?.style.getPropertyValue("--reader-paragraph-spacing")).toBe("2em");
  });

  it("applies Chinese text alpha and always hides the reading scrollbar", () => {
    const settings = structuredClone(DEFAULT_READER_SETTINGS);
    settings.appearance.typography.chineseOpacity = 0.45;
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={settings} onSaveSettings={async () => {}} />);
    expect(document.querySelector<HTMLElement>(".reader-app")?.style.getPropertyValue("--chinese-opacity-percent")).toBe("45%");
    expect(document.documentElement).toHaveAttribute("data-reader-scrollbar-hidden", "true");
  });

  it("toggles browser fullscreen with Alt+Enter and exposes the sidebar button", async () => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: vi.fn(async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.documentElement });
      document.dispatchEvent(new Event("fullscreenchange"));
    }) });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: vi.fn(async () => {}) });
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);

    fireEvent.keyDown(window, { key: "Enter", code: "Enter", altKey: true });
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-reader-fullscreen", "true"));
    openReaderMenu();
    expect(screen.getByRole("button", { name: "退出全屏" })).toBeInTheDocument();
  });

  it("captures independent text blocks at the top and bottom reading edges", () => {
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    const blocks = [...document.querySelectorAll<HTMLElement>("[data-reading-anchor]")];
    const positions = [
      { top: -80, bottom: -20 },
      { top: 0, bottom: 60 },
      { top: window.innerHeight - 80, bottom: window.innerHeight - 10 },
      { top: window.innerHeight + 20, bottom: window.innerHeight + 80 },
    ];
    blocks.forEach((block, index) => Object.defineProperty(block, "getBoundingClientRect", {
      value: () => positions[index],
    }));
    expect(captureReadingAnchor()?.id).toBe(blocks[1]?.id);
    expect(captureReadingAnchor("bottom")?.id).toBe(blocks[2]?.id);
  });

  it("uses an adjacent image as the target, but stops before images reached after text", () => {
    const rows = navigationRows(["text", "text", "image", "text", "text", "divider", "text"]);
    expect(findNavigationTarget(rows, 0, 1, 2)).toBe(1);
    expect(findNavigationTarget(rows, 2, 1, 2)).toBe(4);
    expect(findNavigationTarget(rows, 6, -1, 2)).toBe(3);
    expect(findNavigationTarget(rows, 3, -1, 2)).toBe(2);
    expect(findNavigationTarget(rows, 1, -1, 2)).toBe(0);
  });

  it("applies the same image boundary rule when starting from an image", () => {
    const rows = navigationRows(["image", "divider", "image", "text", "image", "text", "text"]);
    expect(findNavigationTarget(rows, 0, 1, 2)).toBe(2);
    expect(findNavigationTarget(rows, 2, 1, 2)).toBe(3);
    expect(findNavigationTarget(rows, 4, 1, 2)).toBe(6);
    expect(findNavigationTarget(rows, 4, -1, 2)).toBe(3);
    expect(findNavigationTarget(rows, 2, -1, 2)).toBe(0);
  });

  it("skips spacers and dividers without counting them as navigation steps", () => {
    const rows = navigationRows(["text", "spacer", "divider", "text", "spacer", "text"]);
    expect(findNavigationTarget(rows, 0, 1, 2)).toBe(5);
    expect(findNavigationTarget(rows, 5, -1, 2)).toBe(0);
  });

  it("renders spacers as visual height without making them reading anchors", () => {
    const book = createDemoBook();
    const bookDocument = book.documents[0];
    if (!bookDocument) throw new Error("Demo book is missing its document fixture.");
    bookDocument.blocks.splice(1, 0, {
      id: "demo-spacer",
      type: "spacer",
      sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 98 },
    });
    render(<BookReader loaded={book} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    expect(document.querySelector("#demo-spacer")).toHaveClass("spacer-block");
    expect(document.querySelector("#demo-spacer")).not.toHaveAttribute("data-reading-anchor");
  });

  it("makes every block image a reading anchor", () => {
    const book = createDemoBook();
    const bookDocument = book.documents[0];
    if (!bookDocument) throw new Error("Demo book is missing its document fixture.");
    bookDocument.blocks.splice(2, 0, {
      id: "demo-image",
      type: "image",
      role: "illustration",
      assetId: "asset-missing",
      alt: "插画",
      sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 99 },
    });
    render(<BookReader loaded={book} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    expect(document.querySelector("#demo-image")).toHaveAttribute("data-reading-anchor");
  });

  it("flattens nested TOC entries and prefers the deepest target at the current row", () => {
    const book = createDemoBook();
    const document = book.documents[0] as NonNullable<typeof book.documents[0]>;
    const rowIndices = new Map(document.blocks.map((block, index) => [block.id, index]));
    book.book.toc = [{
      label: "第一部",
      target: { documentId: document.id, fragmentId: "start" },
      children: [{ label: "第一章", target: { documentId: document.id, fragmentId: "start" }, children: [] }],
    }];
    const entries = flattenToc(book.book.toc, book.documentById, rowIndices);
    expect(entries.map((entry) => [entry.label, entry.depth, entry.targetIndex])).toEqual([
      ["第一部", 0, 0],
      ["第一章", 1, 0],
    ]);
    expect(currentTocEntry(entries, 2)?.label).toBe("第一章");
  });

  it("opens one peer sidebar with Q and exposes TOC, settings, progress and return", async () => {
    const user = userEvent.setup();
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    await user.keyboard("q");
    expect(screen.getByLabelText("阅读侧边栏")).toBeInTheDocument();
    expect(screen.getByLabelText("目录")).toBeInTheDocument();
    expect(screen.getAllByLabelText("阅读设置").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "返回书库" })).toBeInTheDocument();
    expect(screen.getByText("全书")).toBeInTheDocument();
    await user.keyboard("q");
    expect(screen.queryByLabelText("阅读侧边栏")).not.toBeInTheDocument();
  });

  it("adds from the persistent header, renders, jumps to and deletes a bookmark", async () => {
    const loaded = createDemoBook();
    loaded.libraryBookId = "01234567-89ab-4cde-8fab-0123456789ab";
    const block = loaded.documents[0]?.blocks.filter((candidate) => candidate.type === "text").at(-1);
    if (!block) throw new Error("Demo book is missing a text block.");
    const position = { documentId: loaded.documents[0]?.id as string, blockId: block.id, viewportOffset: -12, progress: 0, chapterLabel: "第一章" };
    const bookmark = { id: "11234567-89ab-4cde-8fab-0123456789ab", position, excerpt: "第一章 雨后", createdAt: "2026-08-09T00:00:00.000Z" };
    const add = vi.fn().mockResolvedValue({ outcome: "created", state: { version: 1, bookmarks: [bookmark] } });
    const remove = vi.fn().mockResolvedValue({ version: 1, bookmarks: [] });
    render(<BookReader loaded={loaded} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} onAddBookmark={add} onDeleteBookmark={remove} />);
    openReaderMenu();
    expect(screen.getByRole("region", { name: "书签" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加或取消当前位置书签" }));
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(await screen.findByText("已添加书签")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^第一章 雨后/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除书签：第一章 雨后" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(bookmark.id));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^第一章 雨后/ })).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "书签" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加或取消当前位置书签" })).toBeInTheDocument();
  });

  it("removes the current bookmark when C is pressed again", async () => {
    const loaded = createDemoBook();
    loaded.libraryBookId = "01234567-89ab-4cde-8fab-0123456789ab";
    const block = loaded.documents[0]?.blocks.filter((candidate) => candidate.type === "text").at(-1);
    if (!block) throw new Error("Demo book is missing a text block.");
    const bookmark = {
      id: "11234567-89ab-4cde-8fab-0123456789ab",
      position: { documentId: loaded.documents[0]?.id as string, blockId: block.id, viewportOffset: -12, progress: 0, chapterLabel: "第一章" },
      excerpt: "第一章 雨后",
      createdAt: "2026-08-09T00:00:00.000Z",
    };
    loaded.bookmarkState = { version: 1, bookmarks: [bookmark] };
    const add = vi.fn();
    const remove = vi.fn().mockResolvedValue({ version: 1, bookmarks: [] });
    render(<BookReader loaded={loaded} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} onAddBookmark={add} onDeleteBookmark={remove} />);
    for (const element of document.querySelectorAll<HTMLElement>("[data-reading-anchor]")) {
      Object.defineProperty(element, "getBoundingClientRect", {
        value: () => element.id === block.id ? { top: 0, bottom: 100 } : { top: 200, bottom: 280 },
      });
    }
    fireEvent.keyDown(window, { key: "c", code: "KeyC" });
    await waitFor(() => expect(remove).toHaveBeenCalledWith(bookmark.id));
    expect(add).not.toHaveBeenCalled();
    expect(await screen.findByText("已取消书签")).toBeInTheDocument();
  });

  it("jumps to an unmounted bookmarked virtual row", async () => {
    const loaded = createLongBook(200);
    loaded.bookmarkState = { version: 1, bookmarks: [{
      id: "11234567-89ab-4cde-8fab-0123456789ab",
      position: { documentId: loaded.documents[0]?.id as string, blockId: "long-paragraph-120", viewportOffset: -36, progress: 120 / 199, chapterLabel: null },
      excerpt: "远处书签",
      createdAt: "2026-08-09T00:00:00.000Z",
    }] };
    const scrollTo = vi.spyOn(window, "scrollTo");
    render(<BookReader loaded={loaded} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    expect(document.querySelector("#long-paragraph-120")).not.toBeInTheDocument();
    openReaderMenu();
    fireEvent.click(screen.getByRole("button", { name: /^远处书签/ }));
    await waitFor(() => expect(document.querySelector("#long-paragraph-120")).toBeInTheDocument());
    expect(Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)))).toBeGreaterThan(5_000);
  });

  it("uses configurable F fullscreen and E return actions without repeating", async () => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    const requestFullscreen = vi.fn(async () => {});
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
    const onReturn = vi.fn();
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={onReturn} {...readerSettingsProps} />);
    fireEvent.keyDown(window, { key: "f", code: "KeyF" });
    fireEvent.keyDown(window, { key: "f", code: "KeyF", repeat: true });
    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledOnce());
    fireEvent.keyDown(window, { key: "e", code: "KeyE" });
    fireEvent.keyDown(window, { key: "e", code: "KeyE", repeat: true });
    await waitFor(() => expect(onReturn).toHaveBeenCalledOnce());
  });

  it("records sidebar shortcuts and saves the shared navigation count", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {});
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={DEFAULT_READER_SETTINGS} onSaveSettings={save} />);
    await user.keyboard("q");
    await user.click(screen.getByRole("button", { name: "设置快捷键" }));
    expect(screen.getByRole("heading", { name: "阅读导航" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "显示与应用" })).toBeInTheDocument();
    expect(screen.getByText("切换日文")).toBeInTheDocument();
    expect(screen.getByText("切换振假名")).toBeInTheDocument();
    expect(screen.getByText("切换罗马音")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "修改从顶部回退快捷键" })).toHaveAttribute("data-spatial-zone", "shortcut-navigation");
    expect(screen.getByRole("button", { name: "修改切换日文快捷键" })).toHaveAttribute("data-spatial-zone", "shortcut-display");
    expect(screen.getByRole("button", { name: "修改从顶部回退快捷键" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    expect(screen.getByRole("button", { name: "修改切换日文快捷键" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(screen.getByRole("button", { name: "修改切换振假名快捷键" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "w", code: "KeyW" });
    expect(screen.getByRole("button", { name: "修改切换日文快捷键" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "修改侧边栏快捷键" }));
    fireEvent.keyDown(window, { key: "m", code: "KeyM", ctrlKey: true });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shortcuts: expect.objectContaining({ toggleSidebar: { code: "KeyM", modifier: "Control" } }) }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "滚动段数" }), { target: { value: "4" } });
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "滚动段数" }), { key: "Enter", code: "Enter" });
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ navigation: { textSteps: 4 } })));
  });

  it("deletes and swaps shortcut bindings from the reader dialog", async () => {
    const save = vi.fn(async () => {});
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={DEFAULT_READER_SETTINGS} onSaveSettings={save} />);
    fireEvent.keyDown(window, { key: "q", code: "KeyQ" });
    fireEvent.click(screen.getByRole("button", { name: "设置快捷键" }));

    fireEvent.click(screen.getByRole("button", { name: "修改全屏快捷键" }));
    fireEvent.keyDown(window, { key: "e", code: "KeyE" });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shortcuts: expect.objectContaining({ toggleFullscreen: { code: "KeyE" }, returnLibrary: { code: "KeyF" } }) }));

    fireEvent.click(screen.getByRole("button", { name: "修改添加书签快捷键" }));
    fireEvent.keyDown(window, { key: "Backspace", code: "Backspace" });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shortcuts: expect.objectContaining({ addBookmark: null }) }));
    expect(screen.getByRole("button", { name: "设置添加书签快捷键，当前未设置" })).toBeInTheDocument();
    const saveCount = save.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "设置添加书签快捷键，当前未设置" }));
    fireEvent.keyDown(window, { key: "Backspace", code: "Backspace" });
    expect(save).toHaveBeenCalledTimes(saveCount);
  });

  it("leaves a pure Chinese book unchanged when 1, 2, and 3 are pressed", async () => {
    const user = userEvent.setup();
    const chinese = createDemoBook();
    delete chinese.book.derivation;
    for (const document of chinese.documents) {
      for (const block of document.blocks) {
        if (block.type !== "text") continue;
        block.variants = block.variants.filter((variant) => variant.language !== "ja-JP");
      }
    }
    render(<BookReader loaded={chinese} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    const before = document.querySelector(".virtual-book")?.textContent;
    await user.keyboard("123");
    expect(document.querySelector(".virtual-book")?.textContent).toBe(before);
  });

  it("uses bottom W/S and top Z/X anchors with two-text jumps while skipping a divider", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const loaded = createLongBook(30);
    const divider = createDemoBook().documents[0]?.blocks.find((block) => block.type === "divider");
    if (!divider || !loaded.documents[0]) throw new Error("Demo book is missing its divider fixture.");
    loaded.documents[0].blocks.splice(11, 0, structuredClone(divider));
    render(<BookReader loaded={loaded} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    for (const element of document.querySelectorAll<HTMLElement>("[data-reading-anchor]")) {
      const index = Number(element.id.replace("long-paragraph-", ""));
      let top: number;
      if (index < 2) top = -200 + (index * 100);
      else if (index === 2) top = 0;
      else if (index < 10) top = 100 + ((index - 3) * 80);
      else if (index === 10) top = window.innerHeight - 80;
      else top = window.innerHeight + 20 + ((index - 11) * 80);
      const bottom = index === 10 ? window.innerHeight - 10 : top + 70;
      Object.defineProperty(element, "getBoundingClientRect", { value: () => ({ top, bottom }) });
    }

    await user.keyboard("s");
    expect(scrollTo.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ behavior: "smooth" }));
    const nextTop = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
    expect(nextTop).toBeGreaterThan(100);
    scrollTo.mockClear();
    await user.keyboard("w");
    const previousTop = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
    expect(nextTop).toBeGreaterThan(previousTop);

    scrollTo.mockClear();
    await user.keyboard("z");
    const topPrevious = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
    scrollTo.mockClear();
    await user.keyboard("x");
    const topNext = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
    expect(topNext).toBeGreaterThan(topPrevious);
  });

  it("switches A and D instantly without calling View Transitions when the option is off", () => {
    const scrollBy = vi.spyOn(window, "scrollBy");
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: startViewTransition });
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    expect(scrollBy).toHaveBeenCalledWith({ top: window.innerHeight, behavior: "instant" });
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(document.querySelector(".reading-column")).not.toHaveClass("reading-column--page-turning");
  });

  it("falls back to a dimmed instant page turn when View Transitions are unavailable", () => {
    vi.useFakeTimers();
    const scrollBy = vi.spyOn(window, "scrollBy");
    render(
      <BookReader
        loaded={createDemoBook()}
        onChooseBook={() => {}}
        onReturnToLibrary={() => {}}
        settings={{ ...DEFAULT_READER_SETTINGS, pageTransitions: true }}
        onSaveSettings={async () => {}}
      />,
    );
    fireEvent.keyDown(window, { key: "a", code: "KeyA" });
    expect(document.querySelector(".reading-column")).toHaveClass("reading-column--page-turning");
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    act(() => vi.advanceTimersByTime(100));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ top: -window.innerHeight, behavior: "instant" });
    expect(document.querySelector(".reading-column")).not.toHaveClass("reading-column--page-turning");
    act(() => vi.advanceTimersByTime(120));
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    act(() => vi.advanceTimersByTime(100));
    expect(scrollBy).toHaveBeenLastCalledWith({ top: window.innerHeight, behavior: "instant" });
  });

  it("uses a browser View Transition to cross-fade an instant page turn", () => {
    const scrollBy = vi.spyOn(window, "scrollBy");
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: startViewTransition });
    render(
      <BookReader
        loaded={createDemoBook()}
        onChooseBook={() => {}}
        onReturnToLibrary={() => {}}
        settings={{ ...DEFAULT_READER_SETTINGS, pageTransitions: true }}
        onSaveSettings={async () => {}}
      />,
    );
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ top: window.innerHeight, behavior: "instant" });
    expect(document.querySelector(".reading-column")).not.toHaveClass("reading-column--page-turning");
  });

  it("matches shortcuts by physical code and exact modifier", () => {
    const settings = structuredClone(DEFAULT_READER_SETTINGS);
    settings.shortcuts.pageDown = { code: "KeyX", modifier: "Control" };
    const scrollBy = vi.spyOn(window, "scrollBy");
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={settings} onSaveSettings={async () => {}} />);
    fireEvent.keyDown(window, { key: "й", code: "KeyX" });
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "й", code: "KeyX", ctrlKey: true });
    expect(scrollBy).toHaveBeenCalledWith({ top: window.innerHeight, behavior: "instant" });
  });

  it("does not react to an unbound shortcut action", () => {
    const settings = structuredClone(DEFAULT_READER_SETTINGS);
    settings.shortcuts.pageDown = null;
    const scrollBy = vi.spyOn(window, "scrollBy");
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={settings} onSaveSettings={async () => {}} />);
    fireEvent.keyDown(window, { key: "d", code: "KeyD" });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("restores a saved virtual row when a library book opens", async () => {
    const loaded = createLongBook(200);
    loaded.libraryBookId = "01234567-89ab-4cde-8fab-0123456789ab";
    loaded.readingState = {
      version: 1,
      position: {
        documentId: loaded.documents[0]?.id as string,
        blockId: "long-paragraph-120",
        viewportOffset: -300,
        progress: 120 / 199,
        chapterLabel: null,
      },
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const scrollTo = vi.spyOn(window, "scrollTo");
    const scrollBy = vi.spyOn(window, "scrollBy");
    render(<StrictMode><BookReader loaded={loaded} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} /></StrictMode>);
    expect(document.querySelector("#long-paragraph-120")).toBeInTheDocument();
    await waitFor(() => {
      const targetTop = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
      expect(targetTop).toBeGreaterThan(5_000);
    });
    await waitFor(() => expect(scrollBy).toHaveBeenCalledWith({ top: 300, behavior: "instant" }));
  });

  it("does not overwrite the saved position when the app hides during restoration", () => {
    const loaded = createLongBook(200);
    loaded.libraryBookId = "01234567-89ab-4cde-8fab-0123456789ab";
    loaded.readingState = {
      version: 1,
      position: {
        documentId: loaded.documents[0]?.id as string,
        blockId: "long-paragraph-120",
        viewportOffset: -300,
        progress: 120 / 199,
        chapterLabel: null,
      },
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    const savePosition = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(
      <StrictMode>
        <BookReader
          loaded={loaded}
          onChooseBook={() => {}}
          onReturnToLibrary={() => {}}
          {...readerSettingsProps}
          onSaveReadingPosition={savePosition}
        />
      </StrictMode>,
    );
    fireEvent(document, new Event("visibilitychange"));
    expect(savePosition).not.toHaveBeenCalled();
  });

  it("debounces progress saves and flushes the latest position before returning", async () => {
    vi.useFakeTimers();
    const loaded = createDemoBook();
    loaded.libraryBookId = "01234567-89ab-4cde-8fab-0123456789ab";
    const savePosition = vi.fn().mockResolvedValue(undefined);
    const onReturn = vi.fn();
    render(
      <BookReader
        loaded={loaded}
        onChooseBook={() => {}}
        onReturnToLibrary={onReturn}
        {...readerSettingsProps}
        onSaveReadingPosition={savePosition}
      />,
    );
    const anchors = [...document.querySelectorAll<HTMLElement>("[data-reading-anchor]")];
    anchors.forEach((anchor, index) => Object.defineProperty(anchor, "getBoundingClientRect", {
      value: () => ({ top: index * 100 - 18, bottom: index * 100 + 62 }),
    }));
    fireEvent.scroll(window);
    act(() => vi.advanceTimersByTime(749));
    expect(savePosition).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(savePosition).toHaveBeenCalledTimes(1);
    expect(savePosition).toHaveBeenCalledWith(expect.objectContaining({
      documentId: loaded.documents[0]?.id,
      blockId: anchors[0]?.id,
      viewportOffset: -18,
      progress: 0,
    }));

    fireEvent.scroll(window);
    openReaderMenu();
    fireEvent.click(screen.getByRole("button", { name: "返回书库" }));
    await act(async () => Promise.resolve());
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it("keeps a long book bounded and scrolls internal links to unmounted rows", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    render(<BookReader loaded={createLongBook(200, true)} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    expect(document.querySelectorAll("[data-virtual-row]").length).toBeLessThan(60);
    expect(document.querySelector("#long-paragraph-199")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "跳到结尾" }));
    const targetTop = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
    expect(targetTop).toBeGreaterThan(5_000);
  });
});
