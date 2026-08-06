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
  onOpenSettings?(): void;
  settings: ReaderSettings;
  onSaveSettings(settings: ReaderSettings): Promise<void>;
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
  toggleMenu: "阅读菜单",
  toggleToc: "目录",
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
      data-spatial-zone="menu"
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

export function BookReader({ loaded, onReturnToLibrary, onOpenSettings, settings, onSaveSettings, onSaveReadingPosition, keyboardNavigationEnabled = true }: BookReaderProps) {
  const [showJapanese, setShowJapanese] = useState(() => settings.appearance.defaults.showJapanese);
  const [showAssistedRuby, setShowAssistedRuby] = useState(() => settings.appearance.defaults.showAssistedRuby);
  const [showKatakanaRomaji, setShowKatakanaRomaji] = useState(() => settings.appearance.defaults.showKatakanaRomaji);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [currentRowIndex, setCurrentRowIndex] = useState<number>();
  const [navigation, setNavigation] = useState(settings.navigation);
  const [navigationInput, setNavigationInput] = useState(String(settings.navigation.textSteps));
  const [shortcuts, setShortcuts] = useState(settings.shortcuts);
  const [capturingAction, setCapturingAction] = useState<ShortcutAction>();
  const [bindingError, setBindingError] = useState<string>();
  const [navigationEditing, setNavigationEditing] = useState(false);
  const [pageTransitions, setPageTransitions] = useState(settings.pageTransitions);
  const firstMenuButtonRef = useRef<HTMLButtonElement>(null);
  const readerRootRef = useRef<HTMLDivElement>(null);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const tocRootRef = useRef<HTMLElement>(null);
  const navigationInputRef = useRef<HTMLInputElement>(null);
  const navigationEntryRef = useRef<HTMLLabelElement>(null);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const pageTurnInProgressRef = useRef(false);
  const pageTurnTimerRef = useRef<number | undefined>(undefined);
  const pageTurnReleaseTimerRef = useRef<number | undefined>(undefined);
  const navigationSaveRevisionRef = useRef(0);
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

  const virtualizer = useWindowVirtualizer<HTMLElement>({
    count: rows.length,
    estimateSize: (index) => estimateRowSize(rows[index] as ReaderRow),
    getItemKey: (index) => (rows[index] as ReaderRow).block.id,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: OVERSCAN,
    scrollPaddingStart: READING_EDGE,
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
      viewportOffset: anchor?.top ?? READING_EDGE,
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
    const position = loaded.readingState.position;
    const targetIndex = position ? rowIndexByBlockId.get(position.blockId) : undefined;
    const targetRow = targetIndex === undefined ? undefined : rows[targetIndex];
    if (!position || targetIndex === undefined || targetRow?.documentId !== position.documentId || !isNavigationRow(targetRow)) {
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
        const delta = element.getBoundingClientRect().top - position.viewportOffset;
        if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: "instant" });
      });
    });
  }, [loaded.readingState.position, navigableRowIndices, rowIndexByBlockId, rows, virtualizer]);

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
  }, [settings.appearance.typography.columnWidth, settings.appearance.typography.fontSize, settings.appearance.typography.fontWeight, settings.appearance.typography.lineHeight, settings.appearance.typography.japaneseOpacity, virtualizer]);

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

  const toggleJapanese = useCallback(() => {
    toggleWithAnchor(() => setShowJapanese((value) => !value));
  }, [toggleWithAnchor]);

  const toggleAssistedRuby = useCallback(() => {
    if (!assistedAvailable) return;
    toggleWithAnchor(() => setShowAssistedRuby((value) => !value));
  }, [assistedAvailable, toggleWithAnchor]);

  const toggleKatakanaRomaji = useCallback(() => {
    if (!katakanaRomajiAvailable) return;
    toggleWithAnchor(() => setShowKatakanaRomaji((value) => !value));
  }, [katakanaRomajiAvailable, toggleWithAnchor]);

  useEffect(() => {
    setNavigation(settings.navigation);
    setNavigationInput(String(settings.navigation.textSteps));
    setShortcuts(settings.shortcuts);
    setPageTransitions(settings.pageTransitions);
  }, [settings.navigation.textSteps, settings.pageTransitions, settings.shortcuts]);

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
    if (!pageTransitions || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      window.scrollBy({ top: distance, behavior: "instant" });
      return;
    }
    if (pageTurnInProgressRef.current) return;
    pageTurnInProgressRef.current = true;
    if (typeof document.startViewTransition === "function") {
      const transition = document.startViewTransition(() => {
        window.scrollBy({ top: distance, behavior: "instant" });
      });
      void transition.finished.then(
        () => { pageTurnInProgressRef.current = false; },
        () => { pageTurnInProgressRef.current = false; },
      );
      return;
    }
    setPageTurning(true);
    pageTurnTimerRef.current = window.setTimeout(() => {
      window.scrollBy({ top: distance, behavior: "instant" });
      setPageTurning(false);
      pageTurnReleaseTimerRef.current = window.setTimeout(() => {
        pageTurnInProgressRef.current = false;
      }, PAGE_TURN_FADE_IN_MS);
    }, PAGE_TURN_FADE_OUT_MS);
  }, [pageTransitions]);

  useEffect(() => () => {
    if (pageTurnTimerRef.current !== undefined) window.clearTimeout(pageTurnTimerRef.current);
    if (pageTurnReleaseTimerRef.current !== undefined) window.clearTimeout(pageTurnReleaseTimerRef.current);
  }, []);

  const updateNavigationInput = useCallback((raw: string) => {
    setNavigationInput(raw);
    const parsed = Number(raw);
    if (!isNavigationStepCount(parsed)) return;
    if (parsed === navigation.textSteps) return;
    const next: ReaderSettings = {
      version: 5,
      navigation: { textSteps: parsed },
      shortcuts,
      pageTransitions,
      appearance: settings.appearance,
    };
    setNavigation(next.navigation);
    const revision = navigationSaveRevisionRef.current + 1;
    navigationSaveRevisionRef.current = revision;
    void onSaveSettings(next).catch(() => {
      if (navigationSaveRevisionRef.current !== revision) return;
      setNavigation(settings.navigation);
      setNavigationInput(String(settings.navigation.textSteps));
    });
  }, [navigation.textSteps, onSaveSettings, pageTransitions, settings.appearance, settings.navigation, shortcuts]);

  const restoreInvalidNavigationInput = useCallback(() => {
    if (!isNavigationStepCount(Number(navigationInput))) setNavigationInput(String(navigation.textSteps));
  }, [navigation.textSteps, navigationInput]);

  const togglePageTransitions = useCallback(() => {
    const nextPageTransitions = !pageTransitions;
    setPageTransitions(nextPageTransitions);
    void onSaveSettings({ version: 5, navigation, shortcuts, pageTransitions: nextPageTransitions, appearance: settings.appearance }).catch(() => {
      setPageTransitions(settings.pageTransitions);
    });
  }, [navigation, onSaveSettings, pageTransitions, settings.appearance, settings.pageTransitions, shortcuts]);

  const beginShortcutCapture = useCallback((action: ShortcutAction) => {
    setCapturingAction(action);
    setBindingError(undefined);
  }, []);

  const rememberOverlayFocus = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest(".reader-menu, .toc-drawer")) {
      overlayReturnFocusRef.current = active;
    } else if (!active || active === document.body) {
      overlayReturnFocusRef.current = null;
    }
  }, []);

  const restoreOverlayFocus = useCallback(() => {
    requestAnimationFrame(() => (overlayReturnFocusRef.current ?? readerRootRef.current)?.focus({ preventScroll: true }));
  }, []);

  const closeMenu = useCallback((restoreFocus = true) => {
    setCapturingAction(undefined);
    setBindingError(undefined);
    setNavigationEditing(false);
    setMenuOpen(false);
    if (restoreFocus) restoreOverlayFocus();
  }, [restoreOverlayFocus]);

  const toggleMenu = useCallback(() => {
    if (menuOpen) {
      closeMenu();
      return;
    }
    rememberOverlayFocus();
    setTocOpen(false);
    setMenuOpen(true);
  }, [closeMenu, menuOpen, rememberOverlayFocus]);

  const toggleToc = useCallback(() => {
    if (tocEntries.length === 0) return;
    if (tocOpen) {
      setTocOpen(false);
      restoreOverlayFocus();
      return;
    }
    rememberOverlayFocus();
    setCapturingAction(undefined);
    setBindingError(undefined);
    setMenuOpen(false);
    setNavigationEditing(false);
    setTocOpen(true);
  }, [rememberOverlayFocus, restoreOverlayFocus, tocEntries.length, tocOpen]);

  const activateMenuItem = useCallback((element: HTMLElement): boolean => {
    if (element.dataset.spatialAction !== "edit-navigation") return false;
    setNavigationEditing(true);
    requestAnimationFrame(() => {
      navigationInputRef.current?.focus();
      navigationInputRef.current?.select();
    });
    return true;
  }, []);

  useSpatialNavigation({
    rootRef: menuRootRef,
    enabled: menuOpen && keyboardNavigationEnabled,
    editing: Boolean(capturingAction) || navigationEditing,
    onActivate: activateMenuItem,
  });
  useSpatialNavigation({ rootRef: tocRootRef, enabled: tocOpen && keyboardNavigationEnabled });

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
          version: 5,
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
      if (event.key === "Escape" && menuOpen) {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key === "Escape" && tocOpen) {
        event.preventDefault();
        setTocOpen(false);
        restoreOverlayFocus();
        return;
      }
      const action = SHORTCUT_ACTIONS.find((candidate) => matchesShortcut(event, shortcuts[candidate]));
      if (!action) return;
      if (event.repeat && ["toggleJapanese", "toggleAssistedRuby", "toggleKatakanaRomaji", "toggleMenu", "toggleToc"].includes(action)) return;
      event.preventDefault();
      if (menuOpen) {
        if (action === "toggleMenu") closeMenu();
        return;
      }
      if (tocOpen) {
        if (action === "toggleToc") toggleToc();
        else if (action === "toggleMenu") toggleMenu();
        return;
      }
      if (action === "toggleJapanese") toggleJapanese();
      else if (action === "toggleAssistedRuby") toggleAssistedRuby();
      else if (action === "toggleKatakanaRomaji") toggleKatakanaRomaji();
      else if (action === "bottomBackward") jumpNavigationUnit(-1, "bottom", navigation.textSteps);
      else if (action === "bottomForward") jumpNavigationUnit(1, "bottom", navigation.textSteps);
      else if (action === "topBackward") jumpNavigationUnit(-1, "top", navigation.textSteps);
      else if (action === "topForward") jumpNavigationUnit(1, "top", navigation.textSteps);
      else if (action === "pageUp") turnPage(-1);
      else if (action === "pageDown") turnPage(1);
      else if (action === "toggleMenu") toggleMenu();
      else if (action === "toggleToc") toggleToc();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [capturingAction, closeMenu, jumpNavigationUnit, keyboardNavigationEnabled, menuOpen, navigation, onSaveSettings, pageTransitions, restoreOverlayFocus, settings.appearance, shortcuts, tocOpen, toggleAssistedRuby, toggleJapanese, toggleKatakanaRomaji, toggleMenu, toggleToc, turnPage]);

  useEffect(() => {
    if (menuOpen) firstMenuButtonRef.current?.focus({ preventScroll: true });
  }, [menuOpen]);

  useEffect(() => {
    if (!tocOpen) return;
    requestAnimationFrame(() => {
      const active = activeTocEntry
        ? tocRootRef.current?.querySelector<HTMLElement>(`[data-toc-key="${activeTocEntry.key}"]`)
        : undefined;
      const target = active ?? tocRootRef.current?.querySelector<HTMLElement>("[data-spatial-item]");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    });
  }, [activeTocEntry, tocOpen]);

  const followInternalLink = useCallback((target: Extract<LinkTarget, { kind: "internal" }>) => {
    const targetDocument = loaded.documentById.get(target.documentId);
    const blockId = target.fragmentId
      ? targetDocument?.anchors[target.fragmentId]
      : targetDocument?.blocks[0]?.id;
    const targetIndex = blockId ? rowIndexByBlockId.get(blockId) : undefined;
    if (targetIndex !== undefined) virtualizer.scrollToIndex(targetIndex, { align: "start" });
  }, [loaded.documentById, rowIndexByBlockId, virtualizer]);

  const returnToLibrary = useCallback(async () => {
    closeMenu();
    if (progressSaveTimerRef.current !== undefined) window.clearTimeout(progressSaveTimerRef.current);
    await persistReadingPosition().catch(() => {});
    onReturnToLibrary();
  }, [closeMenu, onReturnToLibrary, persistReadingPosition]);

  const openReaderSettings = useCallback(() => {
    appearanceAnchorRef.current = captureReadingAnchor("top");
    closeMenu(false);
    onOpenSettings?.();
  }, [closeMenu, onOpenSettings]);

  const followTocEntry = useCallback((entry: TocEntry) => {
    if (entry.targetIndex === undefined) return;
    setTocOpen(false);
    restoreOverlayFocus();
    setCurrentRowIndex(entry.targetIndex);
    virtualizer.scrollToIndex(entry.targetIndex, { align: "start" });
  }, [restoreOverlayFocus, virtualizer]);

  return (
    <div
      className="reader-app"
      ref={readerRootRef}
      tabIndex={-1}
      style={{
        "--reading-width": `${settings.appearance.typography.columnWidth}px`,
        "--reader-font-size": `${settings.appearance.typography.fontSize}px`,
        "--reader-font-weight": settings.appearance.typography.fontWeight,
        "--reader-line-height": settings.appearance.typography.lineHeight,
        "--japanese-opacity": settings.appearance.typography.japaneseOpacity,
      } as CSSProperties}
      onContextMenu={(event) => {
        event.preventDefault();
        rememberOverlayFocus();
        setTocOpen(false);
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
                  showKatakanaRomaji={renderKatakanaRomaji}
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
            if (event.target === event.currentTarget) closeMenu();
          }}
        >
          <div className="reader-menu" ref={menuRootRef} role="dialog" aria-modal="true" aria-label="阅读菜单">
            <button ref={firstMenuButtonRef} type="button" data-spatial-item data-spatial-zone="menu" data-spatial-zone-order="0" data-spatial-row="0" onClick={returnToLibrary}>
              <span>返回书库</span>
            </button>
            <div className="reader-menu-row">
              <button type="button" className="reader-menu-command" data-spatial-item data-spatial-zone="menu" data-spatial-zone-order="0" data-spatial-row="1" aria-pressed={showJapanese} onClick={toggleJapanese}>
                <span>日文</span><b>{showJapanese ? "开" : "关"}</b>
              </button>
              <ShortcutBindingButton action="toggleJapanese" binding={shortcuts.toggleJapanese} capturing={capturingAction === "toggleJapanese"} onCapture={beginShortcutCapture} spatialRow="1" />
            </div>
            <div className="reader-menu-row">
              <button
                type="button"
                className="reader-menu-command"
                data-spatial-item data-spatial-zone="menu" data-spatial-zone-order="0" data-spatial-row="2"
                aria-pressed={showAssistedRuby}
                disabled={!assistedAvailable}
                onClick={toggleAssistedRuby}
                title={assistedAvailable ? undefined : "本书没有程序补充注音"}
              >
                <span>注音</span><b>{showAssistedRuby ? "开" : "关"}</b>
              </button>
              <ShortcutBindingButton action="toggleAssistedRuby" binding={shortcuts.toggleAssistedRuby} capturing={capturingAction === "toggleAssistedRuby"} onCapture={beginShortcutCapture} spatialRow="2" />
            </div>
            <div className="reader-menu-row">
              <button
                type="button"
                className="reader-menu-command"
                data-spatial-item data-spatial-zone="menu" data-spatial-zone-order="0" data-spatial-row="3"
                aria-pressed={showKatakanaRomaji}
                disabled={!katakanaRomajiAvailable}
                onClick={toggleKatakanaRomaji}
                title={katakanaRomajiAvailable ? undefined : "本书没有片假名罗马音"}
              >
                <span>片假名罗马音</span><b>{showKatakanaRomaji ? "开" : "关"}</b>
              </button>
              <ShortcutBindingButton action="toggleKatakanaRomaji" binding={shortcuts.toggleKatakanaRomaji} capturing={capturingAction === "toggleKatakanaRomaji"} onCapture={beginShortcutCapture} spatialRow="3" />
            </div>
            <div className="reader-menu-row">
              <button
                type="button"
                className="reader-menu-command"
                data-spatial-item data-spatial-zone="menu" data-spatial-zone-order="0" data-spatial-row="4"
                disabled={tocEntries.length === 0}
                onClick={toggleToc}
                title={tocEntries.length === 0 ? "本书没有目录" : undefined}
              >
                <span>目录</span>
              </button>
              <ShortcutBindingButton action="toggleToc" binding={shortcuts.toggleToc} capturing={capturingAction === "toggleToc"} onCapture={beginShortcutCapture} spatialRow="4" />
            </div>
            <button type="button" data-spatial-item data-spatial-zone="menu" data-spatial-zone-order="0" data-spatial-row="5" aria-label="翻页淡出淡出" aria-pressed={pageTransitions} onClick={togglePageTransitions}>
              <span>翻页淡出淡出</span><b>{pageTransitions ? "开" : "关"}</b>
            </button>
            <div className="reader-menu-shortcut-row">
              <span>{SHORTCUT_LABELS.toggleMenu}</span>
              <ShortcutBindingButton action="toggleMenu" binding={shortcuts.toggleMenu} capturing={capturingAction === "toggleMenu"} onCapture={beginShortcutCapture} spatialRow="6" />
            </div>
            {(["topBackward", "topForward", "bottomBackward", "bottomForward", "pageUp", "pageDown"] as const).map((action, index) => (
              <div className="reader-menu-shortcut-row" key={action}>
                <span>{SHORTCUT_LABELS[action]}</span>
                <ShortcutBindingButton action={action} binding={shortcuts[action]} capturing={capturingAction === action} onCapture={beginShortcutCapture} spatialRow={String(index + 7)} />
              </div>
            ))}
            <label className="reader-menu-setting" ref={navigationEntryRef} tabIndex={0} data-spatial-item data-spatial-zone="menu" data-spatial-zone-order="0" data-spatial-row="13" data-spatial-action="edit-navigation">
              <span>回退/快进段数</span>
              <input
                ref={navigationInputRef}
                aria-label="回退/快进段数"
                type="number"
                min="1"
                max="99"
                step="1"
                value={navigationInput}
                onFocus={() => setNavigationEditing(true)}
                onChange={(event) => updateNavigationInput(event.target.value)}
                onBlur={() => {
                  setNavigationEditing(false);
                  restoreInvalidNavigationInput();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                    requestAnimationFrame(() => navigationEntryRef.current?.focus());
                  }
                  if (event.key === "Escape") {
                    setNavigationInput(String(navigation.textSteps));
                    event.currentTarget.blur();
                    requestAnimationFrame(() => navigationEntryRef.current?.focus());
                  }
                }}
              />
            </label>
            <button type="button" data-spatial-item data-spatial-zone="menu" data-spatial-zone-order="0" data-spatial-row="14" onClick={openReaderSettings}>
              <span>阅读设置</span>
            </button>
            {bindingError && <p className="reader-menu-error" role="alert">{bindingError}</p>}
          </div>
        </div>
      )}
      {tocOpen && (
        <div
          className="toc-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setTocOpen(false);
              restoreOverlayFocus();
            }
          }}
        >
          <aside className="toc-drawer" ref={tocRootRef} aria-label="目录">
            <header>
              <strong>目录</strong>
              <button type="button" data-spatial-item data-spatial-zone="toc" data-spatial-zone-order="0" data-spatial-row="0" aria-label="关闭目录" onClick={() => {
                setTocOpen(false);
                restoreOverlayFocus();
              }}>×</button>
            </header>
            {activeTocEntry && <p className="toc-current">{activeTocEntry.label}</p>}
            <ol className="toc-list">
              {tocEntries.map((entry, index) => (
                <li key={entry.key} style={{ paddingLeft: `${10 + entry.depth * 16}px` }}>
                  {entry.targetIndex === undefined
                    ? <span>{entry.label}</span>
                    : (
                      <button
                        type="button"
                        data-spatial-item
                        data-spatial-zone="toc"
                        data-spatial-zone-order="0"
                        data-spatial-row={String(index + 1)}
                        data-toc-key={entry.key}
                        aria-current={activeTocEntry?.key === entry.key ? "location" : undefined}
                        onClick={() => followTocEntry(entry)}
                      >{entry.label}</button>
                    )}
                </li>
              ))}
            </ol>
          </aside>
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
