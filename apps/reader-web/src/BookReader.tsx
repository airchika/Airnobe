import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useWindowVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import type {
  BlockNode,
  BookDocument,
  ContentVariant,
  LinkTarget,
  TextBlock,
} from "@airnobe/book-format";
import { hasGeneratedRuby, type LoadedBook } from "./book-source.js";
import { InlineContent } from "./InlineContent.js";

interface BookReaderProps {
  loaded: LoadedBook;
  onChooseBook(): void;
}

interface ReadingAnchor {
  id: string;
  top: number;
  bottom: number;
}

type ReadingEdge = "top" | "bottom";

interface ReaderRow {
  block: BlockNode;
  documentId: string;
  documentRole: BookDocument["role"];
  documentStart: boolean;
}

const READING_EDGE = 24;
const OVERSCAN = 8;

export function captureReadingAnchor(edge: ReadingEdge = "top"): ReadingAnchor | undefined {
  const elements = [...document.querySelectorAll<HTMLElement>("[data-reading-anchor]")];
  if (elements.length === 0) return undefined;
  if (edge === "bottom") {
    const boundary = window.innerHeight - READING_EDGE;
    const containing = elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= boundary && rect.bottom >= boundary;
      })
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0];
    const previous = elements
      .filter((element) => element.getBoundingClientRect().top < boundary)
      .sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0];
    const element = containing ?? previous ?? elements[0];
    if (!element?.id) return undefined;
    const rect = element.getBoundingClientRect();
    return { id: element.id, top: rect.top, bottom: rect.bottom };
  }
  const containing = elements
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top <= READING_EDGE && rect.bottom > READING_EDGE;
    })
    .sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0];
  const next = elements
    .filter((element) => element.getBoundingClientRect().top > READING_EDGE)
    .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0];
  const element = containing ?? next ?? elements.at(-1);
  if (!element?.id) return undefined;
  const rect = element.getBoundingClientRect();
  return { id: element.id, top: rect.top, bottom: rect.bottom };
}

function restoreReadingAnchor(anchor: ReadingAnchor | undefined): void {
  if (!anchor) return;
  requestAnimationFrame(() => {
    const element = document.getElementById(anchor.id);
    if (!element) return;
    const delta = element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: "instant" });
  });
}

function primaryVariant(block: TextBlock): ContentVariant | undefined {
  const chinese = block.variants
    .filter((variant) => variant.language === "zh-CN")
    .sort((left, right) => left.order - right.order);
  return chinese[0]
    ?? block.variants.find((variant) => variant.language !== "ja-JP")
    ?? block.variants[0];
}

function japaneseVariant(block: TextBlock): ContentVariant | undefined {
  return block.variants.find((variant) => variant.language === "ja-JP");
}

function flattenDocuments(documents: BookDocument[]): ReaderRow[] {
  return documents.flatMap((document) => document.blocks.map((block, index) => ({
    block,
    documentId: document.id,
    documentRole: document.role,
    documentStart: index === 0,
  })));
}

function estimateRowSize(row: ReaderRow): number {
  const documentSpacing = row.documentStart ? 64 : 0;
  if (row.block.type === "image") return 560 + documentSpacing;
  if (row.block.type === "divider") return 112 + documentSpacing;
  if (row.block.role === "heading") return 128 + documentSpacing;
  if (row.block.role === "caption") return 54 + documentSpacing;
  return 72 + documentSpacing;
}

function measureMountedRows(virtualizer: Virtualizer<Window, HTMLElement>): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-virtual-row]")) {
    virtualizer.measureElement(element);
  }
}

export function BookReader({ loaded, onChooseBook }: BookReaderProps) {
  const [showJapanese, setShowJapanese] = useState(false);
  const [showGeneratedRuby, setShowGeneratedRuby] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const firstMenuButtonRef = useRef<HTMLButtonElement>(null);
  const generatedAvailable = useMemo(() => hasGeneratedRuby(loaded), [loaded]);
  const renderGeneratedRuby = showGeneratedRuby && generatedAvailable;
  const rows = useMemo(() => flattenDocuments(loaded.documents), [loaded.documents]);
  const rowIndexByBlockId = useMemo(
    () => new Map(rows.map((row, index) => [row.block.id, index])),
    [rows],
  );
  const textRowIndices = useMemo(
    () => rows.flatMap((row, index) => row.block.type === "text" ? [index] : []),
    [rows],
  );

  const virtualizer = useWindowVirtualizer<HTMLElement>({
    count: rows.length,
    estimateSize: (index) => estimateRowSize(rows[index] as ReaderRow),
    getItemKey: (index) => (rows[index] as ReaderRow).block.id,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: OVERSCAN,
    scrollPaddingStart: READING_EDGE,
  });

  const toggleWithAnchor = useCallback((update: () => void) => {
    const anchor = captureReadingAnchor();
    flushSync(update);
    measureMountedRows(virtualizer);
    restoreReadingAnchor(anchor);
  }, [virtualizer]);

  const toggleJapanese = useCallback(() => {
    toggleWithAnchor(() => setShowJapanese((value) => !value));
  }, [toggleWithAnchor]);

  const toggleGeneratedRuby = useCallback(() => {
    if (!generatedAvailable) return;
    toggleWithAnchor(() => setShowGeneratedRuby((value) => !value));
  }, [generatedAvailable, toggleWithAnchor]);

  const jumpTextBlock = useCallback((direction: -1 | 1) => {
    if (textRowIndices.length === 0) return;
    const anchor = captureReadingAnchor(direction < 0 ? "top" : "bottom");
    const currentIndex = anchor ? rowIndexByBlockId.get(anchor.id) : undefined;
    let targetIndex: number | undefined;
    if (currentIndex === undefined) {
      targetIndex = direction > 0 ? textRowIndices[0] : textRowIndices.at(-1);
    } else if (direction > 0) {
      targetIndex = textRowIndices.find((index) => index > currentIndex);
    } else {
      for (let index = textRowIndices.length - 1; index >= 0; index -= 1) {
        const candidate = textRowIndices[index];
        if (candidate !== undefined && candidate < currentIndex) {
          targetIndex = candidate;
          break;
        }
      }
    }
    if (targetIndex !== undefined) {
      virtualizer.scrollToIndex(targetIndex, { align: direction < 0 ? "start" : "end" });
    }
  }, [rowIndexByBlockId, textRowIndices, virtualizer]);

  const pageTextBlocks = useCallback((direction: -1 | 1) => {
    const fallback = (): void => window.scrollBy({
      top: direction * window.innerHeight,
      behavior: "smooth",
    });
    if (textRowIndices.length === 0) {
      fallback();
      return;
    }
    const anchor = captureReadingAnchor(direction < 0 ? "top" : "bottom");
    const currentIndex = anchor ? rowIndexByBlockId.get(anchor.id) : undefined;
    if (!anchor || currentIndex === undefined) {
      fallback();
      return;
    }
    const incomplete = anchor.top < READING_EDGE
      || anchor.bottom > window.innerHeight - READING_EDGE;
    let targetIndex = incomplete ? currentIndex : undefined;
    if (!incomplete && direction > 0) {
      targetIndex = textRowIndices.find((index) => index > currentIndex);
    } else if (!incomplete) {
      for (let index = textRowIndices.length - 1; index >= 0; index -= 1) {
        const candidate = textRowIndices[index];
        if (candidate !== undefined && candidate < currentIndex) {
          targetIndex = candidate;
          break;
        }
      }
    }
    if (targetIndex !== undefined) {
      virtualizer.scrollToIndex(targetIndex, { align: direction < 0 ? "end" : "start" });
    }
  }, [rowIndexByBlockId, textRowIndices, virtualizer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "escape" && menuOpen) {
        event.preventDefault();
        setMenuOpen(false);
      } else if (key === "q" && !event.repeat) {
        event.preventDefault();
        toggleJapanese();
      } else if (key === "e" && !event.repeat) {
        event.preventDefault();
        toggleGeneratedRuby();
      } else if (key === "w") {
        event.preventDefault();
        jumpTextBlock(-1);
      } else if (key === "s") {
        event.preventDefault();
        jumpTextBlock(1);
      } else if (key === "a") {
        event.preventDefault();
        pageTextBlocks(-1);
      } else if (key === "d") {
        event.preventDefault();
        pageTextBlocks(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jumpTextBlock, menuOpen, pageTextBlocks, toggleGeneratedRuby, toggleJapanese]);

  useEffect(() => {
    if (menuOpen) firstMenuButtonRef.current?.focus();
  }, [menuOpen]);

  const followInternalLink = useCallback((target: Extract<LinkTarget, { kind: "internal" }>) => {
    const targetDocument = loaded.documentById.get(target.documentId);
    const blockId = target.fragmentId
      ? targetDocument?.anchors[target.fragmentId]
      : targetDocument?.blocks[0]?.id;
    const targetIndex = blockId ? rowIndexByBlockId.get(blockId) : undefined;
    if (targetIndex !== undefined) virtualizer.scrollToIndex(targetIndex, { align: "start" });
  }, [loaded.documentById, rowIndexByBlockId, virtualizer]);

  const openBook = useCallback(() => {
    setMenuOpen(false);
    onChooseBook();
  }, [onChooseBook]);

  return (
    <div
      className="reader-app"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <main className="reading-column">
        <div className="virtual-book" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index] as ReaderRow;
            return (
              <div
                className={`virtual-row virtual-row--${row.documentRole}${row.documentStart ? " virtual-row--document-start" : ""}`}
                data-document-id={row.documentId}
                data-index={virtualRow.index}
                data-virtual-row
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <Block
                  block={row.block}
                  loaded={loaded}
                  showJapanese={showJapanese}
                  showGeneratedRuby={renderGeneratedRuby}
                  onInternalLink={followInternalLink}
                />
              </div>
            );
          })}
        </div>

        <footer className="book-end"><span>完</span></footer>
      </main>

      {menuOpen && (
        <div
          className="reader-menu-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMenuOpen(false);
          }}
        >
          <div className="reader-menu" role="dialog" aria-modal="true" aria-label="阅读菜单">
            <button ref={firstMenuButtonRef} type="button" onClick={openBook}>
              <span>打开 EPUB</span>
            </button>
            <button type="button" aria-pressed={showJapanese} onClick={toggleJapanese}>
              <span>日文</span><kbd>Q</kbd><b>{showJapanese ? "开" : "关"}</b>
            </button>
            <button
              type="button"
              aria-pressed={showGeneratedRuby}
              disabled={!generatedAvailable}
              onClick={toggleGeneratedRuby}
              title={generatedAvailable ? undefined : "本书没有程序生成注音"}
            >
              <span>注音</span><kbd>E</kbd><b>{showGeneratedRuby ? "开" : "关"}</b>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface BlockProps {
  block: BlockNode;
  loaded: LoadedBook;
  showJapanese: boolean;
  showGeneratedRuby: boolean;
  onInternalLink(target: Extract<LinkTarget, { kind: "internal" }>): void;
}

const Block = memo(function Block({ block, loaded, showJapanese, showGeneratedRuby, onInternalLink }: BlockProps) {
  if (block.type === "image") {
    const source = loaded.assetUrlById.get(block.assetId);
    return (
      <figure className={`image-block image-block--${block.role}`} id={block.id}>
        {source
          ? <img src={source} alt={block.alt} loading="lazy" />
          : <div className="missing-block">{block.alt || "插图资源缺失"}</div>}
        {block.alt && <figcaption>{block.alt}</figcaption>}
      </figure>
    );
  }
  if (block.type === "divider") {
    const source = block.assetId ? loaded.assetUrlById.get(block.assetId) : undefined;
    return source
      ? <div className="divider-block" id={block.id}><img src={source} alt="" loading="lazy" /></div>
      : <div className="divider-block divider-block--plain" id={block.id} aria-hidden="true"><span>◆</span></div>;
  }

  const primary = primaryVariant(block);
  const japanese = japaneseVariant(block);
  const japaneseIsPrimary = primary === japanese;
  const Tag = block.role === "heading" ? "h2" : block.role === "caption" ? "figcaption" : "div";
  return (
    <Tag
      className={`text-block text-block--${block.role}`}
      id={block.id}
      data-reading-anchor
      data-block-id={block.id}
    >
      {primary && (
        <span className={`content-variant ${primary.language === "ja-JP" ? "content-variant--ja" : "content-variant--zh"}`} lang={primary.language}>
          <InlineContent
            nodes={primary.content}
            showGeneratedRuby={showGeneratedRuby}
            assetUrlById={loaded.assetUrlById}
            onInternalLink={onInternalLink}
          />
        </span>
      )}
      {showJapanese && japanese && !japaneseIsPrimary && (
        <span className="content-variant content-variant--ja" lang="ja-JP" data-japanese-variant>
          <InlineContent
            nodes={japanese.content}
            showGeneratedRuby={showGeneratedRuby}
            assetUrlById={loaded.assetUrlById}
            onInternalLink={onInternalLink}
          />
        </span>
      )}
    </Tag>
  );
});
