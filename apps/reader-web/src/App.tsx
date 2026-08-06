import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { BookReader } from "./BookReader.js";
import { LibraryView } from "./LibraryView.js";
import {
  importEpubFile,
  loadBookFromApi,
  loadBookFromFiles,
  saveReadingPosition,
  type DuplicateResolution,
  type EpubImportResult,
  type LibraryBookSummary,
  type LoadedBook,
} from "./book-source.js";
import { createDemoBook } from "./demo-book.js";
import {
  deleteLibraryBook,
  loadLibrary,
  reimportLibraryBook,
  updateLibraryBook,
  type CollectionStatus,
  type LibraryBook,
} from "./library-client.js";
import {
  cloneReaderSettings,
  DEFAULT_READER_SETTINGS,
  loadReaderSettings,
  saveReaderSettings,
  type ReaderSettings,
} from "./reader-settings.js";
import { EMPTY_READING_STATE, readingProgressSummary, type ReadingPosition } from "./reading-state.js";
import { useSpatialNavigation } from "./spatial-navigation.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { builtinThemeOptions, importTheme as importCustomTheme, loadThemes, type AvailableTheme } from "./theme-client.js";
import { applyTheme, BUILTIN_THEMES, DEFAULT_THEME_ID, type ThemeDefinition } from "./themes.js";

export function App() {
  const initialDemo = new URLSearchParams(window.location.search).get("demo") === "1";
  const [loaded, setLoaded] = useState<LoadedBook | undefined>(() => initialDemo ? createDemoBook() : undefined);
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string>();
  const [libraryLoading, setLibraryLoading] = useState(!initialDemo);
  const [loading, setLoading] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    file: File;
    kind: "exact" | "possible";
    candidates: LibraryBookSummary[];
  }>();
  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string>();
  const [deletePrompt, setDeletePrompt] = useState<{ bookId: string; title: string }>();
  const [settings, setSettings] = useState<ReaderSettings>(() => cloneReaderSettings(DEFAULT_READER_SETTINGS));
  const [themes, setThemes] = useState<AvailableTheme[]>(builtinThemeOptions);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [duplicateSelectEditing, setDuplicateSelectEditing] = useState(false);
  const epubInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(loaded);
  const overlayRootRef = useRef<HTMLDivElement>(null);
  const duplicateSelectRef = useRef<HTMLSelectElement>(null);
  const duplicateSelectEntryRef = useRef<HTMLDivElement>(null);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const previousOverlayRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => () => loadedRef.current?.dispose(), []);

  useEffect(() => {
    let active = true;
    void loadReaderSettings()
      .then((next) => {
        if (active) setSettings(next);
      })
      .catch((settingsError) => {
        if (active) setError((settingsError as Error).message);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void loadThemes().then((next) => { if (active) setThemes(next); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const selected = themes.find((item) => item.theme.id === settings.appearance.themeId)?.theme
      ?? BUILTIN_THEMES.find((theme) => theme.id === DEFAULT_THEME_ID)!;
    applyTheme(selected);
  }, [settings.appearance.themeId, themes]);

  const refreshLibrary = useCallback(async (preferredBookId?: string): Promise<void> => {
    const books = await loadLibrary();
    setLibraryBooks(books);
    setSelectedBookId((current) => {
      if (preferredBookId && books.some((book) => book.id === preferredBookId)) return preferredBookId;
      if (current && books.some((book) => book.id === current)) return current;
      return [...books].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id;
    });
  }, []);

  useEffect(() => {
    if (initialDemo) return;
    let active = true;
    void refreshLibrary()
      .catch((libraryError) => {
        if (active) setError((libraryError as Error).message);
      })
      .finally(() => {
        if (active) setLibraryLoading(false);
      });
    return () => { active = false; };
  }, [initialDemo, refreshLibrary]);

  const openEpubPicker = (): void => epubInputRef.current?.click();

  const saveSettings = async (next: ReaderSettings): Promise<void> => {
    try {
      setError(undefined);
      setSettings(await saveReaderSettings(next));
    } catch (settingsError) {
      setError((settingsError as Error).message);
      throw settingsError;
    }
  };

  const saveBookReadingPosition = useCallback(async (position: ReadingPosition): Promise<void> => {
    const current = loadedRef.current;
    const bookId = current?.libraryBookId;
    if (!current || !bookId) return;
    try {
      setError(undefined);
      const state = await saveReadingPosition(bookId, position);
      if (loadedRef.current?.libraryBookId === bookId) loadedRef.current.readingState = state;
      const progress = readingProgressSummary(state);
      setLibraryBooks((books) => books.map((book) => book.id === bookId ? { ...book, readingProgress: progress } : book));
    } catch (progressError) {
      setError((progressError as Error).message);
      throw progressError;
    }
  }, []);

  const installBook = (next: LoadedBook): void => {
    setLoaded((current) => {
      current?.dispose();
      return next;
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const returnToLibrary = (): void => {
    setLoaded((current) => {
      current?.dispose();
      return undefined;
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const readLibraryBook = async (bookId: string, mode: "continue" | "beginning" = "continue"): Promise<void> => {
    setLoading("正在打开…");
    setError(undefined);
    try {
      const book = await loadBookFromApi(bookId);
      if (mode === "beginning") book.readingState = structuredClone(EMPTY_READING_STATE);
      installBook(book);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(undefined);
    }
  };

  const handleImportResult = async (file: File, result: EpubImportResult): Promise<void> => {
    if (result.outcome === "imported") {
      returnToLibrary();
      await refreshLibrary(result.bookId);
      if (result.warning) setNotice(result.warning);
      return;
    }
    const candidates = result.outcome === "exact-duplicate" ? [result.book] : result.candidates;
    setDuplicatePrompt({ file, kind: result.outcome === "exact-duplicate" ? "exact" : "possible", candidates });
    setSelectedDuplicateId(candidates[0]?.id);
  };

  const submitEpub = async (file: File, resolution?: DuplicateResolution): Promise<void> => {
    setLoading(resolution?.action === "replace" ? "正在替换…" : "正在转换 EPUB…");
    setError(undefined);
    setNotice(undefined);
    try {
      await handleImportResult(file, await importEpubFile(file, resolution));
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(undefined);
    }
  };

  const onEpubSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    await submitEpub(file);
  };

  const onDirectorySelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = event.currentTarget.files ? [...event.currentTarget.files] : [];
    event.currentTarget.value = "";
    if (files.length === 0) return;
    setLoading("正在打开…");
    setError(undefined);
    try {
      installBook(await loadBookFromFiles(files));
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(undefined);
    }
  };

  const directoryAttributes = { webkitdirectory: "", directory: "" };
  const updateBook = async (
    bookId: string,
    patch: { collectionStatus?: CollectionStatus; note?: string },
  ): Promise<void> => {
    setError(undefined);
    try {
      const updated = await updateLibraryBook(bookId, patch);
      setLibraryBooks((books) => books.map((book) => book.id === bookId ? updated : book));
    } catch (updateError) {
      setError((updateError as Error).message);
      throw updateError;
    }
  };

  const reimportBook = async (bookId: string): Promise<void> => {
    setLoading("正在重新导入…");
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await reimportLibraryBook(bookId);
      await refreshLibrary(bookId);
      setNotice(result.warning ?? "已使用保存的原始 EPUB 重新生成阅读数据。");
    } catch (reimportError) {
      setError((reimportError as Error).message);
    } finally {
      setLoading(undefined);
    }
  };

  const confirmDeleteBook = async (): Promise<void> => {
    const prompt = deletePrompt;
    if (!prompt) return;
    setDeletePrompt(undefined);
    setLoading("正在删除…");
    setError(undefined);
    setNotice(undefined);
    try {
      await deleteLibraryBook(prompt.bookId);
      await refreshLibrary();
      setNotice(`已删除“${prompt.title || "未命名书籍"}”。`);
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setLoading(undefined);
    }
  };

  const overlayMessage = loading ?? (libraryLoading && !loaded ? "正在加载书库…" : undefined);
  const interactiveOverlay = settingsOpen ? "settings" : duplicatePrompt ? "duplicate" : deletePrompt ? "delete" : error ? "error" : notice ? "notice" : undefined;

  const activateOverlayItem = useCallback((element: HTMLElement): boolean => {
    if (element.dataset.spatialAction !== "edit-duplicate-select") return false;
    setDuplicateSelectEditing(true);
    requestAnimationFrame(() => duplicateSelectRef.current?.focus());
    return true;
  }, []);

  useSpatialNavigation({
    rootRef: overlayRootRef,
    enabled: Boolean(interactiveOverlay && interactiveOverlay !== "settings"),
    editing: duplicateSelectEditing,
    onActivate: activateOverlayItem,
  });

  useEffect(() => {
    if (interactiveOverlay && !previousOverlayRef.current) {
      overlayReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (interactiveOverlay) {
      const frame = requestAnimationFrame(() => overlayRootRef.current?.querySelector<HTMLElement>("[data-spatial-item]")?.focus({ preventScroll: true }));
      previousOverlayRef.current = interactiveOverlay;
      return () => cancelAnimationFrame(frame);
    }
    if (previousOverlayRef.current) {
      setDuplicateSelectEditing(false);
      requestAnimationFrame(() => overlayReturnFocusRef.current?.focus({ preventScroll: true }));
    }
    previousOverlayRef.current = undefined;
  }, [interactiveOverlay]);

  const keyboardNavigationEnabled = !overlayMessage && !interactiveOverlay;
  return (
    <>
      <input
        className="file-input"
        type="file"
        accept=".epub,application/epub+zip"
        ref={epubInputRef}
        onChange={onEpubSelected}
        aria-label="选择 EPUB 文件"
      />
      <input
        className="file-input"
        type="file"
        multiple
        ref={directoryInputRef}
        onChange={onDirectorySelected}
        aria-label="选择 Airnobe 书籍目录"
        {...directoryAttributes}
      />
      {loaded
        ? <BookReader
            key={loaded.book.id}
            loaded={loaded}
            onChooseBook={openEpubPicker}
            onReturnToLibrary={returnToLibrary}
            settings={settings}
            onSaveSettings={saveSettings}
            onSaveReadingPosition={saveBookReadingPosition}
            onOpenSettings={() => setSettingsOpen(true)}
            keyboardNavigationEnabled={keyboardNavigationEnabled}
          />
        : <LibraryView
            books={libraryBooks}
            {...(selectedBookId ? { selectedBookId } : {})}
            onSelect={(bookId) => setSelectedBookId(bookId || undefined)}
            onImport={openEpubPicker}
            onOpenSettings={() => setSettingsOpen(true)}
            onRead={(bookId, mode) => void readLibraryBook(bookId, mode)}
            onUpdate={updateBook}
            onReimport={(bookId) => void reimportBook(bookId)}
            onDelete={(bookId) => {
              const book = libraryBooks.find((candidate) => candidate.id === bookId);
              if (book) setDeletePrompt({ bookId, title: book.title });
            }}
            keyboardNavigationEnabled={keyboardNavigationEnabled}
          />}
      {settingsOpen && <SettingsPanel
        settings={settings}
        themes={themes}
        onPreview={(next) => setSettings(next)}
        onSave={saveSettings}
        onImport={(theme: ThemeDefinition) => importCustomTheme(theme)}
        onThemesChange={setThemes}
        onClose={() => setSettingsOpen(false)}
      />}
      {overlayMessage && <div className="loading-overlay" role="status"><span className="loading-dot" />{overlayMessage}</div>}
      <div className="app-spatial-overlays" ref={overlayRootRef}>
      {duplicatePrompt && (
        <div className="reader-menu-backdrop">
          <div className="duplicate-dialog" role="dialog" aria-modal="true" aria-label="重复书籍">
            <strong>{duplicatePrompt.kind === "exact" ? "这本书已在书库中" : "可能是同一本书的新版本"}</strong>
            {duplicatePrompt.kind === "possible" && duplicatePrompt.candidates.length > 1
              ? (
                <div className="duplicate-select-entry" ref={duplicateSelectEntryRef} tabIndex={0} data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="0" data-spatial-action="edit-duplicate-select">
                <select
                  ref={duplicateSelectRef}
                  aria-label="要替换的书籍"
                  value={selectedDuplicateId}
                  onFocus={() => setDuplicateSelectEditing(true)}
                  onBlur={() => setDuplicateSelectEditing(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" || event.key === "Enter") {
                      event.currentTarget.blur();
                      requestAnimationFrame(() => duplicateSelectEntryRef.current?.focus());
                    }
                  }}
                  onChange={(event) => setSelectedDuplicateId(event.target.value)}
                >
                  {duplicatePrompt.candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                  ))}
                </select>
                </div>
              )
              : <span>{duplicatePrompt.candidates[0]?.title || "未命名书籍"}</span>}
            <div className="duplicate-dialog-actions">
              {duplicatePrompt.kind === "exact"
                ? <button type="button" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="1" className="primary-action" onClick={() => {
                    const id = duplicatePrompt.candidates[0]?.id;
                    setDuplicatePrompt(undefined);
                    if (!id) return;
                    void readLibraryBook(id);
                  }}>打开已有书</button>
                : (
                  <>
                    <button type="button" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="1" className="primary-action" onClick={() => {
                      const prompt = duplicatePrompt;
                      const bookId = selectedDuplicateId;
                      setDuplicatePrompt(undefined);
                      if (bookId) void submitEpub(prompt.file, { action: "replace", bookId });
                    }}>替换</button>
                    <button type="button" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="1" className="secondary-action" onClick={() => {
                      const file = duplicatePrompt.file;
                      setDuplicatePrompt(undefined);
                      void submitEpub(file, { action: "add" });
                    }}>另存为新书</button>
                  </>
                )}
              <button type="button" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="1" className="secondary-action" onClick={() => setDuplicatePrompt(undefined)}>取消</button>
            </div>
          </div>
        </div>
      )}
      {deletePrompt && !duplicatePrompt && (
        <div className="reader-menu-backdrop">
          <div className="duplicate-dialog" role="dialog" aria-modal="true" aria-label="删除书籍">
            <strong>删除当前书籍？</strong>
            <span>“{deletePrompt.title || "未命名书籍"}”的阅读数据和保存的原始 EPUB 都会被永久删除。</span>
            <div className="duplicate-dialog-actions">
              <button type="button" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="0" className="danger-action" onClick={() => void confirmDeleteBook()}>确认删除</button>
              <button type="button" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="0" className="secondary-action" onClick={() => setDeletePrompt(undefined)}>取消</button>
            </div>
          </div>
        </div>
      )}
      {!error && notice && !duplicatePrompt && !deletePrompt && (
        <div className="notice-toast" role="status">
          <span>{notice}</span>
          <button type="button" data-spatial-item data-spatial-zone="toast" data-spatial-zone-order="0" data-spatial-row="0" onClick={() => setNotice(undefined)} aria-label="关闭提示">×</button>
        </div>
      )}
      {error && !duplicatePrompt && !deletePrompt && (
        <div className="error-toast" role="alert">
          <strong>无法打开</strong>
          <span>{error}</span>
          <button type="button" data-spatial-item data-spatial-zone="toast" data-spatial-zone-order="0" data-spatial-row="0" onClick={() => setError(undefined)} aria-label="关闭错误">×</button>
        </div>
      )}
      </div>
    </>
  );
}
