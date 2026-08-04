import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BlockNode, TextBlock } from "@airnobe/book-format";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookReader, captureReadingAnchor } from "./BookReader.js";
import type { LoadedBook } from "./book-source.js";
import { createDemoBook } from "./demo-book.js";

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

describe("BookReader", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps Q and E independent while publisher ruby remains visible", async () => {
    const user = userEvent.setup();
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} />);

    expect(document.querySelectorAll("[data-japanese-variant]")).toHaveLength(0);
    await user.keyboard("q");
    expect(document.querySelectorAll("[data-japanese-variant]").length).toBeGreaterThan(0);
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.queryByText("まど")).not.toBeInTheDocument();

    await user.keyboard("e");
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.getByText("まど")).toBeInTheDocument();

    await user.keyboard("q");
    expect(document.querySelectorAll("[data-japanese-variant]")).toHaveLength(0);
    openReaderMenu();
    expect(screen.getByRole("button", { name: /注音/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("captures independent text blocks at the top and bottom reading edges", () => {
    render(<BookReader loaded={createDemoBook()} onChooseBook={() => {}} />);
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

  it("opens a centered desktop menu and disables unavailable generated ruby", async () => {
    const user = userEvent.setup();
    const base = createDemoBook();
    delete base.book.derivation;
    for (const document of base.documents) {
      for (const block of document.blocks) {
        if (block.type !== "text") continue;
        for (const variant of block.variants) {
          for (const node of variant.content) {
            if (node.type === "ruby" && node.origin === "generated") node.origin = "source";
          }
        }
      }
    }
    render(<BookReader loaded={base} onChooseBook={() => {}} />);
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
    render(<BookReader loaded={chinese} onChooseBook={() => {}} />);
    const before = document.querySelector(".virtual-book")?.textContent;
    await user.keyboard("qe");
    expect(document.querySelector(".virtual-book")?.textContent).toBe(before);
  });

  it("moves W and S between text blocks while skipping a divider", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const loaded = createLongBook(30);
    const divider = createDemoBook().documents[0]?.blocks.find((block) => block.type === "divider");
    if (!divider || !loaded.documents[0]) throw new Error("Demo book is missing its divider fixture.");
    loaded.documents[0].blocks.splice(11, 0, structuredClone(divider));
    render(<BookReader loaded={loaded} onChooseBook={() => {}} />);
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
    scrollTo.mockClear();
    await user.keyboard("w");
    const previousTop = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
    expect(nextTop).toBeGreaterThan(previousTop);
  });

  it("pages A and D around complete or clipped edge text blocks", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    render(<BookReader loaded={createLongBook(30)} onChooseBook={() => {}} />);
    let clipped = true;
    for (const element of document.querySelectorAll<HTMLElement>("[data-reading-anchor]")) {
      const index = Number(element.id.replace("long-paragraph-", ""));
      Object.defineProperty(element, "getBoundingClientRect", { value: () => {
        if (index < 10) return { top: -500 + (index * 40), bottom: -470 + (index * 40) };
        if (index === 10) return clipped
          ? { top: -20, bottom: 50 }
          : { top: 24, bottom: 94 };
        if (index < 15) {
          const top = 140 + ((index - 11) * 100);
          return { top, bottom: top + 70 };
        }
        if (index === 15) return clipped
          ? { top: window.innerHeight - 50, bottom: window.innerHeight + 20 }
          : { top: window.innerHeight - 100, bottom: window.innerHeight - 30 };
        const top = window.innerHeight + 30 + ((index - 16) * 80);
        return { top, bottom: top + 70 };
      } });
    }
    const maximumScrollTop = (): number => Math.max(
      ...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)),
    );

    await user.keyboard("a");
    const clippedPreviousTop = maximumScrollTop();
    scrollTo.mockClear();
    clipped = false;
    await user.keyboard("a");
    const completePreviousTop = maximumScrollTop();
    expect(clippedPreviousTop).toBeGreaterThan(completePreviousTop);

    scrollTo.mockClear();
    clipped = true;
    await user.keyboard("d");
    const clippedNextTop = maximumScrollTop();
    scrollTo.mockClear();
    clipped = false;
    await user.keyboard("d");
    const completeNextTop = maximumScrollTop();
    expect(completeNextTop).toBeGreaterThan(clippedNextTop);
  });

  it("keeps a long book bounded and scrolls internal links to unmounted rows", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    render(<BookReader loaded={createLongBook(200, true)} onChooseBook={() => {}} />);
    expect(document.querySelectorAll("[data-virtual-row]").length).toBeLessThan(60);
    expect(document.querySelector("#long-paragraph-199")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "跳到结尾" }));
    const targetTop = Math.max(...scrollTo.mock.calls.map((call) => Number((call[0] as ScrollToOptions).top ?? 0)));
    expect(targetTop).toBeGreaterThan(5_000);
  });
});
