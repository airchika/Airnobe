import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coverUrl, sourceEpubUrl, type CollectionStatus, type LibraryBook } from "./library-client.js";
import { useSpatialNavigation } from "./spatial-navigation.js";

interface LibraryViewProps {
  books: LibraryBook[];
  selectedBookId?: string;
  onSelect(bookId: string): void;
  onImport(): void;
  onOpenSettings?(): void;
  onRead(bookId: string, mode?: "continue" | "beginning"): void;
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
  const opened = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const openedDay = new Date(opened.getFullYear(), opened.getMonth(), opened.getDate()).getTime();
  const days = Math.max(0, Math.floor((today - openedDay) / 86_400_000));
  if (days === 0) return "今天";
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/u;
export function metadataLanguageClass(book: LibraryBook, text: string): string | undefined {
  return book.contentKind === "japanese" || book.contentKind === "parallel" || KANA.test(text) ? "font-japanese" : undefined;
}

export function LibraryView({ books, selectedBookId, onSelect, onImport, onOpenSettings, onRead, onUpdate, onDelete = () => {}, keyboardNavigationEnabled = true }: LibraryViewProps) {
  const rootRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const popupReturnFocusRef = useRef<HTMLElement | null>(null);
  const [filter, setFilter] = useState<CollectionStatus | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "recent", direction: 1 });
  const [statusPopup, setStatusPopup] = useState<PopupPosition>();
  const [actionPopup, setActionPopup] = useState<PopupPosition>();
  const popupOpen = Boolean(statusPopup || actionPopup);
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
  const popupBook = books.find((book) => book.id === (statusPopup?.bookId ?? actionPopup?.bookId));

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
      (item ?? rootRef.current?.querySelector<HTMLElement>("[data-library-filter='all']"))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [keyboardNavigationEnabled, selectedBookId]);

  const closePopup = useCallback(() => {
    setStatusPopup(undefined);
    setActionPopup(undefined);
    requestAnimationFrame(() => popupReturnFocusRef.current?.focus({ preventScroll: true }));
  }, []);
  const openStatusPopup = useCallback((book: LibraryBook, owner: HTMLElement) => {
    const rect = owner.getBoundingClientRect();
    popupReturnFocusRef.current = owner;
    onSelect(book.id);
    setActionPopup(undefined);
    setStatusPopup({ bookId: book.id, left: Math.min(rect.left, window.innerWidth - 170), top: Math.min(rect.bottom + 4, window.innerHeight - 230) });
  }, [onSelect]);
  const openActionPopup = useCallback((book: LibraryBook, owner: HTMLElement, point?: { x: number; y: number }) => {
    const rect = owner.getBoundingClientRect();
    popupReturnFocusRef.current = owner;
    onSelect(book.id);
    setStatusPopup(undefined);
    setActionPopup({ bookId: book.id, left: Math.min(point?.x ?? rect.left, window.innerWidth - 190), top: Math.min(point?.y ?? rect.bottom + 4, window.innerHeight - 210) });
  }, [onSelect]);
  useEffect(() => {
    if (!popupOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closePopup(); } };
    window.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => popupRef.current?.querySelector<HTMLElement>("[data-spatial-item]")?.focus({ preventScroll: true }));
    return () => window.removeEventListener("keydown", onKey, true);
  }, [closePopup, popupOpen]);

  useSpatialNavigation({ rootRef, enabled: keyboardNavigationEnabled && !popupOpen, keys: "both", onActivate: (element) => {
    if (element.dataset.spatialAction !== "book-actions") return false;
    const book = books.find((candidate) => candidate.id === element.dataset.libraryBookId);
    if (book) openActionPopup(book, element);
    return true;
  } });
  useSpatialNavigation({ rootRef: popupRef, enabled: keyboardNavigationEnabled && popupOpen, keys: "both" });

  const chooseSort = (key: SortKey): void => setSort((current) => current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: 1 });
  const sortLabel = (key: SortKey): string => sort.key === key ? (sort.direction === 1 ? " ↑" : " ↓") : "";
  const activateFilter = (value: CollectionStatus | "all"): void => { if (filter !== value) setFilter(value); };

  return <main className="library-app" ref={rootRef}>
    <header className="library-header"><h1>Airnobe</h1><div className="library-header-actions">
      <button className="secondary-action compact-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="0" onClick={onOpenSettings}>设置</button>
      <button className="primary-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="0" onClick={onImport}>导入 EPUB</button>
    </div></header>
    <div className="library-grid">
      <nav className="library-filters" aria-label="藏书状态">
        <button type="button" data-spatial-item data-spatial-zone="filters" data-spatial-zone-order="0" data-spatial-row="0" data-library-filter="all" aria-pressed={filter === "all"} onFocus={() => activateFilter("all")} onClick={() => activateFilter("all")}><span>全部</span><b>{books.length}</b></button>
        {STATUS_ORDER.map((status, index) => <button key={status} type="button" data-spatial-item data-spatial-zone="filters" data-spatial-zone-order="0" data-spatial-row={String(index + 1)} aria-pressed={filter === status} onFocus={() => activateFilter(status)} onClick={() => activateFilter(status)}><span>{STATUS_LABELS[status]}</span><b>{books.filter((book) => book.collectionStatus === status).length}</b></button>)}
      </nav>
      <section className="library-list" aria-label="书籍列表">
        <div className="library-list-header">{([ ["title", "书名"], ["status", "状态"], ["recent", "最近打开"] ] as const).map(([key, label]) => <button key={key} type="button" onClick={() => chooseSort(key)} aria-pressed={sort.key === key}>{label}{sortLabel(key)}</button>)}</div>
        {visibleBooks.length === 0 ? <p className="library-empty">{books.length === 0 ? "书库为空" : "此分类暂无书籍"}</p> : visibleBooks.map((book, index) => <div className="library-row" data-selected={book.id === selectedBookId} key={book.id} onClick={() => onSelect(book.id)} onContextMenu={(event) => { event.preventDefault(); openActionPopup(book, event.currentTarget, { x: event.clientX, y: event.clientY }); }}>
          <button className={`library-row-title ${metadataLanguageClass(book, book.title) ?? ""}`} type="button" data-spatial-item data-spatial-zone="books" data-spatial-zone-order="1" data-spatial-row={String(index)} data-spatial-action="book-actions" data-library-book-id={book.id} onFocus={() => onSelect(book.id)} onDoubleClick={() => onRead(book.id)}>{book.title || "未命名书籍"}</button>
          <button className="library-row-status" type="button" data-spatial-item data-spatial-zone="books" data-spatial-zone-order="1" data-spatial-row={String(index)} aria-label={`${book.title || "未命名书籍"}状态：${STATUS_LABELS[book.collectionStatus]}`} onFocus={() => onSelect(book.id)} onClick={(event) => { event.stopPropagation(); openStatusPopup(book, event.currentTarget); }}>{STATUS_LABELS[book.collectionStatus]}</button>
          <span>{formatRecentlyOpened(book)}</span>
        </div>)}
      </section>
      <aside className="library-detail" aria-label="书籍详情">{selected && visibleBooks.some((book) => book.id === selected.id) && <>
        {coverUrl(selected) && <img className="library-cover" src={coverUrl(selected)} alt={`${selected.title}封面`} />}
        <div className="library-detail-heading"><h2 className={metadataLanguageClass(selected, selected.title)}>{selected.title || "未命名书籍"}</h2><p className={metadataLanguageClass(selected, selected.authors.join(" / "))}>{selected.authors.join(" / ") || "作者不详"}</p></div>
        <dl className="library-metadata"><div><dt>书籍</dt><dd>{contentKindLabel(selected)} · {annotationLabel(selected)} · {formatSize(selected.sourceSize)}</dd></div><div><dt>阅读</dt><dd>{selected.readingProgress ? `${Math.round(selected.readingProgress.progress * 100)}%${selected.readingProgress.chapterLabel ? ` · ${selected.readingProgress.chapterLabel}` : ""}` : "尚未开始"}</dd></div></dl>
      </>}</aside>
    </div>
    {popupOpen && <div className="library-popup-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) closePopup(); }}><div className="library-popup" ref={popupRef} style={{ left: statusPopup?.left ?? actionPopup?.left, top: statusPopup?.top ?? actionPopup?.top }} role={statusPopup ? "listbox" : "menu"} aria-label={statusPopup ? "选择收藏状态" : "书籍操作"}>
      {statusPopup && popupBook && STATUS_ORDER.map((status, index) => <button key={status} type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row={String(index)} aria-selected={popupBook.collectionStatus === status} onClick={() => void onUpdate(popupBook.id, { collectionStatus: status }).then(closePopup).catch(() => {})}>{STATUS_LABELS[status]}</button>)}
      {actionPopup && popupBook && <><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="0" onClick={() => { closePopup(); onRead(popupBook.id, "continue"); }}>继续阅读</button><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="1" onClick={() => { closePopup(); onRead(popupBook.id, "beginning"); }}>从头开始</button><a data-spatial-item data-spatial-zone="library-popup" data-spatial-row="2" href={sourceEpubUrl(popupBook)} download={popupBook.sourceFileName} onClick={closePopup}>导出 EPUB</a><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="3" onClick={() => { closePopup(); onDelete(popupBook.id); }}>删除</button></>}
    </div></div>}
  </main>;
}
