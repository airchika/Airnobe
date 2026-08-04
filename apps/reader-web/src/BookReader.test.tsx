import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BlockNode, ImageBlock, TextBlock } from "@airnobe/book-format";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookReader, captureReadingAnchor, findNavigationTarget, type ReaderRow } from "./BookReader.js";
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

function navigationRows(kinds: Array<"text" | "image" | "divider">): ReaderRow[] {
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
        : {
            id,
            type: "divider",
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
  });

  it("keeps Q and E independent while publisher ruby remains visible", async () => {
    const user = userEvent.setup();
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} {...readerSettingsProps} />);

    expect(document.querySelectorAll("[data-japanese-variant]")).toHaveLength(0);
    await user.keyboard("q");
    expect(document.querySelectorAll("[data-japanese-variant]").length).toBeGreaterThan(0);
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.queryByText("とびら")).not.toBeInTheDocument();
    expect(screen.queryByText("まど")).not.toBeInTheDocument();

    await user.keyboard("e");
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.getByText("とびら")).toBeInTheDocument();
    expect(screen.getByText("まど")).toBeInTheDocument();

    await user.keyboard("q");
    expect(document.querySelectorAll("[data-japanese-variant]")).toHaveLength(0);
    openReaderMenu();
    expect(screen.getByRole("button", { name: /注音/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("captures independent text blocks at the top and bottom reading edges", () => {
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} {...readerSettingsProps} />);
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
    render(<BookReader loaded={book} onChooseBook={() => {}} {...readerSettingsProps} />);
    expect(document.querySelector("#demo-image")).toHaveAttribute("data-reading-anchor");
  });

  it("opens a centered desktop menu and disables unavailable generated ruby", async () => {
    const user = userEvent.setup();
    const base = createDemoBook();
    delete base.book.derivation;
    for (const document of base.documents) {
      for (const block of document.blocks) {
        if (block.type !== "text") continue;
        for (const variant of block.variants) {
          for (const node of variant.content) {
            if (node.type === "ruby" && node.origin !== "source") node.origin = "source";
          }
        }
      }
    }
    render(<BookReader loaded={base} onChooseBook={() => {}} {...readerSettingsProps} />);
    expect(document.querySelector(".reader-toolbar")).not.toBeInTheDocument();
    openReaderMenu();
    expect(screen.getByRole("dialog", { name: "阅读菜单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /注音/ })).toBeDisabled();
    const backdrop = document.querySelector(".reader-menu-backdrop");
    if (backdrop) fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole("dialog", { name: "阅读菜单" })).not.toBeInTheDocument();
    openReaderMenu();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "阅读菜单" })).not.toBeInTheDocument();
  });

  it("leaves a pure Chinese book unchanged when Q and E are pressed", async () => {
    const user = userEvent.setup();
    const chinese = createDemoBook();
    delete chinese.book.derivation;
    for (const document of chinese.documents) {
      for (const block of document.blocks) {
        if (block.type !== "text") continue;
        block.variants = block.variants.filter((variant) => variant.language !== "ja-JP");
      }
    }
    render(<BookReader loaded={chinese} onChooseBook={() => {}} {...readerSettingsProps} />);
    const before = document.querySelector(".virtual-book")?.textContent;
    await user.keyboard("qe");
    expect(document.querySelector(".virtual-book")?.textContent).toBe(before);
  });

  it("uses bottom W/S and top R/F anchors with two-text jumps while skipping a divider", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const loaded = createLongBook(30);
    const divider = createDemoBook().documents[0]?.blocks.find((block) => block.type === "divider");
    if (!divider || !loaded.documents[0]) throw new Error("Demo book is missing its divider fixture.");
    loaded.documents[0].blocks.splice(11, 0, structuredClone(divider));
    render(<BookReader loaded={loaded} onChooseBook={() => {}} {...readerSettingsProps} />);
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

  it("turns A and D by one viewport after a short fade instead of smooth scrolling", () => {
    vi.useFakeTimers();
    const scrollBy = vi.spyOn(window, "scrollBy");
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} {...readerSettingsProps} />);
    fireEvent.keyDown(window, { key: "a" });
    expect(document.querySelector(".reading-column")).toHaveClass("reading-column--page-turning");
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "d" });
    act(() => vi.advanceTimersByTime(100));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ top: -window.innerHeight, behavior: "instant" });
    expect(document.querySelector(".reading-column")).not.toHaveClass("reading-column--page-turning");
    act(() => vi.advanceTimersByTime(120));
    fireEvent.keyDown(window, { key: "d" });
    act(() => vi.advanceTimersByTime(100));
    expect(scrollBy).toHaveBeenLastCalledWith({ top: window.innerHeight, behavior: "instant" });
  });

  it("edits global backward and forward navigation counts from the reader menu", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <BookReader
        loaded={createDemoBook()}
        onChooseBook={() => {}}
        settings={DEFAULT_READER_SETTINGS}
        onSaveSettings={saveSettings}
      />,
    );
    openReaderMenu();
    const backward = screen.getByRole("spinbutton", { name: "回退段数" });
    await user.clear(backward);
    await user.type(backward, "3");
    fireEvent.blur(backward);
    expect(saveSettings).toHaveBeenCalledWith({
      version: 1,
      navigation: { backwardTextSteps: 3, forwardTextSteps: 2 },
    });

    const forward = screen.getByRole("spinbutton", { name: "快进段数" });
    await user.clear(forward);
    await user.type(forward, "0");
    fireEvent.blur(forward);
    expect(forward).toHaveValue(2);
    expect(saveSettings).toHaveBeenCalledTimes(1);

    const scrollTo = vi.spyOn(window, "scrollTo");
    await user.click(forward);
    await user.keyboard("f");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("keeps a long book bounded and scrolls internal links to unmounted rows", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    render(<BookReader loaded={createLongBook(200, true)} onChooseBook={() => {}} {...readerSettingsProps} />);
    expect(document.querySelectorAll("[data-virtual-row]").length).toBeLessThan(60);
    expect(document.querySelector("#long-paragraph-199")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "跳到结尾" }));
    const targetTop = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
    expect(targetTop).toBeGreaterThan(5_000);
  });
});
