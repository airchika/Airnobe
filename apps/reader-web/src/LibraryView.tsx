import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  coverUrl,
  sourceEpubUrl,
  type CollectionStatus,
  type LibraryBook,
} from "./library-client.js";
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

const STATUS_LABELS: Record<CollectionStatus, string> = {
  wish: "想看",
  reading: "在看",
  completed: "看过",
  "on-hold": "搁置",
  dropped: "放弃",
};

const STATUS_ORDER: CollectionStatus[] = ["wish", "reading", "completed", "on-hold", "dropped"];

function contentKindLabel(book: LibraryBook): string {
  return {
    chinese: "纯中文",
    japanese: "纯日文",
    parallel: "中日对照",
    mixed: "混合内容",
    unknown: "未分类",
  }[book.contentKind];
}

function annotationLabel(book: LibraryBook): string {
  return {
    "not-applicable": "无需程序注音",
    ready: "含程序注音",
    failed: "仅基础版本",
  }[book.annotationStatus];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
}

export function LibraryView({ books, selectedBookId, onSelect, onImport, onOpenSettings, onRead, onUpdate, onReimport = () => {}, onDelete = () => {}, keyboardNavigationEnabled = true }: LibraryViewProps) {
  const rootRef = useRef<HTMLElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const noteEntryRef = useRef<HTMLLabelElement>(null);
  const cancelNoteBlurRef = useRef(false);
  const [filter, setFilter] = useState<CollectionStatus | "all">("all");
  const [noteEditing, setNoteEditing] = useState(false);
  const sortedBooks = useMemo(
    () => [...books].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id)),
    [books],
  );
  const visibleBooks = useMemo(
    () => filter === "all" ? sortedBooks : sortedBooks.filter((book) => book.collectionStatus === filter),
    [filter, sortedBooks],
  );
  const selected = books.find((book) => book.id === selectedBookId);
  const [noteDraft, setNoteDraft] = useState(selected?.note ?? "");

  useEffect(() => {
    if (!visibleBooks.some((book) => book.id === selectedBookId)) onSelect(visibleBooks[0]?.id ?? "");
  }, [onSelect, selectedBookId, visibleBooks]);

  useEffect(() => {
    setNoteDraft(selected?.note ?? "");
    setNoteEditing(false);
  }, [selected?.id, selected?.note]);

  useEffect(() => {
    if (!keyboardNavigationEnabled) return;
    const activeWhenScheduled = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const currentActive = document.activeElement;
      if (currentActive !== activeWhenScheduled && currentActive instanceof HTMLElement && rootRef.current?.contains(currentActive)) return;
      const selectedRow = [...rootRef.current?.querySelectorAll<HTMLElement>("[data-library-book-id]") ?? []]
        .find((row) => row.dataset.libraryBookId === selectedBookId);
      const fallback = rootRef.current?.querySelector<HTMLElement>("[data-library-filter='all']");
      (selectedRow ?? fallback)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [keyboardNavigationEnabled, selectedBookId]);

  const activateSpatialItem = useCallback((element: HTMLElement): boolean => {
    if (element.dataset.spatialAction === "read-book") {
      const bookId = element.dataset.libraryBookId;
      if (bookId) onRead(bookId);
      return true;
    }
    if (element.dataset.spatialAction === "edit-note") {
      setNoteEditing(true);
      requestAnimationFrame(() => noteRef.current?.focus());
      return true;
    }
    return false;
  }, [onRead]);

  useSpatialNavigation({
    rootRef,
    enabled: keyboardNavigationEnabled,
    editing: noteEditing,
    onActivate: activateSpatialItem,
  });

  const commitNote = async (): Promise<void> => {
    if (!selected || noteDraft === selected.note) return;
    try {
      await onUpdate(selected.id, { note: noteDraft });
    } catch {
      setNoteDraft(selected.note);
    }
  };

  return (
    <main className="library-app" ref={rootRef}>
      <header className="library-header">
        <h1>Airnobe</h1>
        <div className="library-header-actions">
          <button className="secondary-action compact-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="0" onClick={onOpenSettings}>设置</button>
          <button className="primary-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="0" onClick={onImport}>导入 EPUB</button>
        </div>
      </header>
      <div className="library-grid">
        <nav className="library-filters" aria-label="藏书状态">
          <button type="button" data-spatial-item data-spatial-zone="filters" data-spatial-zone-order="0" data-spatial-row="0" data-library-filter="all" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            <span>全部</span><b>{books.length}</b>
          </button>
          {STATUS_ORDER.map((status, index) => (
            <button key={status} type="button" data-spatial-item data-spatial-zone="filters" data-spatial-zone-order="0" data-spatial-row={String(index + 1)} aria-pressed={filter === status} onClick={() => setFilter(status)}>
              <span>{STATUS_LABELS[status]}</span>
              <b>{books.filter((book) => book.collectionStatus === status).length}</b>
            </button>
          ))}
        </nav>

        <section className="library-list" aria-label="书籍列表">
          {visibleBooks.length === 0
            ? <p className="library-empty">{books.length === 0 ? "书库为空" : "此分类暂无书籍"}</p>
            : visibleBooks.map((book, index) => (
              <button
                className="library-row"
                data-selected={book.id === selectedBookId}
                key={book.id}
                type="button"
                data-spatial-item
                data-spatial-zone="books"
                data-spatial-zone-order="1"
                data-spatial-row={String(index)}
                data-spatial-action="read-book"
                data-library-book-id={book.id}
                onFocus={() => onSelect(book.id)}
                onClick={() => onSelect(book.id)}
                onDoubleClick={() => onRead(book.id)}
              >
                <span className="library-row-title">{book.title || "未命名书籍"}</span>
                <span className="library-row-note">{book.note}</span>
                <small>{STATUS_LABELS[book.collectionStatus]}</small>
              </button>
            ))}
        </section>

        <aside className="library-detail" aria-label="书籍详情">
          {selected && visibleBooks.some((book) => book.id === selected.id) && (
            <>
              {coverUrl(selected) && <img className="library-cover" src={coverUrl(selected)} alt={`${selected.title}封面`} />}
              <div className="library-detail-heading">
                <h2>{selected.title || "未命名书籍"}</h2>
                <p>{selected.authors.length > 0 ? selected.authors.join(" / ") : "作者不详"}</p>
              </div>
              <dl className="library-metadata">
                <div><dt>内容</dt><dd>{contentKindLabel(selected)}</dd></div>
                <div><dt>注音</dt><dd>{annotationLabel(selected)}</dd></div>
                <div><dt>原书</dt><dd>{formatSize(selected.sourceSize)}</dd></div>
                <div><dt>进度</dt><dd>{selected.readingProgress ? `${Math.round(selected.readingProgress.progress * 100)}%` : "尚未开始"}</dd></div>
                {selected.readingProgress?.chapterLabel && <div><dt>章节</dt><dd>{selected.readingProgress.chapterLabel}</dd></div>}
              </dl>
              <div className="library-status" role="group" aria-label="收藏状态">
                {STATUS_ORDER.map((status) => (
                  <button
                    key={status}
                    type="button"
                    data-spatial-item
                    data-spatial-zone="detail"
                    data-spatial-zone-order="2"
                    data-spatial-row="1"
                    aria-pressed={selected.collectionStatus === status}
                    onClick={() => void onUpdate(selected.id, { collectionStatus: status }).catch(() => {})}
                  >{STATUS_LABELS[status]}</button>
                ))}
              </div>
              <label
                className="library-note"
                ref={noteEntryRef}
                tabIndex={0}
                data-spatial-item
                data-spatial-zone="detail"
                data-spatial-zone-order="2"
                data-spatial-row="2"
                data-spatial-action="edit-note"
              >
                <span>备注</span>
                <textarea
                  ref={noteRef}
                  aria-label="备注"
                  maxLength={10_000}
                  value={noteDraft}
                  onFocus={() => setNoteEditing(true)}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  onBlur={() => {
                    setNoteEditing(false);
                    if (cancelNoteBlurRef.current) cancelNoteBlurRef.current = false;
                    else void commitNote();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      cancelNoteBlurRef.current = true;
                      setNoteDraft(selected.note);
                      setNoteEditing(false);
                      event.currentTarget.blur();
                      requestAnimationFrame(() => noteEntryRef.current?.focus());
                    } else if (event.key === "Enter" && event.ctrlKey) {
                      event.preventDefault();
                      setNoteEditing(false);
                      event.currentTarget.blur();
                      requestAnimationFrame(() => noteEntryRef.current?.focus());
                    }
                  }}
                />
              </label>
              <div className="library-detail-actions">
                <button className="primary-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="3" onClick={() => onRead(selected.id, "continue")}>继续阅读</button>
                <button className="secondary-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="3" onClick={() => onRead(selected.id, "beginning")}>从头阅读</button>
                <a className="secondary-action" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="3" href={sourceEpubUrl(selected)} download={selected.sourceFileName}>导出 EPUB</a>
              </div>
              <div className="library-detail-actions library-detail-actions--maintenance">
                <button className="secondary-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="4" onClick={() => onReimport(selected.id)}>重新导入</button>
                <button className="secondary-action danger-action" type="button" data-spatial-item data-spatial-zone="detail" data-spatial-zone-order="2" data-spatial-row="4" onClick={() => onDelete(selected.id)}>删除当前书籍</button>
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
