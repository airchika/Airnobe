import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { defaultRangeExtractor, useWindowVirtualizer } from "@tanstack/react-virtual";
import type {
  BlockNode,
  BookDocument,
  ContentVariant,
  LinkTarget,
  TextBlock,
  TocItem,
} from "@airnobe/book-format";
import { inlinePlainText } from "@airnobe/book-format";
import { hasAssistedRuby, hasKatakanaRomaji, type LoadedBook } from "./book-source.js";
import { InlineContent, type RubyVisibilityPhase } from "./InlineContent.js";
import { SettingsPanel } from "./SettingsPanel.js";
import type { AvailableTheme } from "./theme-client.js";
import type { ThemeDefinition } from "./themes.js";
import type { ReadingPosition } from "./reading-state.js";
import type { BookmarkDraft, BookmarkMutationResult, BookmarkState } from "./bookmarks.js";
import { useSpatialNavigation } from "./spatial-navigation.js";
import { isTauriRuntime, setFullscreenState, toggleFullscreenState, watchFullscreenState } from "./fullscreen.js";
import {
  assignShortcutBinding,
  DISPLAY_SHORTCUT_ACTIONS,
  isNavigationStepCount,
  isShortcutCode,
  NAVIGATION_SHORTCUT_ACTIONS,
  SHORTCUT_ACTIONS,
  type ReaderSettings,
  type ShortcutAction,
  type ShortcutBinding,
} from "./reader-settings.js";
import { matchesShortcut, shortcutModifier, ShortcutBindingButton, SHORTCUT_LABELS } from "./shortcut-bindings.js";

interface BookReaderProps {
  loaded: LoadedBook;
  onChooseBook(): void;
  onReturnToLibrary(): void;
  themes?: AvailableTheme[];
  onImportTheme?(theme: ThemeDefinition): Promise<AvailableTheme>;
  onThemesChange?(themes: AvailableTheme[]): void;
  settings: ReaderSettings;
  onSaveSettings(settings: ReaderSettings): Promise<void>;
  onPreviewSettings?(settings: ReaderSettings): void;
  onSaveReadingPosition?(position: ReadingPosition): Promise<void>;
  onAddBookmark?(draft: BookmarkDraft): Promise<BookmarkMutationResult>;
  onDeleteBookmark?(bookmarkId: string): Promise<BookmarkState>;
  onError?(message: string): void;
  keyboardNavigationEnabled?: boolean;
}

interface ReadingAnchor {
  id: string;
  top: number;
}

interface ActiveReadingAnchor {
  anchor: ReadingAnchor;
  rowIndex: number;
  kind: "layout" | "restore";
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
const LAYOUT_EXPAND_MS = 160;
const CONTENT_FADE_MS = 180;
const LAYOUT_ANCHOR_LOCK_MS = LAYOUT_EXPAND_MS + CONTENT_FADE_MS + 40;
const JAPANESE_FADE_OUT_MS = 360;
const JAPANESE_COLLAPSE_MS = 320;
const JAPANESE_HIDE_ANCHOR_LOCK_MS = JAPANESE_FADE_OUT_MS + JAPANESE_COLLAPSE_MS + 40;

export interface VisibilityTiming {
  expandMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  collapseMs: number;
}

const DEFAULT_VISIBILITY_TIMING: Readonly<VisibilityTiming> = {
  expandMs: LAYOUT_EXPAND_MS,
  fadeInMs: CONTENT_FADE_MS,
  fadeOutMs: CONTENT_FADE_MS,
  collapseMs: LAYOUT_EXPAND_MS,
};

export const JAPANESE_VISIBILITY_TIMING: Readonly<VisibilityTiming> = {
  expandMs: LAYOUT_EXPAND_MS,
  fadeInMs: CONTENT_FADE_MS,
  fadeOutMs: JAPANESE_FADE_OUT_MS,
  collapseMs: JAPANESE_COLLAPSE_MS,
};

interface TocEntry {
  key: string;
  label: string;
  depth: number;
  targetIndex?: number;
}

function tocTargetIndex(
  item: TocItem,
  documentById: Map<string, BookDocument>,
  rowIndexByBlockId: Map<string, number>,
): number | undefined {
  if (!item.target) return undefined;
  const document = documentById.get(item.target.documentId);
  const blockId = item.target.fragmentId ? document?.anchors[item.target.fragmentId] : document?.blocks[0]?.id;
  return blockId ? rowIndexByBlockId.get(blockId) : undefined;
}

export function flattenToc(
  items: TocItem[],
  documentById: Map<string, BookDocument>,
  rowIndexByBlockId: Map<string, number>,
  depth = 0,
  prefix = "",
): TocEntry[] {
  return items.flatMap((item, index) => {
    const key = `${prefix}${index}`;
    const targetIndex = tocTargetIndex(item, documentById, rowIndexByBlockId);
    return [{
      key,
      label: item.label,
      depth,
      ...(targetIndex === undefined ? {} : { targetIndex }),
    }, ...flattenToc(item.children, documentById, rowIndexByBlockId, depth + 1, `${key}.`)];
  });
}

export function currentTocEntry(entries: TocEntry[], rowIndex: number | undefined): TocEntry | undefined {
  if (rowIndex === undefined) return undefined;
  return entries.reduce<TocEntry | undefined>((current, entry) => {
    if (entry.targetIndex === undefined || entry.targetIndex > rowIndex) return current;
    if (!current || current.targetIndex === undefined || entry.targetIndex > current.targetIndex) return entry;
    return entry.targetIndex === current.targetIndex && entry.depth >= current.depth ? entry : current;
  }, undefined);
}

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

function adjustReadingAnchor(anchor: ReadingAnchor): void {
  const element = document.getElementById(anchor.id);
  if (!element) return;
  const delta = element.getBoundingClientRect().top - anchor.top;
  if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: "instant" });
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

function estimateRowSize(row: ReaderRow, spacerHeight = 30.4): number {
  const documentSpacing = row.documentStart ? 64 : 0;
  if (row.block.type === "image") return 560 + documentSpacing;
  if (row.block.type === "divider") return 112 + documentSpacing;
  if (row.block.type === "spacer") return spacerHeight + documentSpacing;
  if (row.block.role === "heading") return 128 + documentSpacing;
  if (row.block.role === "caption") return 54 + documentSpacing;
  return 72 + documentSpacing;
}

export function useStagedVisibility(
  visible: boolean,
  timing: Readonly<VisibilityTiming> = DEFAULT_VISIBILITY_TIMING,
): RubyVisibilityPhase {
  const [phase, setPhase] = useState<RubyVisibilityPhase>(visible ? "visible" : "hidden");
  const phaseRef = useRef(phase);
  const timersRef = useRef<number[]>([]);
  const commitPhase = useCallback((next: RubyVisibilityPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  useEffect(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      commitPhase(visible ? "visible" : "hidden");
      return;
    }
    const schedule = (delay: number, next: RubyVisibilityPhase) => {
      timersRef.current.push(window.setTimeout(() => commitPhase(next), delay));
    };
    const current = phaseRef.current;
    if (visible) {
      if (current === "visible" || current === "entering") return;
      if (current === "fading") {
        commitPhase("entering");
        schedule(timing.fadeInMs, "visible");
      } else {
        commitPhase("expanding");
        schedule(timing.expandMs, "entering");
        schedule(timing.expandMs + timing.fadeInMs, "visible");
      }
    } else {
      if (current === "hidden" || current === "collapsing") return;
      if (current === "expanding") {
        commitPhase("collapsing");
        schedule(timing.collapseMs, "hidden");
      } else {
        commitPhase("fading");
        schedule(timing.fadeOutMs, "collapsing");
        schedule(timing.fadeOutMs + timing.collapseMs, "hidden");
      }
    }
    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
      timersRef.current = [];
    };
  }, [commitPhase, timing.collapseMs, timing.expandMs, timing.fadeInMs, timing.fadeOutMs, visible]);
  return phase;
}

function bookmarkExcerpt(block: BlockNode): string {
  if (block.type === "image") return block.alt.trim() || "插图";
  if (block.type !== "text") return "书签";
  const text = inlinePlainText(primaryVariant(block)?.content ?? []).replace(/\s+/g, " ").trim();
  return text ? Array.from(text).slice(0, 60).join("") : "书签";
}

function displayAnchorLockDuration(
  key: "showJapanese" | "showAssistedRuby" | "showKatakanaRomaji",
  visible: boolean,
): number {
  return key === "showJapanese" && !visible ? JAPANESE_HIDE_ANCHOR_LOCK_MS : LAYOUT_ANCHOR_LOCK_MS;
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
    if (row.block.type === "divider" || row.block.type === "spacer") continue;
    if (row.block.type === "image") return passedText ? lastNavigable : index;
    if (row.block.type !== "text") continue;
    lastNavigable = index;
    passedText = true;
    remainingTextSteps -= 1;
    if (remainingTextSteps === 0) return index;
  }
}

function ShortcutColumn({ title, actions, zone, zoneOrder, shortcuts, capturingAction, onCapture }: {
  title: string;
  actions: readonly ShortcutAction[];
  zone: string;
  zoneOrder: string;
  shortcuts: ReaderSettings["shortcuts"];
  capturingAction: ShortcutAction | undefined;
  onCapture(action: ShortcutAction): void;
}) {
  return (
    <section className="shortcut-dialog-column">
      <h3>{title}</h3>
      <div className="shortcut-dialog-list">
        {actions.map((action, index) => (
          <div className="reader-menu-shortcut-row" key={action}>
            <span>{SHORTCUT_LABELS[action]}</span>
            <ShortcutBindingButton
              action={action}
              binding={shortcuts[action]}
              capturing={capturingAction === action}
              onCapture={onCapture}
              spatialRow={String(index)}
              spatialZone={zone}
              spatialZoneOrder={zoneOrder}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function BookReader({ loaded, onReturnToLibrary, settings, onSaveSettings, onPreviewSettings = () => {}, onSaveReadingPosition, onAddBookmark, onDeleteBookmark, onError = () => {}, themes = [], onImportTheme = async () => { throw new Error("主题导入不可用。"); }, onThemesChange = () => {}, keyboardNavigationEnabled = true }: BookReaderProps) {
  const [showJapanese, setShowJapanese] = useState(() => settings.appearance.display.showJapanese);
  const [showAssistedRuby, setShowAssistedRuby] = useState(() => settings.appearance.display.showAssistedRuby);
  const [showKatakanaRomaji, setShowKatakanaRomaji] = useState(() => settings.appearance.display.showKatakanaRomaji);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [currentRowIndex, setCurrentRowIndex] = useState<number>();
  const [navigation, setNavigation] = useState(settings.navigation);
  const [shortcuts, setShortcuts] = useState(settings.shortcuts);
  const [capturingAction, setCapturingAction] = useState<ShortcutAction>();
  const [bindingError, setBindingError] = useState<string>();
  const [pageTransitions, setPageTransitions] = useState(settings.pageTransitions);
  const [fullscreen, setFullscreen] = useState(false);
  const [bookmarkState, setBookmarkState] = useState(() => structuredClone(loaded.bookmarkState));
  const [bookmarkNotice, setBookmarkNotice] = useState<string>();
  const [pinnedAnchorIndex, setPinnedAnchorIndex] = useState<number>();
  const readerRootRef = useRef<HTMLDivElement>(null);
  const sidebarRootRef = useRef<HTMLDivElement>(null);
  const shortcutDialogRef = useRef<HTMLDivElement>(null);
  const shortcutButtonRef = useRef<HTMLButtonElement>(null);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const pageTurnInProgressRef = useRef(false);
  const pageTurnTimerRef = useRef<number | undefined>(undefined);
  const pageTurnReleaseTimerRef = useRef<number | undefined>(undefined);
  const anchorReleaseTimerRef = useRef<number | undefined>(undefined);
  const anchorReleaseFrameRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const shortcutSaveRevisionRef = useRef(0);
  const progressSaveTimerRef = useRef<number | undefined>(undefined);
  const progressFrameRef = useRef<number | undefined>(undefined);
  const restoreFrameRef = useRef<number | undefined>(undefined);
  const restoreCancelRef = useRef<(() => void) | undefined>(undefined);
  const restoreSettledRef = useRef(false);
  const initialReadingPositionRef = useRef<ReadingPosition | null>(
    loaded.readingState.position ? { ...loaded.readingState.position } : null,
  );
  const lastSavedPositionRef = useRef<string | undefined>(undefined);
  const suppressProgressSaveUntilRef = useRef(0);
  const activeAnchorRef = useRef<ActiveReadingAnchor | undefined>(undefined);
  const measuredRowKeysRef = useRef(new Set<unknown>());
  const bookmarkNoticeTimerRef = useRef<number | undefined>(undefined);
  const [pageTurning, setPageTurning] = useState(false);
  const assistedAvailable = useMemo(() => hasAssistedRuby(loaded), [loaded]);
  const katakanaRomajiAvailable = useMemo(() => hasKatakanaRomaji(loaded), [loaded]);
  const renderAssistedRuby = showAssistedRuby && assistedAvailable;
  const renderKatakanaRomaji = showKatakanaRomaji && katakanaRomajiAvailable;
  const japanesePhase = useStagedVisibility(showJapanese, JAPANESE_VISIBILITY_TIMING);
  const assistedRubyPhase = useStagedVisibility(renderAssistedRuby);
  const katakanaRomajiPhase = useStagedVisibility(renderKatakanaRomaji);
  const rows = useMemo(() => flattenDocuments(loaded.documents), [loaded.documents]);
  const rowIndexByBlockId = useMemo(
    () => new Map(rows.map((row, index) => [row.block.id, index])),
    [rows],
  );
  const navigableRowIndices = useMemo(
    () => rows.flatMap((row, index) => isNavigationRow(row) ? [index] : []),
    [rows],
  );
  const navigableOrdinalByRowIndex = useMemo(
    () => new Map(navigableRowIndices.map((rowIndex, ordinal) => [rowIndex, ordinal])),
    [navigableRowIndices],
  );
  const tocEntries = useMemo(
    () => flattenToc(loaded.book.toc, loaded.documentById, rowIndexByBlockId),
    [loaded.book.toc, loaded.documentById, rowIndexByBlockId],
  );
  const bookmarkEntries = useMemo(() => bookmarkState.bookmarks.flatMap((bookmark) => {
    const rowIndex = rowIndexByBlockId.get(bookmark.position.blockId);
    if (rowIndex === undefined) return [];
    const ordinal = navigableOrdinalByRowIndex.get(rowIndex);
    if (ordinal === undefined) return [];
    return [{
      bookmark,
      rowIndex,
      chapterLabel: currentTocEntry(tocEntries, rowIndex)?.label ?? bookmark.position.chapterLabel,
      progress: navigableRowIndices.length <= 1 ? 1 : ordinal / (navigableRowIndices.length - 1),
    }];
  }).sort((left, right) => left.rowIndex - right.rowIndex || left.bookmark.createdAt.localeCompare(right.bookmark.createdAt)), [bookmarkState.bookmarks, navigableOrdinalByRowIndex, navigableRowIndices.length, rowIndexByBlockId, tocEntries]);
  const activeTocEntry = useMemo(() => currentTocEntry(tocEntries, currentRowIndex), [currentRowIndex, tocEntries]);

  const initialReadingPosition = initialReadingPositionRef.current;
  const initialTargetIndex = initialReadingPosition ? rowIndexByBlockId.get(initialReadingPosition.blockId) : undefined;
  const initialTargetRow = initialTargetIndex === undefined ? undefined : rows[initialTargetIndex];
  const validInitialTarget = initialReadingPosition
    && initialTargetIndex !== undefined
    && initialTargetRow?.documentId === initialReadingPosition.documentId
    && isNavigationRow(initialTargetRow)
    ? initialTargetIndex
    : undefined;
  const estimatedSpacerHeight = settings.appearance.typography.fontSize * (
    settings.appearance.typography.lineHeight + settings.appearance.typography.paragraphSpacing
  );
  const initialScrollOffset = useMemo(() => {
    if (validInitialTarget === undefined || !initialReadingPosition) return 0;
    const targetStart = rows.slice(0, validInitialTarget)
      .reduce((total, row) => total + estimateRowSize(row, estimatedSpacerHeight), 0);
    return Math.max(0, targetStart - initialReadingPosition.viewportOffset);
  }, [estimatedSpacerHeight, initialReadingPosition, rows, validInitialTarget]);

  const virtualizer = useWindowVirtualizer<HTMLElement>({
    count: rows.length,
    estimateSize: (index) => estimateRowSize(
      rows[index] as ReaderRow,
      settings.appearance.typography.fontSize * (
        settings.appearance.typography.lineHeight + settings.appearance.typography.paragraphSpacing
      ),
    ),
    getItemKey: (index) => (rows[index] as ReaderRow).block.id,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range);
      if (pinnedAnchorIndex === undefined || indices.includes(pinnedAnchorIndex)) return indices;
      return [...indices, pinnedAnchorIndex].sort((left, right) => left - right);
    },
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: OVERSCAN,
    scrollPaddingStart: READING_EDGE,
    initialOffset: initialScrollOffset,
    useFlushSync: true,
  });
  const virtualItems = virtualizer.getVirtualItems();

  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
    if (!measuredRowKeysRef.current.has(item.key)) return false;
    const activeAnchor = activeAnchorRef.current;
    if (activeAnchor) return item.index < activeAnchor.rowIndex;
    const scrollOffset = virtualizer.scrollOffset ?? window.scrollY;
    return item.end <= scrollOffset;
  };

  const measureVirtualRow = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const index = Number(element.dataset.index);
    const key = rows[index]?.block.id;
    virtualizer.measureElement(element);
    if (key !== undefined) measuredRowKeysRef.current.add(key);
  }, [rows, virtualizer]);

  const adjustActiveAnchor = useCallback(() => {
    const active = activeAnchorRef.current;
    if (active) adjustReadingAnchor(active.anchor);
  }, []);

  const releaseActiveAnchor = useCallback((finalAdjustment = true) => {
    if (anchorReleaseTimerRef.current !== undefined) window.clearTimeout(anchorReleaseTimerRef.current);
    if (anchorReleaseFrameRef.current !== undefined) cancelAnimationFrame(anchorReleaseFrameRef.current);
    anchorReleaseTimerRef.current = undefined;
    anchorReleaseFrameRef.current = undefined;
    if (finalAdjustment) adjustActiveAnchor();
    suppressProgressSaveUntilRef.current = performance.now() + 100;
    activeAnchorRef.current = undefined;
    setPinnedAnchorIndex(undefined);
  }, [adjustActiveAnchor]);

  const beginLayoutAnchorLock = useCallback((duration = LAYOUT_ANCHOR_LOCK_MS) => {
    const existing = activeAnchorRef.current;
    const anchor = existing?.kind === "layout" ? existing.anchor : captureReadingAnchor("top");
    if (!anchor) return;
    const rowIndex = rowIndexByBlockId.get(anchor.id);
    if (rowIndex === undefined) return;
    activeAnchorRef.current = { anchor, rowIndex, kind: "layout" };
    setPinnedAnchorIndex(rowIndex);
    suppressProgressSaveUntilRef.current = performance.now() + duration + 100;
    if (anchorReleaseTimerRef.current !== undefined) window.clearTimeout(anchorReleaseTimerRef.current);
    if (anchorReleaseFrameRef.current !== undefined) cancelAnimationFrame(anchorReleaseFrameRef.current);
    anchorReleaseTimerRef.current = window.setTimeout(() => {
      anchorReleaseFrameRef.current = requestAnimationFrame(() => releaseActiveAnchor(true));
    }, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : duration);
  }, [releaseActiveAnchor, rowIndexByBlockId]);

  const captureReadingPosition = useCallback((): ReadingPosition | undefined => {
    const anchor = captureReadingAnchor("top");
    if (!anchor) return undefined;
    const rowIndex = rowIndexByBlockId.get(anchor.id);
    if (rowIndex === undefined) return undefined;
    const row = rows[rowIndex];
    const ordinal = navigableOrdinalByRowIndex.get(rowIndex);
    if (!row || ordinal === undefined) return undefined;
    const progress = navigableRowIndices.length <= 1 ? 1 : ordinal / (navigableRowIndices.length - 1);
    return {
      documentId: row.documentId,
      blockId: row.block.id,
      viewportOffset: anchor.top,
      progress,
      chapterLabel: currentTocEntry(tocEntries, rowIndex)?.label ?? null,
    };
  }, [navigableOrdinalByRowIndex, navigableRowIndices.length, rowIndexByBlockId, rows, tocEntries]);

  const persistReadingPosition = useCallback(async (): Promise<void> => {
    if (!loaded.libraryBookId || !onSaveReadingPosition) return;
    const position = captureReadingPosition();
    if (!position) return;
    setCurrentRowIndex(rowIndexByBlockId.get(position.blockId));
    const serialized = JSON.stringify(position);
    if (serialized === lastSavedPositionRef.current) return;
    lastSavedPositionRef.current = serialized;
    try {
      await onSaveReadingPosition(position);
    } catch (error) {
      if (lastSavedPositionRef.current === serialized) lastSavedPositionRef.current = undefined;
      throw error;
    }
  }, [captureReadingPosition, loaded.libraryBookId, onSaveReadingPosition, rowIndexByBlockId]);

  useEffect(() => {
    if (restoreSettledRef.current) return;
    const position = initialReadingPosition;
    const targetIndex = validInitialTarget;
    if (!position || targetIndex === undefined) {
      const frame = requestAnimationFrame(() => {
        const anchor = captureReadingAnchor("top");
        setCurrentRowIndex(anchor ? rowIndexByBlockId.get(anchor.id) : navigableRowIndices[0]);
        restoreSettledRef.current = true;
      });
      return () => cancelAnimationFrame(frame);
    }
    setCurrentRowIndex(targetIndex);
    lastSavedPositionRef.current = JSON.stringify(position);
    let active = true;
    let fontsReady = !document.fonts;
    let lastLayoutChange = performance.now();
    const startedAt = lastLayoutChange;
    let initialAlignmentDone = false;
    const observed = new Set<Element>();
    const decodingImages = new Set<HTMLImageElement>();
    const decodedImages = new WeakSet<HTMLImageElement>();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => { lastLayoutChange = performance.now(); });
    const observeMountedRows = (): void => {
      for (const element of document.querySelectorAll<HTMLElement>("[data-virtual-row]")) {
        if (observer && !observed.has(element)) { observed.add(element); observer.observe(element); }
        for (const image of element.querySelectorAll<HTMLImageElement>("img")) {
          if (!image.complete || decodingImages.has(image) || decodedImages.has(image) || typeof image.decode !== "function") continue;
          decodingImages.add(image);
          void image.decode().catch(() => {}).finally(() => {
            decodingImages.delete(image);
            decodedImages.add(image);
            lastLayoutChange = performance.now();
          });
        }
      }
    };
    const targetAnchor: ActiveReadingAnchor = {
      anchor: { id: position.blockId, top: position.viewportOffset },
      rowIndex: targetIndex,
      kind: "restore",
    };
    activeAnchorRef.current = targetAnchor;
    setPinnedAnchorIndex(targetIndex);
    suppressProgressSaveUntilRef.current = Number.POSITIVE_INFINITY;
    const stop = (finalAdjustment: boolean, settleRestore: boolean): void => {
      if (!active) return;
      if (finalAdjustment) adjustReadingAnchor(targetAnchor.anchor);
      active = false;
      if (settleRestore) restoreSettledRef.current = true;
      observer?.disconnect();
      if (restoreFrameRef.current !== undefined) cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = undefined;
      if (activeAnchorRef.current === targetAnchor) activeAnchorRef.current = undefined;
      setPinnedAnchorIndex(undefined);
      suppressProgressSaveUntilRef.current = performance.now() + 100;
      if (restoreCancelRef.current === cancelRestore) restoreCancelRef.current = undefined;
      window.removeEventListener("wheel", cancelForUserInput);
      window.removeEventListener("touchstart", cancelForUserInput);
      window.removeEventListener("pointerdown", cancelForUserInput);
    };
    const cancelForUserInput = (): void => stop(false, true);
    const cancelRestore = (): void => stop(false, true);
    restoreCancelRef.current = cancelRestore;
    const stabilize = (): void => {
      if (!active) return;
      observeMountedRows();
      const element = document.getElementById(position.blockId);
      if (element && !initialAlignmentDone) {
        adjustReadingAnchor(targetAnchor.anchor);
        initialAlignmentDone = true;
        lastLayoutChange = performance.now();
      }
      const pendingImages = [...document.querySelectorAll<HTMLImageElement>("[data-virtual-row] img")]
        .some((image) => !image.complete || decodingImages.has(image));
      const now = performance.now();
      if ((element && fontsReady && !pendingImages && now - lastLayoutChange >= 300) || now - startedAt >= 5_000) {
        stop(true, true);
        return;
      }
      restoreFrameRef.current = requestAnimationFrame(stabilize);
    };
    if (document.fonts) void document.fonts.ready.then(() => {
      if (!active) return;
      fontsReady = true;
      lastLayoutChange = performance.now();
    });
    virtualizer.scrollToOffset(initialScrollOffset, { align: "start" });
    restoreFrameRef.current = requestAnimationFrame(stabilize);
    window.addEventListener("wheel", cancelForUserInput, { passive: true, once: true });
    window.addEventListener("touchstart", cancelForUserInput, { passive: true, once: true });
    window.addEventListener("pointerdown", cancelForUserInput, { passive: true, once: true });
    return () => {
      stop(false, false);
      window.removeEventListener("wheel", cancelForUserInput);
      window.removeEventListener("touchstart", cancelForUserInput);
      window.removeEventListener("pointerdown", cancelForUserInput);
    };
  }, [initialReadingPosition, initialScrollOffset, navigableRowIndices, rowIndexByBlockId, validInitialTarget, virtualizer]);

  useEffect(() => {
    const updateCurrentPosition = (): void => {
      const position = captureReadingPosition();
      if (position) setCurrentRowIndex(rowIndexByBlockId.get(position.blockId));
    };
    const onScroll = (): void => {
      if (progressFrameRef.current !== undefined) cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = requestAnimationFrame(updateCurrentPosition);
      if (restoreCancelRef.current || activeAnchorRef.current || performance.now() < suppressProgressSaveUntilRef.current) return;
      if (!loaded.libraryBookId || !onSaveReadingPosition) return;
      if (progressSaveTimerRef.current !== undefined) window.clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = window.setTimeout(() => {
        void persistReadingPosition().catch(() => {});
      }, 750);
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== "hidden") return;
      if (restoreCancelRef.current || activeAnchorRef.current || performance.now() < suppressProgressSaveUntilRef.current) return;
      if (progressSaveTimerRef.current !== undefined) window.clearTimeout(progressSaveTimerRef.current);
      void persistReadingPosition().catch(() => {});
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (progressSaveTimerRef.current !== undefined) window.clearTimeout(progressSaveTimerRef.current);
      if (progressFrameRef.current !== undefined) cancelAnimationFrame(progressFrameRef.current);
      if (restoreFrameRef.current !== undefined) cancelAnimationFrame(restoreFrameRef.current);
    };
  }, [captureReadingPosition, loaded.libraryBookId, onSaveReadingPosition, persistReadingPosition, rowIndexByBlockId]);

  useEffect(() => {
    const releaseLayoutLockForUserInput = (): void => {
      if (activeAnchorRef.current?.kind === "layout") releaseActiveAnchor(false);
    };
    window.addEventListener("wheel", releaseLayoutLockForUserInput, { passive: true });
    window.addEventListener("touchstart", releaseLayoutLockForUserInput, { passive: true });
    return () => {
      window.removeEventListener("wheel", releaseLayoutLockForUserInput);
      window.removeEventListener("touchstart", releaseLayoutLockForUserInput);
    };
  }, [releaseActiveAnchor]);

  useLayoutEffect(() => {
    adjustActiveAnchor();
  }, [adjustActiveAnchor, assistedRubyPhase, japanesePhase, katakanaRomajiPhase, settings.appearance.typography.columnWidth, settings.appearance.typography.fontSize, settings.appearance.typography.fontWeight, settings.appearance.typography.lineHeight, settings.appearance.typography.paragraphSpacing, settings.appearance.typography.japaneseOpacity, settings.appearance.typography.rubyScale, sidebarOpen, virtualItems]);

  useEffect(() => {
    if (!document.fonts) return;
    let active = true;
    if (!activeAnchorRef.current) beginLayoutAnchorLock(5_000);
    void Promise.all([
      document.fonts.load(`${settings.appearance.typography.fontWeight} ${settings.appearance.typography.fontSize}px "Sarasa Gothic SC"`),
      document.fonts.load(`${settings.appearance.typography.fontWeight} ${settings.appearance.typography.fontSize}px "Sarasa Gothic J"`),
    ]).then(() => {
      if (!active) return;
      adjustActiveAnchor();
      if (activeAnchorRef.current?.kind === "layout") releaseActiveAnchor(true);
    });
    return () => { active = false; };
  }, [adjustActiveAnchor, beginLayoutAnchorLock, releaseActiveAnchor, settings.appearance.typography.fontSize, settings.appearance.typography.fontWeight]);

  const animateLayoutWithAnchor = useCallback((update: () => void, duration = LAYOUT_ANCHOR_LOCK_MS) => {
    beginLayoutAnchorLock(duration);
    update();
  }, [beginLayoutAnchorLock]);

  const saveDisplay = useCallback((key: "showJapanese" | "showAssistedRuby" | "showKatakanaRomaji", value: boolean) => {
    const previous = settings.appearance.display[key];
    const next = { ...settings, appearance: { ...settings.appearance, display: { ...settings.appearance.display, [key]: value } } };
    onPreviewSettings(next);
    void onSaveSettings(next).catch(() => {
      beginLayoutAnchorLock(displayAnchorLockDuration(key, previous));
      if (key === "showJapanese") setShowJapanese(previous);
      else if (key === "showAssistedRuby") setShowAssistedRuby(previous);
      else setShowKatakanaRomaji(previous);
    });
  }, [beginLayoutAnchorLock, onPreviewSettings, onSaveSettings, settings]);

  const toggleJapanese = useCallback(() => {
    const next = !showJapanese;
    animateLayoutWithAnchor(() => setShowJapanese(next), displayAnchorLockDuration("showJapanese", next));
    saveDisplay("showJapanese", next);
  }, [animateLayoutWithAnchor, saveDisplay, showJapanese]);

  const toggleAssistedRuby = useCallback(() => {
    const next = !showAssistedRuby;
    animateLayoutWithAnchor(() => setShowAssistedRuby(next)); saveDisplay("showAssistedRuby", next);
  }, [animateLayoutWithAnchor, saveDisplay, showAssistedRuby]);

  const toggleKatakanaRomaji = useCallback(() => {
    const next = !showKatakanaRomaji;
    animateLayoutWithAnchor(() => setShowKatakanaRomaji(next)); saveDisplay("showKatakanaRomaji", next);
  }, [animateLayoutWithAnchor, saveDisplay, showKatakanaRomaji]);

  useEffect(() => {
    setNavigation(settings.navigation);
    setShortcuts(settings.shortcuts);
    setPageTransitions(settings.pageTransitions);
    const display = settings.appearance.display;
    if (showJapanese !== display.showJapanese || showAssistedRuby !== display.showAssistedRuby || showKatakanaRomaji !== display.showKatakanaRomaji) {
      const lockDuration = Math.max(
        showJapanese !== display.showJapanese ? displayAnchorLockDuration("showJapanese", display.showJapanese) : 0,
        showAssistedRuby !== display.showAssistedRuby ? displayAnchorLockDuration("showAssistedRuby", display.showAssistedRuby) : 0,
        showKatakanaRomaji !== display.showKatakanaRomaji ? displayAnchorLockDuration("showKatakanaRomaji", display.showKatakanaRomaji) : 0,
      );
      beginLayoutAnchorLock(lockDuration);
      setShowJapanese(display.showJapanese);
      setShowAssistedRuby(display.showAssistedRuby);
      setShowKatakanaRomaji(display.showKatakanaRomaji);
    }
  }, [beginLayoutAnchorLock, settings.appearance.display, settings.navigation.textSteps, settings.pageTransitions, settings.shortcuts, showAssistedRuby, showJapanese, showKatakanaRomaji]);

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
      virtualizer.scrollToIndex(targetIndex, { align: edge === "top" ? "start" : "end", behavior: "smooth" });
    }
  }, [rowIndexByBlockId, rows, virtualizer]);

  const performViewChange = useCallback((update: () => void) => {
    if (!pageTransitions || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }
    if (pageTurnInProgressRef.current) return;
    pageTurnInProgressRef.current = true;
    if (typeof document.startViewTransition === "function") {
      const transition = document.startViewTransition(update);
      void transition.finished.then(
        () => { pageTurnInProgressRef.current = false; },
        () => { pageTurnInProgressRef.current = false; },
      );
      return;
    }
    setPageTurning(true);
    pageTurnTimerRef.current = window.setTimeout(() => {
      update();
      setPageTurning(false);
      pageTurnReleaseTimerRef.current = window.setTimeout(() => {
        pageTurnInProgressRef.current = false;
      }, PAGE_TURN_FADE_IN_MS);
    }, PAGE_TURN_FADE_OUT_MS);
  }, [pageTransitions]);

  const turnPage = useCallback((direction: -1 | 1) => {
    performViewChange(() => window.scrollBy({ top: direction * window.innerHeight, behavior: "instant" }));
  }, [performViewChange]);

  const showBookmarkNotice = useCallback((message: string) => {
    if (bookmarkNoticeTimerRef.current !== undefined) window.clearTimeout(bookmarkNoticeTimerRef.current);
    setBookmarkNotice(message);
    bookmarkNoticeTimerRef.current = window.setTimeout(() => setBookmarkNotice(undefined), 1_800);
  }, []);

  const jumpToReadingPosition = useCallback((position: ReadingPosition) => {
    const targetIndex = rowIndexByBlockId.get(position.blockId);
    if (targetIndex === undefined) return;
    restoreCancelRef.current?.();
    performViewChange(() => {
      setCurrentRowIndex(targetIndex);
      setPinnedAnchorIndex(targetIndex);
      virtualizer.scrollToIndex(targetIndex, { align: "start", behavior: "instant" });
      let attempts = 0;
      const align = (): void => {
        const element = document.getElementById(position.blockId);
        if (element) {
          adjustReadingAnchor({ id: position.blockId, top: position.viewportOffset });
          setPinnedAnchorIndex(undefined);
          return;
        }
        attempts += 1;
        if (attempts < 12) requestAnimationFrame(align);
        else setPinnedAnchorIndex(undefined);
      };
      requestAnimationFrame(align);
    });
  }, [performViewChange, rowIndexByBlockId, virtualizer]);

  const addCurrentBookmark = useCallback(async () => {
    if (!loaded.libraryBookId || !onAddBookmark || !onDeleteBookmark) {
      showBookmarkNotice("书签只保存到书库书籍");
      return;
    }
    const position = captureReadingPosition();
    if (!position) return;
    const existing = bookmarkState.bookmarks.find((bookmark) => bookmark.position.blockId === position.blockId);
    if (existing) {
      const previous = bookmarkState;
      setBookmarkState({ version: 1, bookmarks: previous.bookmarks.filter((bookmark) => bookmark.id !== existing.id) });
      try {
        setBookmarkState(await onDeleteBookmark(existing.id));
        showBookmarkNotice("已取消书签");
      } catch (error) {
        setBookmarkState(previous);
        onError((error as Error).message);
      }
      return;
    }
    const rowIndex = rowIndexByBlockId.get(position.blockId);
    const row = rowIndex === undefined ? undefined : rows[rowIndex];
    if (!row) return;
    try {
      const result = await onAddBookmark({ position, excerpt: bookmarkExcerpt(row.block) });
      if (result.outcome === "duplicate") {
        const duplicate = result.state.bookmarks.find((bookmark) => bookmark.position.blockId === position.blockId);
        if (duplicate) {
          setBookmarkState(await onDeleteBookmark(duplicate.id));
          showBookmarkNotice("已取消书签");
          return;
        }
      }
      setBookmarkState(result.state);
      showBookmarkNotice("已添加书签");
    } catch (error) {
      onError((error as Error).message);
    }
  }, [bookmarkState, captureReadingPosition, loaded.libraryBookId, onAddBookmark, onDeleteBookmark, onError, rowIndexByBlockId, rows, showBookmarkNotice]);

  const deleteSavedBookmark = useCallback(async (bookmarkId: string) => {
    if (!onDeleteBookmark) return;
    const previous = bookmarkState;
    const previousIndex = bookmarkEntries.findIndex((entry) => entry.bookmark.id === bookmarkId);
    const next = { version: 1 as const, bookmarks: previous.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId) };
    setBookmarkState(next);
    try {
      const saved = await onDeleteBookmark(bookmarkId);
      setBookmarkState(saved);
      requestAnimationFrame(() => {
        const nextEntry = bookmarkEntries.filter((entry) => entry.bookmark.id !== bookmarkId)[Math.max(0, previousIndex - (previousIndex >= bookmarkEntries.length - 1 ? 1 : 0))];
        const target = nextEntry
          ? sidebarRootRef.current?.querySelector<HTMLElement>(`[data-bookmark-id="${nextEntry.bookmark.id}"]`)
          : (activeTocEntry ? sidebarRootRef.current?.querySelector<HTMLElement>(`[data-toc-key="${activeTocEntry.key}"]`) : sidebarRootRef.current?.querySelector<HTMLElement>("[data-spatial-item]"));
        target?.focus({ preventScroll: true });
      });
    } catch (error) {
      setBookmarkState(previous);
      onError((error as Error).message);
    }
  }, [activeTocEntry, bookmarkEntries, bookmarkState, onDeleteBookmark, onError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (anchorReleaseTimerRef.current !== undefined) window.clearTimeout(anchorReleaseTimerRef.current);
      if (anchorReleaseFrameRef.current !== undefined) cancelAnimationFrame(anchorReleaseFrameRef.current);
      if (pageTurnTimerRef.current !== undefined) window.clearTimeout(pageTurnTimerRef.current);
      if (pageTurnReleaseTimerRef.current !== undefined) window.clearTimeout(pageTurnReleaseTimerRef.current);
      if (bookmarkNoticeTimerRef.current !== undefined) window.clearTimeout(bookmarkNoticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void watchFullscreenState((next) => { if (!disposed) setFullscreen(next); })
      .then((cleanup) => { if (disposed) cleanup(); else stop = cleanup; })
      .catch(() => {});
    return () => { disposed = true; stop?.(); };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.readerActive = "true";
    root.dataset.readerScrollbarHidden = "true";
    root.dataset.readerFullscreen = String(fullscreen);
    return () => {
      delete root.dataset.readerActive;
      delete root.dataset.readerScrollbarHidden;
      delete root.dataset.readerFullscreen;
    };
  }, [fullscreen]);

  const toggleFullscreen = useCallback(() => {
    void toggleFullscreenState()
      .then(setFullscreen)
      .catch(() => onError("无法切换全屏，请检查窗口权限。"));
  }, [onError]);

  const beginShortcutCapture = useCallback((action: ShortcutAction) => {
    setCapturingAction(action);
    setBindingError(undefined);
  }, []);

  const rememberOverlayFocus = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest(".reader-sidebar")) {
      overlayReturnFocusRef.current = active;
    } else if (!active || active === document.body) {
      overlayReturnFocusRef.current = null;
    }
  }, []);

  const restoreOverlayFocus = useCallback(() => {
    requestAnimationFrame(() => (overlayReturnFocusRef.current ?? readerRootRef.current)?.focus({ preventScroll: true }));
  }, []);

  const closeSidebar = useCallback((restoreFocus = true) => {
    setCapturingAction(undefined);
    setBindingError(undefined);
    setShortcutDialogOpen(false);
    setSidebarOpen(false);
    if (restoreFocus) restoreOverlayFocus();
  }, [restoreOverlayFocus]);

  const toggleSidebar = useCallback(() => {
    beginLayoutAnchorLock();
    if (sidebarOpen) {
      closeSidebar();
      return;
    }
    rememberOverlayFocus();
    setSidebarOpen(true);
  }, [beginLayoutAnchorLock, closeSidebar, rememberOverlayFocus, sidebarOpen]);

  const closeShortcutDialog = useCallback(() => {
    setCapturingAction(undefined);
    setBindingError(undefined);
    setShortcutDialogOpen(false);
    requestAnimationFrame(() => shortcutButtonRef.current?.focus({ preventScroll: true }));
  }, []);

  const openShortcutDialog = useCallback(() => {
    setBindingError(undefined);
    setShortcutDialogOpen(true);
    requestAnimationFrame(() => shortcutDialogRef.current?.querySelector<HTMLElement>(".shortcut-dialog-column:first-child .shortcut-binding")?.focus({ preventScroll: true }));
  }, []);

  const returnToLibrary = useCallback(async () => {
    closeSidebar();
    if (progressSaveTimerRef.current !== undefined) window.clearTimeout(progressSaveTimerRef.current);
    if (!restoreCancelRef.current && !activeAnchorRef.current && performance.now() >= suppressProgressSaveUntilRef.current) {
      await persistReadingPosition().catch(() => {});
    }
    onReturnToLibrary();
  }, [closeSidebar, onReturnToLibrary, persistReadingPosition]);

  useSpatialNavigation({
    rootRef: sidebarRootRef,
    enabled: sidebarOpen && !shortcutDialogOpen && keyboardNavigationEnabled,
    keys: "arrows",
  });
  useSpatialNavigation({ rootRef: shortcutDialogRef, enabled: shortcutDialogOpen && keyboardNavigationEnabled, editing: Boolean(capturingAction), keys: "both" });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!keyboardNavigationEnabled) return;
      if (capturingAction) {
        if (event.key === "Tab") {
          setCapturingAction(undefined);
          setBindingError(undefined);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
          setCapturingAction(undefined);
          setBindingError(undefined);
          return;
        }
        if (event.key === "Backspace") {
          const previousShortcuts = shortcuts;
          setCapturingAction(undefined);
          setBindingError(undefined);
          if (!shortcuts[capturingAction]) return;
          const nextShortcuts = assignShortcutBinding(shortcuts, capturingAction, null);
          const next: ReaderSettings = {
            version: 13,
            navigation,
            shortcuts: nextShortcuts,
            pageTransitions,
            appearance: settings.appearance,
          };
          setShortcuts(nextShortcuts);
          const revision = shortcutSaveRevisionRef.current + 1;
          shortcutSaveRevisionRef.current = revision;
          void onSaveSettings(next).catch(() => {
            if (shortcutSaveRevisionRef.current === revision) setShortcuts(previousShortcuts);
          });
          return;
        }
        if (event.repeat || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
        const modifier = shortcutModifier(event);
        if (modifier === "invalid") {
          setBindingError("只支持一个 Ctrl、Alt 或 Shift 附加键。");
          return;
        }
        if (!isShortcutCode(event.code)) {
          setBindingError("这个按键不能用于阅读快捷键。");
          return;
        }
        const candidate: ShortcutBinding = modifier ? { code: event.code, modifier } : { code: event.code };
        const previousShortcuts = shortcuts;
        const nextShortcuts = assignShortcutBinding(shortcuts, capturingAction, candidate);
        const next: ReaderSettings = {
          version: 13,
          navigation,
          shortcuts: nextShortcuts,
          pageTransitions,
          appearance: settings.appearance,
        };
        setShortcuts(nextShortcuts);
        setCapturingAction(undefined);
        setBindingError(undefined);
        const revision = shortcutSaveRevisionRef.current + 1;
        shortcutSaveRevisionRef.current = revision;
        void onSaveSettings(next).catch(() => {
          if (shortcutSaveRevisionRef.current === revision) setShortcuts(previousShortcuts);
        });
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      if (event.isComposing) return;
      const fixedFullscreenKey = !event.repeat && (
        (event.code === "F11" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey)
        || (event.code === "Enter" && event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey)
      );
      if (fixedFullscreenKey) {
        if (event.code === "F11" && !isTauriRuntime()) return;
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      if (event.key === "Escape" && shortcutDialogOpen) {
        event.preventDefault();
        closeShortcutDialog();
        return;
      }
      if (event.key === "Escape" && sidebarOpen) {
        event.preventDefault();
        closeSidebar();
        return;
      }
      if (event.key === "Escape" && fullscreen && isTauriRuntime()) {
        event.preventDefault();
        void setFullscreenState(false).then(setFullscreen).catch(() => onError("无法退出全屏，请检查窗口权限。"));
        return;
      }
      if (shortcutDialogOpen) return;
      const action = SHORTCUT_ACTIONS.find((candidate) => matchesShortcut(event, shortcuts[candidate]));
      if (!action) return;
      if (event.repeat && ["toggleJapanese", "toggleAssistedRuby", "toggleKatakanaRomaji", "toggleSidebar", "toggleFullscreen", "returnLibrary", "addBookmark"].includes(action)) return;
      event.preventDefault();
      restoreCancelRef.current?.();
      if (action === "toggleJapanese") toggleJapanese();
      else if (action === "toggleAssistedRuby") toggleAssistedRuby();
      else if (action === "toggleKatakanaRomaji") toggleKatakanaRomaji();
      else if (action === "bottomBackward") jumpNavigationUnit(-1, "bottom", navigation.textSteps);
      else if (action === "bottomForward") jumpNavigationUnit(1, "bottom", navigation.textSteps);
      else if (action === "topBackward") jumpNavigationUnit(-1, "top", navigation.textSteps);
      else if (action === "topForward") jumpNavigationUnit(1, "top", navigation.textSteps);
      else if (action === "pageUp") turnPage(-1);
      else if (action === "pageDown") turnPage(1);
      else if (action === "toggleSidebar") toggleSidebar();
      else if (action === "toggleFullscreen") toggleFullscreen();
      else if (action === "returnLibrary") void returnToLibrary();
      else if (action === "addBookmark") void addCurrentBookmark();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addCurrentBookmark, capturingAction, closeShortcutDialog, closeSidebar, fullscreen, jumpNavigationUnit, keyboardNavigationEnabled, navigation, onError, onSaveSettings, pageTransitions, returnToLibrary, settings.appearance, shortcutDialogOpen, shortcuts, sidebarOpen, toggleAssistedRuby, toggleFullscreen, toggleJapanese, toggleKatakanaRomaji, toggleSidebar, turnPage]);

  useEffect(() => {
    if (!sidebarOpen) return;
    requestAnimationFrame(() => {
      const active = activeTocEntry
        ? sidebarRootRef.current?.querySelector<HTMLElement>(`[data-toc-key="${activeTocEntry.key}"]`)
        : undefined;
      const target = active ?? sidebarRootRef.current?.querySelector<HTMLElement>("[data-spatial-item]");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    });
  }, [activeTocEntry, sidebarOpen]);

  const followInternalLink = useCallback((target: Extract<LinkTarget, { kind: "internal" }>) => {
    const targetDocument = loaded.documentById.get(target.documentId);
    const blockId = target.fragmentId
      ? targetDocument?.anchors[target.fragmentId]
      : targetDocument?.blocks[0]?.id;
    const targetIndex = blockId ? rowIndexByBlockId.get(blockId) : undefined;
    if (targetIndex !== undefined) virtualizer.scrollToIndex(targetIndex, { align: "start" });
  }, [loaded.documentById, rowIndexByBlockId, virtualizer]);

  const followTocEntry = useCallback((entry: TocEntry) => {
    if (entry.targetIndex === undefined) return;
    performViewChange(() => {
      setCurrentRowIndex(entry.targetIndex);
      virtualizer.scrollToIndex(entry.targetIndex as number, { align: "start" });
    });
  }, [performViewChange, virtualizer]);

  const wholeProgress = currentRowIndex === undefined ? 0 : (navigableOrdinalByRowIndex.get(currentRowIndex) ?? 0) / Math.max(1, navigableRowIndices.length - 1);
  const activeTocIndex = activeTocEntry ? tocEntries.indexOf(activeTocEntry) : -1;
  const chapterStart = activeTocEntry?.targetIndex;
  const chapterEnd = activeTocIndex >= 0 ? tocEntries.slice(activeTocIndex + 1).find((entry) => entry.targetIndex !== undefined)?.targetIndex : undefined;
  const chapterProgress = chapterStart !== undefined && currentRowIndex !== undefined
    ? Math.max(0, Math.min(1, (currentRowIndex - chapterStart) / Math.max(1, (chapterEnd ?? rows.length - 1) - chapterStart)))
    : undefined;

  return (
    <div
      className={`reader-app${sidebarOpen ? " reader-app--sidebar-open" : ""}`}
      ref={readerRootRef}
      tabIndex={-1}
      data-hide-japanese-rule={!settings.appearance.display.showJapaneseRule}
      data-assisted-ruby={renderAssistedRuby}
      data-assisted-ruby-phase={assistedRubyPhase}
      style={{
        "--reading-width": `${settings.appearance.typography.columnWidth}px`,
        "--reader-font-size": `${settings.appearance.typography.fontSize}px`,
        "--reader-font-weight": settings.appearance.typography.fontWeight,
        "--reader-line-height": settings.appearance.typography.lineHeight,
        "--reader-paragraph-spacing": `${settings.appearance.typography.paragraphSpacing}em`,
        "--reader-line-box": `${settings.appearance.typography.fontSize * settings.appearance.typography.lineHeight}px`,
        "--chinese-opacity-percent": `${settings.appearance.typography.chineseOpacity * 100}%`,
        "--japanese-opacity-percent": `${settings.appearance.typography.japaneseOpacity * 100}%`,
        "--reader-ruby-size": `${settings.appearance.typography.rubyScale}em`,
      } as CSSProperties}
      onContextMenu={(event) => {
        event.preventDefault();
        toggleSidebar();
      }}
    >
      <main className={`reading-column${pageTurning ? " reading-column--page-turning" : ""}`}>
        <div className="virtual-book" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index] as ReaderRow;
            return (
              <div
                className={`virtual-row virtual-row--${row.documentRole}${row.documentStart ? " virtual-row--document-start" : ""}`}
                data-document-id={row.documentId}
                data-index={virtualRow.index}
                data-virtual-row
                key={virtualRow.key}
                ref={measureVirtualRow}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <Block
                  block={row.block}
                  loaded={loaded}
                  showJapanese={showJapanese}
                  japanesePhase={japanesePhase}
                  showAssistedRuby={renderAssistedRuby}
                  showKatakanaRomaji={renderKatakanaRomaji}
                  assistedRubyPhase={assistedRubyPhase}
                  katakanaRomajiPhase={katakanaRomajiPhase}
                  onInternalLink={followInternalLink}
                />
              </div>
            );
          })}
        </div>

        <footer className="book-end"><span>完</span></footer>
      </main>

      {sidebarOpen && <div className="reader-sidebar" ref={sidebarRootRef} aria-label="阅读侧边栏">
        <aside className="reader-sidebar-toc" aria-label="目录"><header><strong>目录</strong><button type="button" data-spatial-item data-spatial-zone="toc" data-spatial-zone-order="0" data-spatial-row="0" aria-label="关闭侧边栏" onClick={() => closeSidebar()}>×</button></header>
          <ol className="toc-list">{tocEntries.map((entry, index) => <li key={entry.key} style={{ paddingLeft: `${10 + entry.depth * 16}px` }}>{entry.targetIndex === undefined ? <span>{entry.label}</span> : <button type="button" data-spatial-item data-spatial-zone="toc" data-spatial-zone-order="0" data-spatial-row={String(index + 1)} data-toc-key={entry.key} aria-current={activeTocEntry?.key === entry.key ? "location" : undefined} onClick={() => followTocEntry(entry)}>{entry.label}</button>}</li>)}</ol>
          <section className="reader-bookmarks" aria-label="书签"><div className="reader-bookmarks-heading"><strong>书签</strong><button type="button" className="bookmark-add" data-spatial-item data-spatial-zone="toc" data-spatial-zone-order="0" data-spatial-row={String(tocEntries.length + 1)} aria-label="添加或取消当前位置书签" title="添加或取消当前位置书签" onClick={() => void addCurrentBookmark()}>+</button></div><ol>{bookmarkEntries.map((entry, index) => <li key={entry.bookmark.id}><button type="button" className="bookmark-delete" data-spatial-item data-spatial-zone="toc" data-spatial-zone-order="0" data-spatial-row={String(tocEntries.length + index + 2)} aria-label={`删除书签：${entry.bookmark.excerpt}`} onClick={() => void deleteSavedBookmark(entry.bookmark.id)}>×</button><button type="button" className="bookmark-target" data-bookmark-id={entry.bookmark.id} data-spatial-item data-spatial-zone="toc" data-spatial-zone-order="0" data-spatial-row={String(tocEntries.length + index + 2)} onClick={() => jumpToReadingPosition(entry.bookmark.position)}><span>{entry.bookmark.excerpt}</span><small>{entry.chapterLabel ? `${entry.chapterLabel} · ` : ""}{Math.round(entry.progress * 100)}%</small></button></li>)}</ol></section>
          {settings.appearance.display.showProgressBars && <div className="reader-progress-summary">{chapterProgress !== undefined && <label><span>{activeTocEntry?.label ?? "当前章节"}</span><b>{Math.round(chapterProgress * 100)}%</b><progress max="1" value={chapterProgress} /></label>}<label><span>全书</span><b>{Math.round(wholeProgress * 100)}%</b><progress max="1" value={wholeProgress} /></label></div>}
        </aside>
        <aside className="reader-sidebar-settings" aria-label="阅读设置" data-spatial-zone-order="1"><div className="sidebar-top-actions"><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-zone-order="1" data-spatial-row="0" aria-pressed={fullscreen} onClick={toggleFullscreen}>{fullscreen ? "退出全屏" : "全屏"}</button><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-zone-order="1" data-spatial-row="0" onClick={() => void returnToLibrary()}>返回书库</button><button ref={shortcutButtonRef} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-zone-order="1" data-spatial-row="0" onClick={openShortcutDialog}>设置快捷键</button></div>
          <SettingsPanel embedded scope="reader" settings={settings} themes={themes} onPreview={(next) => { beginLayoutAnchorLock(); onPreviewSettings(next); }} onSave={onSaveSettings} onImport={onImportTheme} onThemesChange={onThemesChange} />
        </aside>
      </div>}
      {shortcutDialogOpen && <div className="shortcut-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeShortcutDialog(); }}><div className="shortcut-dialog" ref={shortcutDialogRef} role="dialog" aria-modal="true" aria-label="快捷键设置"><header><h2>快捷键</h2><button type="button" aria-label="关闭快捷键设置" onClick={closeShortcutDialog}>×</button></header><div className="shortcut-dialog-columns"><ShortcutColumn title="阅读导航" actions={NAVIGATION_SHORTCUT_ACTIONS} zone="shortcut-navigation" zoneOrder="0" shortcuts={shortcuts} capturingAction={capturingAction} onCapture={beginShortcutCapture} /><ShortcutColumn title="显示与应用" actions={DISPLAY_SHORTCUT_ACTIONS} zone="shortcut-display" zoneOrder="1" shortcuts={shortcuts} capturingAction={capturingAction} onCapture={beginShortcutCapture} /></div>{bindingError && <p className="reader-menu-error" role="alert">{bindingError}</p>}</div></div>}
      {bookmarkNotice && <div className="reader-bookmark-notice" role="status" aria-live="polite">{bookmarkNotice}</div>}
    </div>
  );
}

interface BlockProps {
  block: BlockNode;
  loaded: LoadedBook;
  showJapanese: boolean;
  japanesePhase: RubyVisibilityPhase;
  showAssistedRuby: boolean;
  showKatakanaRomaji: boolean;
  assistedRubyPhase: RubyVisibilityPhase;
  katakanaRomajiPhase: RubyVisibilityPhase;
  onInternalLink(target: Extract<LinkTarget, { kind: "internal" }>): void;
}

const Block = memo(function Block({ block, loaded, showJapanese, japanesePhase, showAssistedRuby, showKatakanaRomaji, assistedRubyPhase, katakanaRomajiPhase, onInternalLink }: BlockProps) {
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
          ? <img src={source} alt={block.alt} loading="eager" decoding="async" />
          : <div className="missing-block">{block.alt || "插图资源缺失"}</div>}
        {block.alt && <figcaption>{block.alt}</figcaption>}
      </figure>
    );
  }
  if (block.type === "divider") {
    const source = block.assetId ? loaded.assetUrlById.get(block.assetId) : undefined;
    return source
      ? <div className="divider-block" id={block.id}><img src={source} alt="" loading="eager" decoding="async" /></div>
      : <div className="divider-block divider-block--plain" id={block.id} aria-hidden="true"><span>◆</span></div>;
  }
  if (block.type === "spacer") {
    return <div className="spacer-block" id={block.id} aria-hidden="true" />;
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
            showKatakanaRomaji={showKatakanaRomaji}
            assistedRubyPhase={assistedRubyPhase}
            katakanaRomajiPhase={katakanaRomajiPhase}
            assetUrlById={loaded.assetUrlById}
            onInternalLink={onInternalLink}
          />
        </span>
      )}
      {japanese && !japaneseIsPrimary && (
        <span className="japanese-collapse" data-phase={japanesePhase} aria-hidden={!showJapanese}>
          <span className="content-variant content-variant--ja" lang="ja-JP" data-japanese-variant>
            <InlineContent
              nodes={japanese.content}
              showAssistedRuby={showAssistedRuby}
              showKatakanaRomaji={showKatakanaRomaji}
              assistedRubyPhase={assistedRubyPhase}
              katakanaRomajiPhase={katakanaRomajiPhase}
              assetUrlById={loaded.assetUrlById}
              onInternalLink={onInternalLink}
            />
          </span>
        </span>
      )}
    </Tag>
  );
});
