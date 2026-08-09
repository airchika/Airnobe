import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coverUrl, type CollectionStatus, type LibraryBook } from "./library-client.js";
import type { ShortcutBinding } from "./reader-settings.js";
import { matchesShortcut } from "./shortcut-bindings.js";
import { findSpatialTarget, useSpatialNavigation, type SpatialDirection } from "./spatial-navigation.js";
import noveliaIcon from "./assets/novelia-icon.svg";
import type { LibraryFilter } from "./app-state.js";

interface LibraryViewProps {
  books: LibraryBook[];
  selectedBookId?: string;
  filter: LibraryFilter;
  onFilterChange(filter: LibraryFilter): void;
  onSelect(bookId: string): void;
  onImport(): void;
  onOpenNovelia?(): void;
  onOpenSettings?(): void;
  onReturnToReading?(): void;
  switchViewShortcut?: ShortcutBinding | null;
  fullscreenShortcut?: ShortcutBinding | null;
  onToggleFullscreen?(): void;
  onRead(bookId: string, mode?: "continue" | "beginning"): void;
  onExport(book: LibraryBook): void;
  onUpdate(bookId: string, patch: { collectionStatus?: CollectionStatus; note?: string }): Promise<void>;
  onDelete?(bookId: string): void;
  keyboardNavigationEnabled?: boolean;
}

const STATUS_LABELS: Record<CollectionStatus, string> = { wish: "想看", reading: "在看", completed: "看过", "on-hold": "搁置", dropped: "放弃" };
const STATUS_ORDER: CollectionStatus[] = ["wish", "reading", "completed", "on-hold", "dropped"];
const STATUS_SORT: CollectionStatus[] = ["reading", "completed", "wish", "on-hold", "dropped"];
type SortKey = "title" | "status" | "recent";
interface PopupPosition { bookId: string; left: number; top: number }

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function nearestHorizontal(items: HTMLElement[], current: HTMLElement): HTMLElement | undefined {
  const currentRect = current.getBoundingClientRect();
  const currentCenter = currentRect.left + currentRect.width / 2;
  return items.reduce<HTMLElement | undefined>((nearest, candidate) => {
    if (!nearest) return candidate;
    const candidateRect = candidate.getBoundingClientRect();
    const nearestRect = nearest.getBoundingClientRect();
    const candidateDistance = Math.abs(candidateRect.left + candidateRect.width / 2 - currentCenter);
    const nearestDistance = Math.abs(nearestRect.left + nearestRect.width / 2 - currentCenter);
    return candidateDistance < nearestDistance ? candidate : nearest;
  }, undefined);
}

function resolveLibrarySpatialTarget(items: HTMLElement[], current: HTMLElement, direction: SpatialDirection): HTMLElement | undefined {
  const isHeaderAction = current.hasAttribute("data-library-header-action");
  const isBodyTop = current.dataset.spatialRow === "0" && ["filters", "books"].includes(current.dataset.spatialZone ?? "");
  if (direction === "up" && isBodyTop) {
    return nearestHorizontal(items.filter((item) => item.hasAttribute("data-library-header-action")), current) ?? current;
  }
  if (direction === "down" && isHeaderAction) {
    return nearestHorizontal(items.filter((item) => item.dataset.spatialRow === "0" && ["filters", "books"].includes(item.dataset.spatialZone ?? "")), current) ?? current;
  }
  return findSpatialTarget(items, current, direction);
}

function contentKindLabel(book: LibraryBook): string {
  return { chinese: "纯中文", japanese: "纯日文", parallel: "中日对照", mixed: "混合内容", unknown: "未分类" }[book.contentKind];
}
function annotationLabel(book: LibraryBook): string {
  return { "not-applicable": "无需程序注音", ready: "含程序注音", failed: "仅基础版本" }[book.annotationStatus];
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
}
function recentTimestamp(book: LibraryBook): number | undefined {
  const value = book.readingProgress?.updatedAt;
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}
export function formatRecentlyOpened(book: LibraryBook, now = new Date()): string {
  const timestamp = recentTimestamp(book);
  if (timestamp === undefined) return "未打开";
  const elapsed = Math.max(0, now.getTime() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(elapsed / 86_400_000);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}月前`;
}

const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/u;
export function metadataLanguageClass(book: LibraryBook, text: string): string | undefined {
  return book.contentKind === "japanese" || book.contentKind === "parallel" || KANA.test(text) ? "font-japanese" : undefined;
}

interface LibraryDetailLayerProps {
  book: LibraryBook;
  phase: "entering" | "active" | "exiting";
  onAnimationComplete(bookId: string, phase: "entering" | "active" | "exiting"): void;
}

function LibraryDetailLayer({ book, phase, onAnimationComplete }: LibraryDetailLayerProps) {
  const [coverLoaded, setCoverLoaded] = useState(false);
  const cover = coverUrl(book);
  return <div
    className="library-detail-layer"
    data-phase={phase}
    onAnimationEnd={(event) => {
      if (event.target === event.currentTarget) onAnimationComplete(book.id, phase);
    }}
  >
    {cover && <img className="library-cover" data-loaded={coverLoaded} src={cover} alt={`${book.title}封面`} onLoad={() => setCoverLoaded(true)} onError={() => setCoverLoaded(true)} />}
    <div className="library-detail-heading"><h2 className={metadataLanguageClass(book, book.title)}>{book.title || "未命名书籍"}</h2><p className={metadataLanguageClass(book, book.authors.join(" / "))}>{book.authors.join(" / ") || "作者不详"}</p></div>
    <dl className="library-metadata"><div><dt>书籍</dt><dd>{contentKindLabel(book)} · {annotationLabel(book)} · {formatSize(book.sourceSize)}</dd></div><div><dt>阅读</dt><dd>{book.readingProgress ? `${Math.round(book.readingProgress.progress * 100)}%${book.readingProgress.chapterLabel ? ` · ${book.readingProgress.chapterLabel}` : ""}` : "尚未开始"}</dd></div></dl>
  </div>;
}

export function LibraryView({ books, selectedBookId, filter, onFilterChange, onSelect, onImport, onOpenNovelia, onOpenSettings, onReturnToReading, switchViewShortcut, fullscreenShortcut, onToggleFullscreen, onRead, onExport, onUpdate, onDelete = () => {}, keyboardNavigationEnabled = true }: LibraryViewProps) {
  const rootRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const popupReturnFocusRef = useRef<HTMLElement | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "recent", direction: 1 });
  const [actionPopup, setActionPopup] = useState<PopupPosition>();
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const popupOpen = Boolean(actionPopup);
  const sortedBooks = useMemo(() => [...books].sort((left, right) => {
    let comparison = 0;
    if (sort.key === "title") comparison = collator.compare(left.title, right.title);
    else if (sort.key === "status") comparison = STATUS_SORT.indexOf(left.collectionStatus) - STATUS_SORT.indexOf(right.collectionStatus);
    else {
      const leftTime = recentTimestamp(left);
      const rightTime = recentTimestamp(right);
      if (leftTime === undefined && rightTime !== undefined) return 1;
      if (leftTime !== undefined && rightTime === undefined) return -1;
      comparison = (rightTime ?? 0) - (leftTime ?? 0);
    }
    if ((sort.key === "recent" || sort.key === "status") && comparison === 0) comparison = (recentTimestamp(right) ?? -Infinity) - (recentTimestamp(left) ?? -Infinity);
    return comparison * sort.direction || collator.compare(left.title, right.title) || left.id.localeCompare(right.id);
  }), [books, sort]);
  const visibleBooks = useMemo(() => filter === "all" ? sortedBooks : sortedBooks.filter((book) => book.collectionStatus === filter), [filter, sortedBooks]);
  const selected = books.find((book) => book.id === selectedBookId);
  const [detailLayers, setDetailLayers] = useState<Array<{ book: LibraryBook; phase: "entering" | "active" | "exiting" }>>([]);
  const detailTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (detailTimerRef.current !== undefined) window.clearTimeout(detailTimerRef.current);
    const nextSelected = selected && visibleBooks.some((book) => book.id === selected.id) ? selected : undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDetailLayers(nextSelected ? [{ book: nextSelected, phase: "active" }] : []);
      return;
    }
    setDetailLayers((current) => {
      const next = current.map((layer) => layer.book.id === nextSelected?.id
        ? { book: nextSelected, phase: layer.phase === "active" ? "active" as const : "entering" as const }
        : { ...layer, phase: "exiting" as const });
      if (nextSelected && !next.some((layer) => layer.book.id === nextSelected.id)) {
        next.push({ book: nextSelected, phase: "entering" });
      }
      return next;
    });
    detailTimerRef.current = window.setTimeout(() => {
      setDetailLayers((current) => current
        .filter((layer) => layer.phase !== "exiting")
        .map((layer) => layer.phase === "entering" ? { ...layer, phase: "active" } : layer));
    }, 540);
    return () => {
      if (detailTimerRef.current !== undefined) window.clearTimeout(detailTimerRef.current);
    };
  }, [selected?.id, visibleBooks]);

  useEffect(() => {
    if (!selected) return;
    setDetailLayers((current) => current.map((layer) => layer.book.id === selected.id ? { ...layer, book: selected } : layer));
  }, [selected]);
  const finishDetailAnimation = useCallback((bookId: string, phase: "entering" | "active" | "exiting") => {
    setDetailLayers((current) => phase === "exiting"
      ? current.filter((layer) => layer.book.id !== bookId)
      : current.map((layer) => layer.book.id === bookId && layer.phase === "entering" ? { ...layer, phase: "active" } : layer));
  }, []);
  const popupBook = books.find((book) => book.id === actionPopup?.bookId);

  useEffect(() => {
    if (selectedBookId && !visibleBooks.some((book) => book.id === selectedBookId)) onSelect("");
  }, [onSelect, selectedBookId, visibleBooks]);
  useEffect(() => {
    if (!keyboardNavigationEnabled) return;
    const activeWhenScheduled = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== activeWhenScheduled && active instanceof HTMLElement && rootRef.current?.contains(active)) return;
      if (active instanceof HTMLElement && rootRef.current?.contains(active)) return;
      const item = [...rootRef.current?.querySelectorAll<HTMLElement>("[data-library-book-id]") ?? []].find((element) => element.dataset.libraryBookId === selectedBookId);
      (item ?? rootRef.current?.querySelector<HTMLElement>(`[data-library-filter='${filter}']`))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [filter, keyboardNavigationEnabled, selectedBookId]);

  const closePopup = useCallback(() => {
    setStatusMenuOpen(false);
    setActionPopup(undefined);
    requestAnimationFrame(() => popupReturnFocusRef.current?.focus({ preventScroll: true }));
  }, []);
  const openActionPopup = useCallback((book: LibraryBook, owner: HTMLElement, point?: { x: number; y: number }) => {
    const rect = owner.getBoundingClientRect();
    popupReturnFocusRef.current = owner;
    onSelect(book.id);
    setStatusMenuOpen(false);
    setActionPopup({ bookId: book.id, left: Math.min(point?.x ?? rect.left, window.innerWidth - 190), top: Math.min(point?.y ?? rect.bottom + 4, window.innerHeight - 210) });
  }, [onSelect]);
  useEffect(() => {
    if (!popupOpen) return;
    requestAnimationFrame(() => popupRef.current?.querySelector<HTMLElement>("[data-spatial-item]")?.focus({ preventScroll: true }));
  }, [popupOpen]);
  const openStatusMenu = (): void => { setStatusMenuOpen(true); requestAnimationFrame(() => popupRef.current?.querySelector<HTMLElement>("[aria-selected]")?.focus({ preventScroll: true })); };

  useSpatialNavigation({ rootRef, enabled: keyboardNavigationEnabled && !popupOpen, keys: "both", resolveTarget: resolveLibrarySpatialTarget, onActivate: (element) => {
    if (element.dataset.spatialAction !== "book-actions") return false;
    const book = books.find((candidate) => candidate.id === element.dataset.libraryBookId);
    if (book) openActionPopup(book, element);
    return true;
  } });
  useSpatialNavigation({ rootRef: popupRef, enabled: keyboardNavigationEnabled && popupOpen, keys: "both", onCancel: () => { if (statusMenuOpen) { setStatusMenuOpen(false); requestAnimationFrame(() => popupRef.current?.querySelector<HTMLElement>("[data-popup-action='status']")?.focus({ preventScroll: true })); return true; } closePopup(); return true; } });
  useEffect(() => {
    if (!keyboardNavigationEnabled || popupOpen) return;
    const listener = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.isComposing || target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      if (fullscreenShortcut && onToggleFullscreen && matchesShortcut(event, fullscreenShortcut)) {
        event.preventDefault();
        onToggleFullscreen();
      } else if (switchViewShortcut && onReturnToReading && matchesShortcut(event, switchViewShortcut)) {
        event.preventDefault();
        onReturnToReading();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [fullscreenShortcut, keyboardNavigationEnabled, onReturnToReading, onToggleFullscreen, popupOpen, switchViewShortcut]);

  const chooseSort = (key: SortKey): void => setSort((current) => current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: 1 });
  const sortLabel = (key: SortKey): string => sort.key === key ? (sort.direction === 1 ? " ↑" : " ↓") : "";
  const activateFilter = (value: LibraryFilter): void => { if (filter !== value) onFilterChange(value); };

  return <main className="library-app" ref={rootRef}>
    <header className="library-header"><h1>Airnobe</h1><div className="library-header-actions">
      {onReturnToReading && <button className="library-icon-action" type="button" title="返回阅读" aria-label="返回阅读" data-spatial-item data-library-header-action data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="0" onClick={onReturnToReading}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h6M9 10h6" /></svg></button>}
      <button className="library-icon-action" type="button" title="导入 EPUB" aria-label="导入 EPUB" data-spatial-item data-library-header-action data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="0" onClick={onImport}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
      <button className="library-icon-action" type="button" title="设置" aria-label="设置" data-spatial-item data-library-header-action data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="0" onClick={onOpenSettings}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.55-1.03H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.03-1.55V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.55 1.03H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" /></svg></button>
      {onOpenNovelia && <button className="library-icon-action library-icon-action--novelia" type="button" title="从轻小说机翻机器人导入" aria-label="从轻小说机翻机器人导入" data-spatial-item data-library-header-action data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="0" onClick={onOpenNovelia}><img src={noveliaIcon} alt="" aria-hidden="true" /></button>}
    </div></header>
    <div className="library-grid">
      <nav className="library-filters" aria-label="藏书状态">
        <button type="button" data-spatial-item data-spatial-zone="filters" data-spatial-zone-order="0" data-spatial-row="0" data-library-filter="all" aria-pressed={filter === "all"} onFocus={() => activateFilter("all")} onClick={() => activateFilter("all")}><span>全部</span><b>{books.length}</b></button>
        {STATUS_ORDER.map((status, index) => <button key={status} type="button" data-spatial-item data-spatial-zone="filters" data-spatial-zone-order="0" data-spatial-row={String(index + 1)} data-library-filter={status} aria-pressed={filter === status} onFocus={() => activateFilter(status)} onClick={() => activateFilter(status)}><span>{STATUS_LABELS[status]}</span><b>{books.filter((book) => book.collectionStatus === status).length}</b></button>)}
      </nav>
      <section className="library-list" aria-label="书籍列表">
        <div className="library-list-header">{([ ["title", "书名"], ["status", "状态"], ["recent", "最近打开"] ] as const).map(([key, label]) => <button key={key} type="button" onClick={() => chooseSort(key)} aria-pressed={sort.key === key}>{label}{key === "status" ? <i className="library-sort-slot" aria-hidden="true">{sort.key === key ? (sort.direction === 1 ? "↑" : "↓") : "↑"}</i> : sortLabel(key)}</button>)}</div>
        {visibleBooks.length === 0 ? <p className="library-empty">{books.length === 0 ? "书库为空" : "此分类暂无书籍"}</p> : visibleBooks.map((book, index) => <div className="library-row" data-selected={book.id === selectedBookId} key={book.id} onClick={() => onSelect(book.id)} onContextMenu={(event) => { event.preventDefault(); openActionPopup(book, event.currentTarget, { x: event.clientX, y: event.clientY }); }}>
          <button className={`library-row-title ${metadataLanguageClass(book, book.title) ?? ""}`} type="button" data-spatial-item data-spatial-zone="books" data-spatial-zone-order="1" data-spatial-row={String(index)} data-spatial-action="book-actions" data-library-book-id={book.id} onFocus={() => onSelect(book.id)} onDoubleClick={() => onRead(book.id)}>{book.title || "未命名书籍"}</button>
          <span className="library-row-status">{STATUS_LABELS[book.collectionStatus]}</span>
          <span className="library-row-recent">{formatRecentlyOpened(book)}</span>
        </div>)}
      </section>
      <aside className="library-detail" aria-label="书籍详情">{detailLayers.map(({ book, phase }) => <LibraryDetailLayer book={book} phase={phase} onAnimationComplete={finishDetailAnimation} key={book.id} />)}</aside>
    </div>
    {popupOpen && <div className="library-popup-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) closePopup(); }}><div className="library-popup" ref={popupRef} style={{ left: actionPopup?.left, top: actionPopup?.top }} role="menu" aria-label={statusMenuOpen ? "选择收藏状态" : "书籍操作"}>
      {popupBook && statusMenuOpen && STATUS_ORDER.map((status, index) => <button key={status} type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row={String(index)} aria-selected={popupBook.collectionStatus === status} onClick={() => void onUpdate(popupBook.id, { collectionStatus: status }).then(closePopup).catch(() => {})}>{STATUS_LABELS[status]}</button>)}
      {popupBook && !statusMenuOpen && <><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="0" onClick={() => { closePopup(); onRead(popupBook.id, "continue"); }}>继续阅读</button><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="1" onClick={() => { closePopup(); onRead(popupBook.id, "beginning"); }}>从头开始</button><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="2" data-popup-action="status" onClick={openStatusMenu}>修改状态</button><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="3" onClick={() => { closePopup(); onExport(popupBook); }}>导出 EPUB</button><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="4" onClick={() => { closePopup(); onDelete(popupBook.id); }}>删除</button></>}
    </div></div>}
  </main>;
}
