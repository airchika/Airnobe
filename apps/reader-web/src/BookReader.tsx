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
import { hasAssistedRuby, type LoadedBook } from "./book-source.js";
import { InlineContent } from "./InlineContent.js";
import { isNavigationStepCount, type ReaderSettings } from "./reader-settings.js";

interface BookReaderProps {
  loaded: LoadedBook;
  onChooseBook(): void;
  settings: ReaderSettings;
  onSaveSettings(settings: ReaderSettings): Promise<void>;
}

interface ReadingAnchor {
  id: string;
  top: number;
}

type ReadingEdge = "top" | "bottom";

export interface ReaderRow {
  block: BlockNode;
  documentId: string;
  documentRole: BookDocument["role"];
  documentStart: boolean;
}

const READING_EDGE = 24;
const OVERSCAN = 8;
const PAGE_TURN_FADE_OUT_MS = 100;
const PAGE_TURN_FADE_IN_MS = 120;

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
    return { id: element.id, top: element.getBoundingClientRect().top };
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
  return { id: element.id, top: element.getBoundingClientRect().top };
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

function isNavigationRow(row: ReaderRow | undefined): boolean {
  return row?.block.type === "text" || row?.block.type === "image";
}

export function findNavigationTarget(
  rows: ReaderRow[],
  currentIndex: number | undefined,
  direction: -1 | 1,
  textSteps: number,
): number | undefined {
  let index = currentIndex === undefined ? (direction > 0 ? -1 : rows.length) : currentIndex;
  let remainingTextSteps = textSteps;
  let passedText = false;
  let lastNavigable: number | undefined;
  while (true) {
    index += direction;
    const row = rows[index];
    if (!row) return lastNavigable;
    if (row.block.type === "divider") continue;
    if (row.block.type === "image") return passedText ? lastNavigable : index;
    lastNavigable = index;
    passedText = true;
    remainingTextSteps -= 1;
    if (remainingTextSteps === 0) return index;
  }
}

export function BookReader({ loaded, onChooseBook, settings, onSaveSettings }: BookReaderProps) {
  const [showJapanese, setShowJapanese] = useState(false);
  const [showAssistedRuby, setShowAssistedRuby] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navigation, setNavigation] = useState(settings.navigation);
  const [backwardInput, setBackwardInput] = useState(String(settings.navigation.backwardTextSteps));
  const [forwardInput, setForwardInput] = useState(String(settings.navigation.forwardTextSteps));
  const firstMenuButtonRef = useRef<HTMLButtonElement>(null);
  const pageTurnInProgressRef = useRef(false);
  const pageTurnTimerRef = useRef<number | undefined>(undefined);
  const pageTurnReleaseTimerRef = useRef<number | undefined>(undefined);
  const [pageTurning, setPageTurning] = useState(false);
  const assistedAvailable = useMemo(() => hasAssistedRuby(loaded), [loaded]);
  const renderAssistedRuby = showAssistedRuby && assistedAvailable;
  const rows = useMemo(() => flattenDocuments(loaded.documents), [loaded.documents]);
  const rowIndexByBlockId = useMemo(
    () => new Map(rows.map((row, index) => [row.block.id, index])),
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

  const toggleAssistedRuby = useCallback(() => {
    if (!assistedAvailable) return;
    toggleWithAnchor(() => setShowAssistedRuby((value) => !value));
  }, [assistedAvailable, toggleWithAnchor]);

  useEffect(() => {
    setNavigation(settings.navigation);
    setBackwardInput(String(settings.navigation.backwardTextSteps));
    setForwardInput(String(settings.navigation.forwardTextSteps));
  }, [settings.navigation.backwardTextSteps, settings.navigation.forwardTextSteps]);

  const jumpNavigationUnit = useCallback((
    direction: -1 | 1,
    edge: ReadingEdge,
    textSteps: number,
  ) => {
    if (!isNavigationStepCount(textSteps) || !rows.some(isNavigationRow)) return;
    const anchor = captureReadingAnchor(edge);
    const currentIndex = anchor ? rowIndexByBlockId.get(anchor.id) : undefined;
    const targetIndex = findNavigationTarget(rows, currentIndex, direction, textSteps);
    if (targetIndex !== undefined) {
      virtualizer.scrollToIndex(targetIndex, { align: edge === "top" ? "start" : "end" });
    }
  }, [rowIndexByBlockId, rows, virtualizer]);

  const turnPage = useCallback((direction: -1 | 1) => {
    const distance = direction * window.innerHeight;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      window.scrollBy({ top: distance, behavior: "instant" });
      return;
    }
    if (pageTurnInProgressRef.current) return;
    pageTurnInProgressRef.current = true;
    setPageTurning(true);
    pageTurnTimerRef.current = window.setTimeout(() => {
      window.scrollBy({ top: distance, behavior: "instant" });
      setPageTurning(false);
      pageTurnReleaseTimerRef.current = window.setTimeout(() => {
        pageTurnInProgressRef.current = false;
      }, PAGE_TURN_FADE_IN_MS);
    }, PAGE_TURN_FADE_OUT_MS);
  }, []);

  useEffect(() => () => {
    if (pageTurnTimerRef.current !== undefined) window.clearTimeout(pageTurnTimerRef.current);
    if (pageTurnReleaseTimerRef.current !== undefined) window.clearTimeout(pageTurnReleaseTimerRef.current);
  }, []);

  const commitNavigationInput = useCallback((kind: "backward" | "forward") => {
    const raw = kind === "backward" ? backwardInput : forwardInput;
    const parsed = Number(raw);
    const previous = kind === "backward" ? navigation.backwardTextSteps : navigation.forwardTextSteps;
    const restore = (): void => {
      if (kind === "backward") setBackwardInput(String(previous));
      else setForwardInput(String(previous));
    };
    if (!isNavigationStepCount(parsed)) {
      restore();
      return;
    }
    if (parsed === previous) return;
    const next: ReaderSettings = {
      version: 1,
      navigation: {
        ...navigation,
        ...(kind === "backward" ? { backwardTextSteps: parsed } : { forwardTextSteps: parsed }),
      },
    };
    setNavigation(next.navigation);
    void onSaveSettings(next).catch(() => {
      setNavigation(settings.navigation);
      restore();
    });
  }, [backwardInput, forwardInput, navigation, onSaveSettings, settings]);

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
        toggleAssistedRuby();
      } else if (key === "w") {
        event.preventDefault();
        jumpNavigationUnit(-1, "bottom", navigation.backwardTextSteps);
      } else if (key === "s") {
        event.preventDefault();
        jumpNavigationUnit(1, "bottom", navigation.forwardTextSteps);
      } else if (key === "r") {
        event.preventDefault();
        jumpNavigationUnit(-1, "top", navigation.backwardTextSteps);
      } else if (key === "f") {
        event.preventDefault();
        jumpNavigationUnit(1, "top", navigation.forwardTextSteps);
      } else if (key === "a") {
        event.preventDefault();
        turnPage(-1);
      } else if (key === "d") {
        event.preventDefault();
        turnPage(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jumpNavigationUnit, menuOpen, navigation.backwardTextSteps, navigation.forwardTextSteps, toggleAssistedRuby, toggleJapanese, turnPage]);

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
      <main className={`reading-column${pageTurning ? " reading-column--page-turning" : ""}`}>
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
                  showAssistedRuby={renderAssistedRuby}
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
              aria-pressed={showAssistedRuby}
              disabled={!assistedAvailable}
              onClick={toggleAssistedRuby}
              title={assistedAvailable ? undefined : "本书没有程序补充注音"}
            >
              <span>注音</span><kbd>E</kbd><b>{showAssistedRuby ? "开" : "关"}</b>
            </button>
            <label className="reader-menu-setting">
              <span>回退</span><kbd>R / W</kbd>
              <input
                aria-label="回退段数"
                type="number"
                min="1"
                max="99"
                step="1"
                value={backwardInput}
                onChange={(event) => setBackwardInput(event.target.value)}
                onBlur={() => commitNavigationInput("backward")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setBackwardInput(String(navigation.backwardTextSteps));
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <label className="reader-menu-setting">
              <span>快进</span><kbd>F / S</kbd>
              <input
                aria-label="快进段数"
                type="number"
                min="1"
                max="99"
                step="1"
                value={forwardInput}
                onChange={(event) => setForwardInput(event.target.value)}
                onBlur={() => commitNavigationInput("forward")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setForwardInput(String(navigation.forwardTextSteps));
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
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
  showAssistedRuby: boolean;
  onInternalLink(target: Extract<LinkTarget, { kind: "internal" }>): void;
}

const Block = memo(function Block({ block, loaded, showJapanese, showAssistedRuby, onInternalLink }: BlockProps) {
  if (block.type === "image") {
    const source = loaded.assetUrlById.get(block.assetId);
    return (
      <figure
        className={`image-block image-block--${block.role}`}
        id={block.id}
        data-reading-anchor
        data-block-id={block.id}
      >
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
            showAssistedRuby={showAssistedRuby}
            assetUrlById={loaded.assetUrlById}
            onInternalLink={onInternalLink}
          />
        </span>
      )}
      {showJapanese && japanese && !japaneseIsPrimary && (
        <span className="content-variant content-variant--ja" lang="ja-JP" data-japanese-variant>
          <InlineContent
            nodes={japanese.content}
            showAssistedRuby={showAssistedRuby}
            assetUrlById={loaded.assetUrlById}
            onInternalLink={onInternalLink}
          />
        </span>
      )}
    </Tag>
  );
});
