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

  it("keeps Q, E, and Z independent while publisher ruby remains visible", async () => {
    const user = userEvent.setup();
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);

    expect(document.querySelectorAll("[data-japanese-variant]")).toHaveLength(0);
    await user.keyboard("q");
    expect(document.querySelectorAll("[data-japanese-variant]").length).toBeGreaterThan(0);
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.queryByText("とびら")).not.toBeInTheDocument();
    expect(screen.queryByText("まど")).not.toBeInTheDocument();
    expect(screen.queryByText("konpyūtā")).not.toBeInTheDocument();

    await user.keyboard("e");
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.getByText("とびら")).toBeInTheDocument();
    expect(screen.getByText("まど")).toBeInTheDocument();
    expect(screen.queryByText("konpyūtā")).not.toBeInTheDocument();

    await user.keyboard("z");
    expect(screen.getByText("konpyūtā")).toBeInTheDocument();
    expect(screen.getByText("まど")).toBeInTheDocument();

    await user.keyboard("q");
    expect(document.querySelectorAll("[data-japanese-variant]")).toHaveLength(0);
    openReaderMenu();
    expect(screen.getByRole("button", { name: /^注音/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^片假名罗马音/ })).toHaveAttribute("aria-pressed", "true");
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

  it("opens the menu with Digit1 and the TOC with Digit2, then jumps to an unmounted nested target", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: startViewTransition });
    const loaded = createLongBook(200, true);
    const bookDocument = loaded.documents[0] as NonNullable<typeof loaded.documents[0]>;
    loaded.book.toc = [{
      label: "分组",
      children: [{ label: "结尾", target: { documentId: bookDocument.id, fragmentId: "last" }, children: [] }],
    }];
    render(<BookReader loaded={loaded} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    await user.keyboard("1");
    expect(screen.getByRole("dialog", { name: "阅读菜单" })).toBeInTheDocument();
    await user.keyboard("1");
    await user.keyboard("2");
    const drawer = screen.getByRole("complementary", { name: "目录" });
    expect(within(drawer).getByText("分组")).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "结尾" }));
    expect(screen.queryByRole("complementary", { name: "目录" })).not.toBeInTheDocument();
    const targetTop = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
    expect(targetTop).toBeGreaterThan(5_000);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("cross-fades an instant TOC jump when page transitions are enabled", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: startViewTransition });
    const loaded = createLongBook(200);
    const bookDocument = loaded.documents[0] as NonNullable<typeof loaded.documents[0]>;
    loaded.book.toc = [{ label: "结尾", target: { documentId: bookDocument.id, fragmentId: "last" }, children: [] }];
    render(<BookReader loaded={loaded} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={{ ...DEFAULT_READER_SETTINGS, pageTransitions: true }} onSaveSettings={async () => {}} />);
    await user.keyboard("2");
    await user.click(screen.getByRole("button", { name: "结尾" }));
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)))).toBeGreaterThan(5_000);
  });

  it("disables the TOC command for a book without TOC entries", async () => {
    const user = userEvent.setup();
    const loaded = createDemoBook();
    loaded.book.toc = [];
    render(<BookReader loaded={loaded} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    openReaderMenu();
    expect(screen.getByRole("button", { name: "目录" })).toBeDisabled();
    await user.keyboard("{Escape}1");
    expect(screen.queryByRole("complementary", { name: "目录" })).not.toBeInTheDocument();
  });

  it("opens a centered desktop menu and disables unavailable generated ruby", async () => {
    const user = userEvent.setup();
    const onReturnToLibrary = vi.fn();
    const base = createDemoBook();
    delete base.book.derivation;
    for (const document of base.documents) {
      for (const block of document.blocks) {
        if (block.type !== "text") continue;
        for (const variant of block.variants) {
          variant.content = variant.content.filter((node) => node.type !== "ruby" || node.readingType !== "romaji");
          for (const node of variant.content) {
            if (node.type === "ruby" && node.origin !== "source") node.origin = "source";
          }
        }
      }
    }
    render(<BookReader loaded={base} onChooseBook={() => {}} onReturnToLibrary={onReturnToLibrary} {...readerSettingsProps} />);
    expect(document.querySelector(".reader-toolbar")).not.toBeInTheDocument();
    openReaderMenu();
    expect(screen.getByRole("dialog", { name: "阅读菜单" })).toBeInTheDocument();
    expect(screen.queryByText("打开 EPUB")).not.toBeInTheDocument();
    expect(screen.queryByText("导出原始 EPUB")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回书库" }));
    expect(onReturnToLibrary).toHaveBeenCalledOnce();
    openReaderMenu();
    expect(screen.getByRole("button", { name: /^注音/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^片假名罗马音/ })).toBeDisabled();
    const backdrop = document.querySelector(".reader-menu-backdrop");
    if (backdrop) fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole("dialog", { name: "阅读菜单" })).not.toBeInTheDocument();
    openReaderMenu();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "阅读菜单" })).not.toBeInTheDocument();
  });

  it("navigates the reader menu spatially and suppresses reading shortcuts while it is open", async () => {
    const user = userEvent.setup();
    const scrollBy = vi.spyOn(window, "scrollBy");
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} {...readerSettingsProps} />);
    await user.keyboard("1");
    const back = screen.getByRole("button", { name: "返回书库" });
    expect(back).toHaveFocus();

    await user.keyboard("s");
    const japanese = screen.getByRole("button", { name: /^日文/ });
    expect(japanese).toHaveFocus();
    await user.keyboard("d");
    expect(screen.getByRole("button", { name: "修改日文快捷键" })).toHaveFocus();
    await user.keyboard("a");
    expect(japanese).toHaveFocus();
    await user.keyboard(" ");
    expect(japanese).toHaveAttribute("aria-pressed", "true");
    expect(scrollBy).not.toHaveBeenCalled();

    await user.keyboard("1");
    expect(screen.queryByRole("dialog", { name: "阅读菜单" })).not.toBeInTheDocument();
  });

  it("leaves a pure Chinese book unchanged when Q, E, and Z are pressed", async () => {
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
    await user.keyboard("qez");
    expect(document.querySelector(".virtual-book")?.textContent).toBe(before);
  });

  it("uses bottom W/S and top R/F anchors with two-text jumps while skipping a divider", async () => {
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
    await user.keyboard("r");
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

  it("edits the shared global navigation count from the reader menu", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <BookReader
        loaded={createDemoBook()}
        onChooseBook={() => {}}
        onReturnToLibrary={() => {}}
        settings={DEFAULT_READER_SETTINGS}
        onSaveSettings={saveSettings}
      />,
    );
    openReaderMenu();
    const steps = screen.getByRole("spinbutton", { name: "回退/快进段数" });
    await user.clear(steps);
    await user.type(steps, "3");
    expect(saveSettings).toHaveBeenCalledWith({
      ...DEFAULT_READER_SETTINGS,
      navigation: { textSteps: 3 },
      pageTransitions: false,
    });

    await user.clear(steps);
    await user.type(steps, "0");
    fireEvent.blur(steps);
    expect(steps).toHaveValue(3);
    expect(saveSettings).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "翻页淡出淡出" }));
    expect(saveSettings).toHaveBeenLastCalledWith({
      ...DEFAULT_READER_SETTINGS,
      navigation: { textSteps: 3 },
      pageTransitions: true,
    });

    const scrollTo = vi.spyOn(window, "scrollTo");
    await user.click(steps);
    await user.keyboard("f");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("applies a valid navigation count before the menu is dismissed", () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <BookReader
        loaded={createDemoBook()}
        onChooseBook={() => {}}
        onReturnToLibrary={() => {}}
        settings={DEFAULT_READER_SETTINGS}
        onSaveSettings={saveSettings}
      />,
    );
    openReaderMenu();
    const steps = screen.getByRole("spinbutton", { name: "回退/快进段数" });
    fireEvent.change(steps, { target: { value: "4" } });
    const backdrop = document.querySelector(".reader-menu-backdrop");
    if (!backdrop) throw new Error("Reader menu backdrop did not render.");
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole("dialog", { name: "阅读菜单" })).not.toBeInTheDocument();
    expect(saveSettings).toHaveBeenCalledWith({
      ...DEFAULT_READER_SETTINGS,
      navigation: { textSteps: 4 },
      pageTransitions: false,
    });
  });

  it("captures a physical shortcut with one modifier and saves it immediately", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={DEFAULT_READER_SETTINGS} onSaveSettings={saveSettings} />);
    openReaderMenu();
    await user.click(screen.getByRole("button", { name: "修改从顶部回退快捷键" }));
    expect(screen.getByText("按键…")).toBeInTheDocument();
    await user.keyboard("{Control>}x{/Control}");
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      version: 6,
      shortcuts: expect.objectContaining({ topBackward: { code: "KeyX", modifier: "Control" } }),
    }));
    const binding = screen.getByRole("button", { name: "修改从顶部回退快捷键" });
    expect(binding).toHaveTextContent("Ctrl+X");
  });

  it("rejects shortcut conflicts and keeps listening until Escape", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={DEFAULT_READER_SETTINGS} onSaveSettings={saveSettings} />);
    openReaderMenu();
    const binding = screen.getByRole("button", { name: "修改从顶部回退快捷键" });
    await user.click(binding);
    await user.keyboard("w");
    expect(screen.getByRole("alert")).toHaveTextContent("从底部回退");
    expect(binding).toHaveAttribute("aria-pressed", "true");
    expect(saveSettings).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "阅读菜单" })).toBeInTheDocument();
    expect(binding).toHaveAttribute("aria-pressed", "false");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "阅读菜单" })).not.toBeInTheDocument();
  });

  it("keeps listening after invalid chords and cancels capture on an outside click", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={DEFAULT_READER_SETTINGS} onSaveSettings={saveSettings} />);
    openReaderMenu();
    const binding = screen.getByRole("button", { name: "修改向下翻页快捷键" });
    await user.click(binding);
    fireEvent.keyDown(window, { key: "x", code: "KeyX", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("alert")).toHaveTextContent("只支持一个");
    expect(binding).toHaveAttribute("aria-pressed", "true");
    const backdrop = document.querySelector(".reader-menu-backdrop");
    if (!backdrop) throw new Error("Reader menu backdrop did not render.");
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole("dialog", { name: "阅读菜单" })).not.toBeInTheDocument();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("restores the previous shortcut when persistence fails", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn().mockRejectedValue(new Error("save failed"));
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={DEFAULT_READER_SETTINGS} onSaveSettings={saveSettings} />);
    openReaderMenu();
    const binding = screen.getByRole("button", { name: "修改向上翻页快捷键" });
    await user.click(binding);
    await user.keyboard("x");
    await waitFor(() => expect(binding).toHaveTextContent("A"));
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
