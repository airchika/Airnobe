import { useEffect, useMemo, useRef, useState } from "react";
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
  onReimport?(bookId: string): void;
  onDelete?(bookId: string): void;
  keyboardNavigationEnabled?: boolean;
}

const STATUS_LABELS: Record<CollectionStatus, string> = { wish: "想看", reading: "在看", completed: "看过", "on-hold": "搁置", dropped: "放弃" };
const STATUS_ORDER: CollectionStatus[] = ["wish", "reading", "completed", "on-hold", "dropped"];
const STATUS_SORT: CollectionStatus[] = ["reading", "completed", "wish", "on-hold", "dropped"];
type SortKey = "title" | "author" | "status" | "recent";

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

export function LibraryView({ books, selectedBookId, onSelect, onImport, onOpenSettings, onRead, onUpdate, onReimport = () => {}, onDelete = () => {}, keyboardNavigationEnabled = true }: LibraryViewProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<CollectionStatus | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "recent", direction: 1 });
  const sortedBooks = useMemo(() => [...books].sort((left, right) => {
    let comparison = 0;
    if (sort.key === "title") comparison = collator.compare(left.title, right.title);
    else if (sort.key === "author") comparison = collator.compare(left.authors.join(" / "), right.authors.join(" / "));
    else if (sort.key === "status") comparison = STATUS_SORT.indexOf(left.collectionStatus) - STATUS_SORT.indexOf(right.collectionStatus);
    else {
      const leftTime = recentTimestamp(left);
      const rightTime = recentTimestamp(right);
      if (leftTime === undefined && rightTime !== undefined) return 1;
      if (leftTime !== undefined && rightTime === undefined) return -1;
      comparison = (rightTime ?? 0) - (leftTime ?? 0);
    }
    if (sort.key === "recent" && comparison === 0 || sort.key === "status" && comparison === 0) {
      const leftTime = recentTimestamp(left) ?? -Infinity;
      const rightTime = recentTimestamp(right) ?? -Infinity;
      comparison = rightTime - leftTime;
    }
    return comparison * sort.direction || collator.compare(left.title, right.title) || left.id.localeCompare(right.id);
  }), [books, sort]);
  const visibleBooks = useMemo(() => filter === "all" ? sortedBooks : sortedBooks.filter((book) => book.collectionStatus === filter), [filter, sortedBooks]);
  const selected = books.find((book) => book.id === selectedBookId);

  useEffect(() => { if (!visibleBooks.some((book) => book.id === selectedBookId)) onSelect(visibleBooks[0]?.id ?? ""); }, [onSelect, selectedBookId, visibleBooks]);
  useEffect(() => {
    if (!keyboardNavigationEnabled) return;
    const activeWhenScheduled = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== activeWhenScheduled && active instanceof HTMLElement && rootRef.current?.contains(active)) return;
      if (active instanceof HTMLElement && rootRef.current?.contains(active) && active.closest(".library-filters")) return;
      const row = [...rootRef.current?.querySelectorAll<HTMLElement>("[data-library-book-id]") ?? []].find((item) => item.dataset.libraryBookId === selectedBookId);
      (row ?? rootRef.current?.querySelector<HTMLElement>("[data-library-filter='all']"))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [keyboardNavigationEnabled, selectedBookId]);

  useSpatialNavigation({ rootRef, enabled: keyboardNavigationEnabled, keys: "both", onActivate: (element) => {
    if (element.dataset.spatialAction !== "read-book") return false;
    const id = element.dataset.libraryBookId;
    if (id) onRead(id);
    return true;
  } });

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
        <div className="library-list-header">{([ ["title", "书名"], ["author", "作者"], ["status", "状态"], ["recent", "最近打开"] ] as const).map(([key, label]) => <button key={key} type="button" onClick={() => chooseSort(key)} aria-pressed={sort.key === key}>{label}{sortLabel(key)}</button>)}</div>
        {visibleBooks.length === 0 ? <p className="library-empty">{books.length === 0 ? "书库为空" : "此分类暂无书籍"}</p> : visibleBooks.map((book, index) => <button className="library-row" data-selected={book.id === selectedBookId} key={book.id} type="button" data-spatial-item data-spatial-zone="books" data-spatial-zone-order="1" data-spatial-row={String(index)} data-spatial-action="read-book" data-library-book-id={book.id} onFocus={() => onSelect(book.id)} onClick={() => onSelect(book.id)} onDoubleClick={() => onRead(book.id)}>
          <span className="library-row-title">{book.title || "未命名书籍"}</span><span>{book.authors.join(" / ") || "作者不详"}</span><span>{STATUS_LABELS[book.collectionStatus]}</span><span>{formatRecentlyOpened(book)}</span>
        </button>)}
      </section>
      <aside className="library-detail" aria-label="书籍详情">{selected && visibleBooks.some((book) => book.id === selected.id) && <>
        {coverUrl(selected) && <img className="library-cover" src={coverUrl(selected)} alt={`${selected.title}封面`} />}
        <div className="library-detail-heading"><h2>{selected.title || "未命名书籍"}</h2><p>{selected.authors.join(" / ") || "作者不详"}</p></div>
        <dl className="library-metadata"><div><dt>书籍</dt><dd>{contentKindLabel(selected)} · {annotationLabel(selected)} · {formatSize(selected.sourceSize)}</dd></div><div><dt>阅读</dt><dd>{selected.readingProgress ? `${Math.round(selected.readingProgress.progress * 100)}%${selected.readingProgress.chapterLabel ? ` · ${selected.readingProgress.chapterLabel}` : ""}` : "尚未开始"}</dd></div></dl>
        <div className="library-status" role="group" aria-label="收藏状态">{STATUS_ORDER.map((status) => <button key={status} type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="1" aria-pressed={selected.collectionStatus === status} onClick={() => void onUpdate(selected.id, { collectionStatus: status }).catch(() => {})}>{STATUS_LABELS[status]}</button>)}</div>
        <div className="library-detail-actions">
          <button className="primary-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="2" onClick={() => onRead(selected.id, "continue")}>继续阅读</button>
          <button className="secondary-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="2" onClick={() => onRead(selected.id, "beginning")}>从头阅读</button>
          <button className="secondary-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="2" onClick={() => onReimport(selected.id)}>重新导入</button>
          <a className="secondary-action" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="2" href={sourceEpubUrl(selected)} download={selected.sourceFileName}>导出 EPUB</a>
          <button className="danger-action" type="button" aria-label="删除当前书籍" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="2" onClick={() => onDelete(selected.id)}>删除</button>
        </div>
      </>}</aside>
    </div>
  </main>;
}
