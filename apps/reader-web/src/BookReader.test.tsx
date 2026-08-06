import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BlockNode, ImageBlock, TextBlock } from "@airnobe/book-format";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookReader, captureReadingAnchor, currentTocEntry, findNavigationTarget, flattenToc, type ReaderRow } from "./BookReader.js";
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
    vi.useRealTimers();
    Reflect.deleteProperty(document, "startViewTransition");
  });

  it("keeps 1, 2, and 3 independent while publisher ruby remains visible", async () => {
    const user = userEvent.setup();
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);

    expect(document.querySelectorAll("[data-japanese-variant]")).toHaveLength(0);
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
    expect(document.querySelectorAll("[data-japanese-variant]")).toHaveLength(0);
    openReaderMenu();
    expect(screen.getByLabelText("阅读侧边栏")).toBeInTheDocument();
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

  it("records sidebar shortcuts and saves the shared navigation count", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {});
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={DEFAULT_READER_SETTINGS} onSaveSettings={save} />);
    await user.keyboard("q");
    await user.click(screen.getByRole("button", { name: "设置快捷键" }));
    await user.click(screen.getByRole("button", { name: "修改侧边栏快捷键" }));
    fireEvent.keyDown(window, { key: "m", code: "KeyM", ctrlKey: true });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shortcuts: expect.objectContaining({ toggleSidebar: { code: "KeyM", modifier: "Control" } }) }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "回退/快进段数" }), { target: { value: "4" } });
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ navigation: { textSteps: 4 } })));
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

  it("uses bottom W/S and top E/F anchors with two-text jumps while skipping a divider", async () => {
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
    await user.keyboard("e");
    const topPrevious = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
    scrollTo.mockClear();
    await user.keyboard("f");
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
    render(<BookReader loaded={loaded} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    expect(document.querySelector("#long-paragraph-120")).toBeInTheDocument();
    await waitFor(() => {
      const targetTop = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
      expect(targetTop).toBeGreaterThan(5_000);
    });
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
      value: () => ({ top: index * 100, bottom: index * 100 + 80 }),
    }));
    fireEvent.scroll(window);
    act(() => vi.advanceTimersByTime(749));
    expect(savePosition).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(savePosition).toHaveBeenCalledTimes(1);
    expect(savePosition).toHaveBeenCalledWith(expect.objectContaining({
      documentId: loaded.documents[0]?.id,
      blockId: anchors[0]?.id,
      viewportOffset: 24,
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
