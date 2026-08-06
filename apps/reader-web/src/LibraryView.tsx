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

export function LibraryView({ books, selectedBookId, onSelect, onImport, onOpenSettings, onRead, onUpdate, onDelete = () => {}, keyboardNavigationEnabled = true }: LibraryViewProps) {
  const rootRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const popupReturnFocusRef = useRef<HTMLElement | null>(null);
  const [filter, setFilter] = useState<CollectionStatus | "all">("all");
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
      (item ?? rootRef.current?.querySelector<HTMLElement>("[data-library-filter='all']"))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [keyboardNavigationEnabled, selectedBookId]);

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

  useSpatialNavigation({ rootRef, enabled: keyboardNavigationEnabled && !popupOpen, keys: "both", onActivate: (element) => {
    if (element.dataset.spatialAction !== "book-actions") return false;
    const book = books.find((candidate) => candidate.id === element.dataset.libraryBookId);
    if (book) openActionPopup(book, element);
    return true;
  } });
  useSpatialNavigation({ rootRef: popupRef, enabled: keyboardNavigationEnabled && popupOpen, keys: "both", onCancel: () => { if (statusMenuOpen) { setStatusMenuOpen(false); requestAnimationFrame(() => popupRef.current?.querySelector<HTMLElement>("[data-popup-action='status']")?.focus({ preventScroll: true })); return true; } closePopup(); return true; } });

  const chooseSort = (key: SortKey): void => setSort((current) => current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: 1 });
  const sortLabel = (key: SortKey): string => sort.key === key ? (sort.direction === 1 ? " ↑" : " ↓") : "";
  const activateFilter = (value: CollectionStatus | "all"): void => { if (filter !== value) setFilter(value); };

  return <main className="library-app" ref={rootRef}>
    <header className="library-header"><h1>Airnobe</h1><div className="library-header-actions">
      <button className="library-icon-action" type="button" title="导入 EPUB" aria-label="导入 EPUB" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="0" onClick={onImport}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4-4 4 4 4-4M5 19h14" /></svg></button>
      <button className="library-icon-action" type="button" title="设置" aria-label="设置" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="0" onClick={onOpenSettings}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 3.5-2.1-1.1.1-2.4-2.5-1.5-2 1.2L11.4 7 9 8.3 7 7 4.5 8.5l.1 2.4L2.5 12l2.1 1.1-.1 2.4L7 17l2-1.2 2.1 1.2 2.4-1.3 2 1.3 2.5-1.5-.1-2.4L20 12Z" /></svg></button>
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
          <span className="library-row-status">{STATUS_LABELS[book.collectionStatus]}</span>
          <span className="library-row-recent">{formatRecentlyOpened(book)}</span>
        </div>)}
      </section>
      <aside className="library-detail" aria-label="书籍详情">{selected && visibleBooks.some((book) => book.id === selected.id) && <>
        {coverUrl(selected) && <img className="library-cover" src={coverUrl(selected)} alt={`${selected.title}封面`} />}
        <div className="library-detail-heading"><h2 className={metadataLanguageClass(selected, selected.title)}>{selected.title || "未命名书籍"}</h2><p className={metadataLanguageClass(selected, selected.authors.join(" / "))}>{selected.authors.join(" / ") || "作者不详"}</p></div>
        <dl className="library-metadata"><div><dt>书籍</dt><dd>{contentKindLabel(selected)} · {annotationLabel(selected)} · {formatSize(selected.sourceSize)}</dd></div><div><dt>阅读</dt><dd>{selected.readingProgress ? `${Math.round(selected.readingProgress.progress * 100)}%${selected.readingProgress.chapterLabel ? ` · ${selected.readingProgress.chapterLabel}` : ""}` : "尚未开始"}</dd></div></dl>
      </>}</aside>
    </div>
    {popupOpen && <div className="library-popup-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) closePopup(); }}><div className="library-popup" ref={popupRef} style={{ left: actionPopup?.left, top: actionPopup?.top }} role="menu" aria-label={statusMenuOpen ? "选择收藏状态" : "书籍操作"}>
      {popupBook && statusMenuOpen && STATUS_ORDER.map((status, index) => <button key={status} type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row={String(index)} aria-selected={popupBook.collectionStatus === status} onClick={() => void onUpdate(popupBook.id, { collectionStatus: status }).then(closePopup).catch(() => {})}>{STATUS_LABELS[status]}</button>)}
      {popupBook && !statusMenuOpen && <><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="0" onClick={() => { closePopup(); onRead(popupBook.id, "continue"); }}>继续阅读</button><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="1" onClick={() => { closePopup(); onRead(popupBook.id, "beginning"); }}>从头开始</button><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="2" data-popup-action="status" onClick={openStatusMenu}>修改状态</button><a data-spatial-item data-spatial-zone="library-popup" data-spatial-row="3" href={sourceEpubUrl(popupBook)} download={popupBook.sourceFileName} onClick={closePopup}>导出 EPUB</a><button type="button" data-spatial-item data-spatial-zone="library-popup" data-spatial-row="4" onClick={() => { closePopup(); onDelete(popupBook.id); }}>删除</button></>}
    </div></div>}
  </main>;
}
