import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { useWindowVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import type {
  BlockNode,
  BookDocument,
  ContentVariant,
  LinkTarget,
  TextBlock,
  TocItem,
} from "@airnobe/book-format";
import { hasAssistedRuby, hasKatakanaRomaji, type LoadedBook } from "./book-source.js";
import { InlineContent } from "./InlineContent.js";
import { SettingsPanel } from "./SettingsPanel.js";
import type { AvailableTheme } from "./theme-client.js";
import type { ThemeDefinition } from "./themes.js";
import type { ReadingPosition } from "./reading-state.js";
import { useSpatialNavigation } from "./spatial-navigation.js";
import {
  isNavigationStepCount,
  isShortcutCode,
  SHORTCUT_ACTIONS,
  shortcutBindingId,
  type ReaderSettings,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutModifier,
} from "./reader-settings.js";

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
  keyboardNavigationEnabled?: boolean;
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

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  toggleJapanese: "日文",
  toggleAssistedRuby: "注音",
  toggleKatakanaRomaji: "片假名罗马音",
  topBackward: "从顶部回退",
  topForward: "从顶部快进",
  bottomBackward: "从底部回退",
  bottomForward: "从底部快进",
  pageUp: "向上翻页",
  pageDown: "向下翻页",
  toggleSidebar: "侧边栏",
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

function shortcutModifier(event: KeyboardEvent): ShortcutModifier | "invalid" | undefined {
  if (event.metaKey) return "invalid";
  const modifiers: ShortcutModifier[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return modifiers.length > 1 ? "invalid" : modifiers[0];
}

function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (event.code !== binding.code || event.metaKey) return false;
  return event.ctrlKey === (binding.modifier === "Control")
    && event.altKey === (binding.modifier === "Alt")
    && event.shiftKey === (binding.modifier === "Shift");
}

function shortcutCodeLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    PageUp: "PgUp",
    PageDown: "PgDn",
    Space: "Space",
  }[code] ?? code;
}

function modifierLabel(modifier: ShortcutModifier): string {
  return modifier === "Control" ? "Ctrl" : modifier;
}

interface ShortcutBindingButtonProps {
  action: ShortcutAction;
  binding: ShortcutBinding;
  capturing: boolean;
  onCapture(action: ShortcutAction): void;
  spatialRow: string;
}

function ShortcutBindingButton({ action, binding, capturing, onCapture, spatialRow }: ShortcutBindingButtonProps) {
  return (
    <button
      type="button"
      className={`shortcut-binding${capturing ? " shortcut-binding--capturing" : ""}`}
      aria-label={`修改${SHORTCUT_LABELS[action]}快捷键`}
      aria-pressed={capturing}
      data-spatial-item
      data-spatial-zone="shortcut-dialog"
      data-spatial-zone-order="0"
      data-spatial-row={spatialRow}
      onClick={() => onCapture(action)}
    >
      {capturing
        ? <kbd>按键…</kbd>
        : (
          <>
            {binding.modifier && <><kbd>{modifierLabel(binding.modifier)}</kbd><i>+</i></>}
            <kbd>{shortcutCodeLabel(binding.code)}</kbd>
          </>
        )}
    </button>
  );
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

function estimateRowSize(row: ReaderRow, spacerHeight = 30.4): number {
  const documentSpacing = row.documentStart ? 64 : 0;
  if (row.block.type === "image") return 560 + documentSpacing;
  if (row.block.type === "divider") return 112 + documentSpacing;
  if (row.block.type === "spacer") return spacerHeight + documentSpacing;
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
    if (row.block.type === "divider" || row.block.type === "spacer") continue;
    if (row.block.type === "image") return passedText ? lastNavigable : index;
    if (row.block.type !== "text") continue;
    lastNavigable = index;
    passedText = true;
    remainingTextSteps -= 1;
    if (remainingTextSteps === 0) return index;
  }
}

export function BookReader({ loaded, onReturnToLibrary, settings, onSaveSettings, onPreviewSettings = () => {}, onSaveReadingPosition, themes = [], onImportTheme = async () => { throw new Error("主题导入不可用。"); }, onThemesChange = () => {}, keyboardNavigationEnabled = true }: BookReaderProps) {
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
  const readerRootRef = useRef<HTMLDivElement>(null);
  const sidebarRootRef = useRef<HTMLDivElement>(null);
  const shortcutDialogRef = useRef<HTMLDivElement>(null);
  const shortcutButtonRef = useRef<HTMLButtonElement>(null);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const pageTurnInProgressRef = useRef(false);
  const pageTurnTimerRef = useRef<number | undefined>(undefined);
  const pageTurnReleaseTimerRef = useRef<number | undefined>(undefined);
  const shortcutSaveRevisionRef = useRef(0);
  const progressSaveTimerRef = useRef<number | undefined>(undefined);
  const progressFrameRef = useRef<number | undefined>(undefined);
  const restoreFrameRef = useRef<number | undefined>(undefined);
  const restoredPositionRef = useRef(false);
  const lastSavedPositionRef = useRef<string | undefined>(undefined);
  const appearanceAnchorRef = useRef<ReadingAnchor | undefined>(undefined);
  const [pageTurning, setPageTurning] = useState(false);
  const assistedAvailable = useMemo(() => hasAssistedRuby(loaded), [loaded]);
  const katakanaRomajiAvailable = useMemo(() => hasKatakanaRomaji(loaded), [loaded]);
  const renderAssistedRuby = showAssistedRuby && assistedAvailable;
  const renderKatakanaRomaji = showKatakanaRomaji && katakanaRomajiAvailable;
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
  const activeTocEntry = useMemo(() => currentTocEntry(tocEntries, currentRowIndex), [currentRowIndex, tocEntries]);

  const initialReadingPosition = loaded.readingState.position;
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
    return Math.max(0, targetStart - READING_EDGE);
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
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: OVERSCAN,
    scrollPaddingStart: READING_EDGE,
    initialOffset: initialScrollOffset,
  });

  const captureReadingPosition = useCallback((): ReadingPosition | undefined => {
    const anchor = captureReadingAnchor("top");
    const rowIndex = anchor ? rowIndexByBlockId.get(anchor.id) : undefined;
    if (rowIndex === undefined) return undefined;
    const row = rows[rowIndex];
    const ordinal = navigableOrdinalByRowIndex.get(rowIndex);
    if (!row || ordinal === undefined) return undefined;
    const progress = navigableRowIndices.length <= 1 ? 1 : ordinal / (navigableRowIndices.length - 1);
    return {
      documentId: row.documentId,
      blockId: row.block.id,
      viewportOffset: READING_EDGE,
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
    if (restoredPositionRef.current) return;
    restoredPositionRef.current = true;
    const position = initialReadingPosition;
    const targetIndex = validInitialTarget;
    if (!position || targetIndex === undefined) {
      progressFrameRef.current = requestAnimationFrame(() => {
        const anchor = captureReadingAnchor("top");
        setCurrentRowIndex(anchor ? rowIndexByBlockId.get(anchor.id) : navigableRowIndices[0]);
      });
      return;
    }
    setCurrentRowIndex(targetIndex);
    lastSavedPositionRef.current = JSON.stringify(position);
    virtualizer.scrollToIndex(targetIndex, { align: "start" });
    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = requestAnimationFrame(() => {
        const element = document.getElementById(position.blockId);
        if (!element) return;
        const delta = element.getBoundingClientRect().top - READING_EDGE;
        if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: "instant" });
      });
    });
  }, [initialReadingPosition, navigableRowIndices, rowIndexByBlockId, validInitialTarget, virtualizer]);

  useEffect(() => {
    const updateCurrentPosition = (): void => {
      const position = captureReadingPosition();
      if (position) setCurrentRowIndex(rowIndexByBlockId.get(position.blockId));
    };
    const onScroll = (): void => {
      appearanceAnchorRef.current = captureReadingAnchor("top");
      if (progressFrameRef.current !== undefined) cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = requestAnimationFrame(updateCurrentPosition);
      if (!loaded.libraryBookId || !onSaveReadingPosition) return;
      if (progressSaveTimerRef.current !== undefined) window.clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = window.setTimeout(() => {
        void persistReadingPosition().catch(() => {});
      }, 750);
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== "hidden") return;
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

  useLayoutEffect(() => {
    const anchor = appearanceAnchorRef.current;
    if (!anchor) return;
    measureMountedRows(virtualizer);
    restoreReadingAnchor(anchor);
    appearanceAnchorRef.current = captureReadingAnchor("top");
  }, [settings.appearance.typography.columnWidth, settings.appearance.typography.fontSize, settings.appearance.typography.fontWeight, settings.appearance.typography.lineHeight, settings.appearance.typography.paragraphSpacing, settings.appearance.typography.japaneseOpacity, settings.appearance.typography.rubyScale, sidebarOpen, virtualizer]);

  useEffect(() => {
    if (!document.fonts) return;
    let active = true;
    const anchor = appearanceAnchorRef.current ?? captureReadingAnchor("top");
    void Promise.all([
      document.fonts.load(`${settings.appearance.typography.fontWeight} ${settings.appearance.typography.fontSize}px "Sarasa Gothic SC"`),
      document.fonts.load(`${settings.appearance.typography.fontWeight} ${settings.appearance.typography.fontSize}px "Sarasa Gothic J"`),
    ]).then(() => {
      if (!active) return;
      measureMountedRows(virtualizer);
      restoreReadingAnchor(anchor);
      appearanceAnchorRef.current = captureReadingAnchor("top");
    });
    return () => { active = false; };
  }, [settings.appearance.typography.fontSize, settings.appearance.typography.fontWeight, virtualizer]);

  const toggleWithAnchor = useCallback((update: () => void) => {
    const anchor = captureReadingAnchor();
    flushSync(update);
    measureMountedRows(virtualizer);
    restoreReadingAnchor(anchor);
  }, [virtualizer]);

  const saveDisplay = useCallback((key: "showJapanese" | "showAssistedRuby" | "showKatakanaRomaji", value: boolean) => {
    const previous = settings.appearance.display[key];
    const next = { ...settings, appearance: { ...settings.appearance, display: { ...settings.appearance.display, [key]: value } } };
    onPreviewSettings(next);
    void onSaveSettings(next).catch(() => {
      if (key === "showJapanese") setShowJapanese(previous);
      else if (key === "showAssistedRuby") setShowAssistedRuby(previous);
      else setShowKatakanaRomaji(previous);
    });
  }, [onPreviewSettings, onSaveSettings, settings]);

  const toggleJapanese = useCallback(() => {
    const next = !showJapanese;
    toggleWithAnchor(() => setShowJapanese(next)); saveDisplay("showJapanese", next);
  }, [saveDisplay, showJapanese, toggleWithAnchor]);

  const toggleAssistedRuby = useCallback(() => {
    const next = !showAssistedRuby;
    toggleWithAnchor(() => setShowAssistedRuby(next)); saveDisplay("showAssistedRuby", next);
  }, [saveDisplay, showAssistedRuby, toggleWithAnchor]);

  const toggleKatakanaRomaji = useCallback(() => {
    const next = !showKatakanaRomaji;
    toggleWithAnchor(() => setShowKatakanaRomaji(next)); saveDisplay("showKatakanaRomaji", next);
  }, [saveDisplay, showKatakanaRomaji, toggleWithAnchor]);

  useEffect(() => {
    setNavigation(settings.navigation);
    setShortcuts(settings.shortcuts);
    setPageTransitions(settings.pageTransitions);
    setShowJapanese(settings.appearance.display.showJapanese);
    setShowAssistedRuby(settings.appearance.display.showAssistedRuby);
    setShowKatakanaRomaji(settings.appearance.display.showKatakanaRomaji);
  }, [settings.appearance.display, settings.navigation.textSteps, settings.pageTransitions, settings.shortcuts]);

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

  useEffect(() => () => {
    if (pageTurnTimerRef.current !== undefined) window.clearTimeout(pageTurnTimerRef.current);
    if (pageTurnReleaseTimerRef.current !== undefined) window.clearTimeout(pageTurnReleaseTimerRef.current);
  }, []);

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
    appearanceAnchorRef.current = captureReadingAnchor("top");
    if (sidebarOpen) {
      closeSidebar();
      return;
    }
    rememberOverlayFocus();
    setSidebarOpen(true);
  }, [closeSidebar, rememberOverlayFocus, sidebarOpen]);

  const closeShortcutDialog = useCallback(() => {
    setCapturingAction(undefined);
    setBindingError(undefined);
    setShortcutDialogOpen(false);
    requestAnimationFrame(() => shortcutButtonRef.current?.focus({ preventScroll: true }));
  }, []);

  const openShortcutDialog = useCallback(() => {
    setBindingError(undefined);
    setShortcutDialogOpen(true);
    requestAnimationFrame(() => shortcutDialogRef.current?.querySelector<HTMLElement>("[data-spatial-item]")?.focus({ preventScroll: true }));
  }, []);

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
        const conflict = SHORTCUT_ACTIONS.find((action) => (
          action !== capturingAction && shortcutBindingId(shortcuts[action]) === shortcutBindingId(candidate)
        ));
        if (conflict) {
          setBindingError(`该按键已用于“${SHORTCUT_LABELS[conflict]}”。`);
          return;
        }
        const previousShortcuts = shortcuts;
        const nextShortcuts = { ...shortcuts, [capturingAction]: candidate };
        const next: ReaderSettings = {
          version: 9,
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
      if (shortcutDialogOpen) return;
      const action = SHORTCUT_ACTIONS.find((candidate) => matchesShortcut(event, shortcuts[candidate]));
      if (!action) return;
      if (event.repeat && ["toggleJapanese", "toggleAssistedRuby", "toggleKatakanaRomaji", "toggleSidebar"].includes(action)) return;
      event.preventDefault();
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [capturingAction, closeShortcutDialog, closeSidebar, jumpNavigationUnit, keyboardNavigationEnabled, navigation, onSaveSettings, pageTransitions, settings.appearance, shortcutDialogOpen, shortcuts, sidebarOpen, toggleAssistedRuby, toggleJapanese, toggleKatakanaRomaji, toggleSidebar, turnPage]);

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

  const returnToLibrary = useCallback(async () => {
    closeSidebar();
    if (progressSaveTimerRef.current !== undefined) window.clearTimeout(progressSaveTimerRef.current);
    await persistReadingPosition().catch(() => {});
    onReturnToLibrary();
  }, [closeSidebar, onReturnToLibrary, persistReadingPosition]);

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
      style={{
        "--reading-width": `${settings.appearance.typography.columnWidth}px`,
        "--reader-font-size": `${settings.appearance.typography.fontSize}px`,
        "--reader-font-weight": settings.appearance.typography.fontWeight,
        "--reader-line-height": settings.appearance.typography.lineHeight,
        "--reader-paragraph-spacing": `${settings.appearance.typography.paragraphSpacing}em`,
        "--reader-line-box": `${settings.appearance.typography.fontSize * settings.appearance.typography.lineHeight}px`,
        "--japanese-opacity": settings.appearance.typography.japaneseOpacity,
        "--reader-ruby-size": `${settings.appearance.typography.rubyScale}em`,
      } as CSSProperties}
      onContextMenu={(event) => {
        event.preventDefault();
        toggleSidebar();
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
                  showKatakanaRomaji={renderKatakanaRomaji}
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
          {settings.appearance.display.showProgressBars && <div className="reader-progress-summary">{chapterProgress !== undefined && <label><span>{activeTocEntry?.label ?? "当前章节"}</span><progress max="1" value={chapterProgress} /><b>{Math.round(chapterProgress * 100)}%</b></label>}<label><span>全书</span><progress max="1" value={wholeProgress} /><b>{Math.round(wholeProgress * 100)}%</b></label></div>}
        </aside>
        <aside className="reader-sidebar-settings" aria-label="阅读设置" data-spatial-zone-order="1"><div className="sidebar-top-actions"><button type="button" data-spatial-item data-spatial-zone="settings" data-spatial-zone-order="1" data-spatial-row="0" onClick={() => void returnToLibrary()}>返回书库</button><button ref={shortcutButtonRef} type="button" data-spatial-item data-spatial-zone="settings" data-spatial-zone-order="1" data-spatial-row="0" onClick={openShortcutDialog}>设置快捷键</button></div>
          <SettingsPanel embedded scope="reader" settings={settings} themes={themes} onPreview={(next) => { appearanceAnchorRef.current = captureReadingAnchor("top"); onPreviewSettings(next); }} onSave={onSaveSettings} onImport={onImportTheme} onThemesChange={onThemesChange} />
        </aside>
      </div>}
      {shortcutDialogOpen && <div className="shortcut-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeShortcutDialog(); }}><div className="shortcut-dialog" ref={shortcutDialogRef} role="dialog" aria-modal="true" aria-label="快捷键设置"><header><h2>快捷键</h2><button type="button" data-spatial-item data-spatial-zone="shortcut-dialog" data-spatial-row="0" aria-label="关闭快捷键设置" onClick={closeShortcutDialog}>×</button></header><div className="shortcut-dialog-list">{SHORTCUT_ACTIONS.map((action, index) => <div className="reader-menu-shortcut-row" key={action}><span>{SHORTCUT_LABELS[action]}</span><ShortcutBindingButton action={action} binding={shortcuts[action]} capturing={capturingAction === action} onCapture={beginShortcutCapture} spatialRow={String(index + 1)} /></div>)}</div>{bindingError && <p className="reader-menu-error" role="alert">{bindingError}</p>}</div></div>}
    </div>
  );
}

interface BlockProps {
  block: BlockNode;
  loaded: LoadedBook;
  showJapanese: boolean;
  showAssistedRuby: boolean;
  showKatakanaRomaji: boolean;
  onInternalLink(target: Extract<LinkTarget, { kind: "internal" }>): void;
}

const Block = memo(function Block({ block, loaded, showJapanese, showAssistedRuby, showKatakanaRomaji, onInternalLink }: BlockProps) {
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
            showKatakanaRomaji={showKatakanaRomaji}
            assetUrlById={loaded.assetUrlById}
            onInternalLink={onInternalLink}
          />
        </span>
      )}
    </Tag>
  );
});
