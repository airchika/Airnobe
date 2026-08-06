import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { BookReader } from "./BookReader.js";
import { LibraryView } from "./LibraryView.js";
import {
  importEpubFile,
  loadBookFromApi,
  loadBookFromFiles,
  saveReadingPosition,
  type LibraryBookSummary,
  type LoadedBook,
} from "./book-source.js";
import { createDemoBook } from "./demo-book.js";
import {
  deleteLibraryBook,
  loadLibrary,
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
import { applyTheme, BUILTIN_THEMES, DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, type ThemeDefinition } from "./themes.js";

type BatchDuplicateAction = "ignore" | "replace" | "add";
interface BatchDuplicateDecision { action: BatchDuplicateAction | "cancel"; bookId?: string; applyToRemaining?: boolean }
interface ImportBatchSummary {
  total: number; imported: number; replaced: number; added: number; ignored: number; invalid: number; cancelled: number;
  failures: Array<{ fileName: string; message: string }>;
  warnings: Array<{ fileName: string; message: string }>;
}

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
    candidates: LibraryBookSummary[];
  }>();
  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string>();
  const [applyDuplicateToRemaining, setApplyDuplicateToRemaining] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState<{ bookId: string; title: string }>();
  const [settings, setSettings] = useState<ReaderSettings>(() => cloneReaderSettings(DEFAULT_READER_SETTINGS));
  const [themes, setThemes] = useState<AvailableTheme[]>(builtinThemeOptions);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  const [duplicateSelectEditing, setDuplicateSelectEditing] = useState(false);
  const epubInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(loaded);
  const overlayRootRef = useRef<HTMLDivElement>(null);
  const duplicateSelectRef = useRef<HTMLSelectElement>(null);
  const duplicateSelectEntryRef = useRef<HTMLDivElement>(null);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const previousOverlayRef = useRef<string | undefined>(undefined);
  const duplicateResolverRef = useRef<((decision: BatchDuplicateDecision) => void) | undefined>(undefined);
  const importRunningRef = useRef(false);

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
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const change = () => setSystemDark(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const dark = settings.appearance.theme.mode === "night" || (settings.appearance.theme.mode === "system" && systemDark);
    const selectedId = dark ? settings.appearance.theme.darkThemeId : settings.appearance.theme.lightThemeId;
    const fallbackId = dark ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
    const selected = themes.find((item) => item.theme.id === selectedId && item.theme.variant === (dark ? "dark" : "light"))?.theme
      ?? BUILTIN_THEMES.find((theme) => theme.id === fallbackId)!;
    applyTheme(selected);
  }, [settings.appearance.theme, systemDark, themes]);

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
    const previous = settings;
    try {
      setError(undefined);
      setSettings(await saveReaderSettings(next));
    } catch (settingsError) {
      setSettings(previous);
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

  const requestDuplicateDecision = (file: File, candidates: LibraryBookSummary[]): Promise<BatchDuplicateDecision> => new Promise((resolve) => {
    duplicateResolverRef.current = resolve;
    setSelectedDuplicateId(candidates[0]?.id);
    setApplyDuplicateToRemaining(false);
    setDuplicatePrompt({ file, candidates });
  });

  const resolveDuplicateDecision = (decision: BatchDuplicateDecision): void => {
    const resolve = duplicateResolverRef.current;
    duplicateResolverRef.current = undefined;
    setDuplicatePrompt(undefined);
    setDuplicateSelectEditing(false);
    resolve?.(decision);
  };

  const batchNotice = (summary: ImportBatchSummary): string => {
    const parts = [`导入 ${summary.imported} 本`, `覆盖 ${summary.replaced} 本`, `另存 ${summary.added} 本`, `忽略 ${summary.ignored} 本`];
    if (summary.invalid > 0) parts.push(`非 EPUB ${summary.invalid} 个`);
    if (summary.failures.length > 0) parts.push(`失败 ${summary.failures.length} 本`);
    if (summary.cancelled > 0) parts.push(`取消 ${summary.cancelled} 本`);
    const details = [...summary.failures, ...summary.warnings].map((item) => `${item.fileName}：${item.message}`).join("；");
    return `批量处理完成：${parts.join("，")}。${details ? ` ${details}` : ""}`;
  };

  const startImportBatch = useCallback(async (input: File[], invalid = 0): Promise<void> => {
    if (importRunningRef.current) { setError("已有 EPUB 导入任务正在进行。"); return; }
    const files = input.filter((file) => file.name.toLowerCase().endsWith(".epub"));
    const invalidCount = invalid + input.length - files.length;
    if (files.length === 0) { setNotice(invalidCount > 0 ? `没有可导入的 EPUB，已忽略 ${invalidCount} 个其他项目。` : "没有选择 EPUB 文件。"); return; }
    importRunningRef.current = true;
    setError(undefined); setNotice(undefined); returnToLibrary();
    const summary: ImportBatchSummary = { total: files.length, imported: 0, replaced: 0, added: 0, ignored: 0, invalid: invalidCount, cancelled: 0, failures: [], warnings: [] };
    let policy: BatchDuplicateAction | undefined;
    let lastBookId: string | undefined;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index] as File;
        setLoading(`正在导入 ${index + 1}/${files.length}：${file.name}`);
        try {
          let result = await importEpubFile(file, policy === "add" ? { action: "add" } : undefined);
          if (result.outcome === "exact-duplicate") { summary.ignored += 1; continue; }
          if (result.outcome === "possible-duplicate") {
            let decision: BatchDuplicateDecision;
            if (policy === "ignore") decision = { action: "ignore" };
            else if (policy === "add") decision = { action: "add" };
            else if (policy === "replace" && result.candidates[0]) decision = { action: "replace", bookId: result.candidates[0].id };
            else { setLoading(undefined); decision = await requestDuplicateDecision(file, result.candidates); }
            if (decision.action === "cancel") { summary.cancelled = files.length - index; break; }
            if (decision.applyToRemaining) policy = decision.action;
            if (decision.action === "ignore") { summary.ignored += 1; continue; }
            if (decision.action === "replace" && !decision.bookId) throw new Error("没有选择要覆盖的书籍。");
            setLoading(`正在${decision.action === "replace" ? "覆盖" : "另存"} ${index + 1}/${files.length}：${file.name}`);
            result = await importEpubFile(file, decision.action === "replace" ? { action: "replace", bookId: decision.bookId as string } : { action: "add" });
            if (result.outcome !== "imported") throw new Error("重复书籍处理后仍未完成导入。");
            lastBookId = result.bookId;
            if (decision.action === "replace") summary.replaced += 1; else summary.added += 1;
            if (result.warning) summary.warnings.push({ fileName: file.name, message: result.warning });
            continue;
          }
          lastBookId = result.bookId;
          summary.imported += 1;
          if (result.warning) summary.warnings.push({ fileName: file.name, message: result.warning });
        } catch (loadError) {
          summary.failures.push({ fileName: file.name, message: (loadError as Error).message });
        }
      }
      await refreshLibrary(lastBookId);
      setNotice(batchNotice(summary));
    } finally {
      setLoading(undefined);
      importRunningRef.current = false;
      duplicateResolverRef.current = undefined;
      setDuplicatePrompt(undefined);
    }
  }, [refreshLibrary]);

  const onEpubSelected = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = event.currentTarget.files ? [...event.currentTarget.files] : [];
    event.currentTarget.value = "";
    if (files.length > 0) void startImportBatch(files);
  };

  useEffect(() => {
    const containsFiles = (event: DragEvent): boolean => [...(event.dataTransfer?.types ?? [])].includes("Files");
    const onDragEnter = (event: DragEvent): void => { if (!containsFiles(event)) return; event.preventDefault(); setDragActive(true); };
    const onDragOver = (event: DragEvent): void => { if (!containsFiles(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; setDragActive(true); };
    const onDragLeave = (event: DragEvent): void => { if (event.relatedTarget === null) setDragActive(false); };
    const onDrop = (event: DragEvent): void => {
      if (!containsFiles(event)) return;
      event.preventDefault(); setDragActive(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) void startImportBatch(files);
    };
    window.addEventListener("dragenter", onDragEnter); window.addEventListener("dragover", onDragOver); window.addEventListener("dragleave", onDragLeave); window.addEventListener("drop", onDrop);
    return () => { window.removeEventListener("dragenter", onDragEnter); window.removeEventListener("dragover", onDragOver); window.removeEventListener("dragleave", onDragLeave); window.removeEventListener("drop", onDrop); };
  }, [startImportBatch]);

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
    keys: "both",
    onCancel: () => {
      if (duplicatePrompt) { resolveDuplicateDecision({ action: "cancel" }); return true; }
      if (deletePrompt) { setDeletePrompt(undefined); return true; }
      if (error) { setError(undefined); return true; }
      if (notice) { setNotice(undefined); return true; }
      return false;
    },
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
        multiple
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
            onPreviewSettings={setSettings}
            onSaveReadingPosition={saveBookReadingPosition}
            themes={themes}
            onImportTheme={(theme) => importCustomTheme(theme)}
            onThemesChange={setThemes}
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
              onDelete={(bookId) => {
              const book = libraryBooks.find((candidate) => candidate.id === bookId);
              if (book) setDeletePrompt({ bookId, title: book.title });
            }}
            keyboardNavigationEnabled={keyboardNavigationEnabled}
          />}
      {settingsOpen && <SettingsPanel
        settings={settings}
        themes={themes}
        scope={loaded ? "reader" : "library"}
        onPreview={(next) => setSettings(next)}
        onSave={saveSettings}
        onImport={(theme: ThemeDefinition) => importCustomTheme(theme)}
        onThemesChange={setThemes}
        onClose={() => setSettingsOpen(false)}
      />}
      {overlayMessage && <div className="loading-overlay" role="status"><span className="loading-dot" />{overlayMessage}</div>}
      {dragActive && !overlayMessage && <div className="file-drop-overlay" role="status"><span>松开以导入 EPUB</span></div>}
      <div className="app-spatial-overlays" ref={overlayRootRef}>
      {duplicatePrompt && (
        <div className="reader-menu-backdrop">
          <div className="duplicate-dialog" role="dialog" aria-modal="true" aria-label="重复书籍">
            <strong>可能是同一本书的新版本</strong>
            <span>{duplicatePrompt.file.name}</span>
            {duplicatePrompt.candidates.length > 1
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
            <button type="button" className="duplicate-apply-all" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="1" aria-pressed={applyDuplicateToRemaining} onClick={() => setApplyDuplicateToRemaining((current) => !current)}>对后续同类冲突执行此操作：{applyDuplicateToRemaining ? "是" : "否"}</button>
            <div className="duplicate-dialog-actions">
              <button type="button" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="2" className="primary-action" onClick={() => resolveDuplicateDecision({ action: "replace", ...(selectedDuplicateId ? { bookId: selectedDuplicateId } : {}), applyToRemaining: applyDuplicateToRemaining })}>覆盖</button>
              <button type="button" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="2" className="secondary-action" onClick={() => resolveDuplicateDecision({ action: "add", applyToRemaining: applyDuplicateToRemaining })}>作为新书加入</button>
              <button type="button" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="2" className="secondary-action" onClick={() => resolveDuplicateDecision({ action: "ignore", applyToRemaining: applyDuplicateToRemaining })}>忽略</button>
              <button type="button" data-spatial-item data-spatial-zone="dialog" data-spatial-zone-order="0" data-spatial-row="2" className="secondary-action" onClick={() => resolveDuplicateDecision({ action: "cancel" })}>取消剩余导入</button>
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
