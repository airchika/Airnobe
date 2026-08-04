import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { BookReader } from "./BookReader.js";
import {
  importEpubFile,
  loadBookFromApi,
  loadBookFromFiles,
  type DuplicateResolution,
  type EpubImportResult,
  type LibraryBookSummary,
  type LoadedBook,
} from "./book-source.js";
import { createDemoBook } from "./demo-book.js";
import {
  cloneReaderSettings,
  DEFAULT_READER_SETTINGS,
  loadReaderSettings,
  saveReaderSettings,
  type ReaderSettings,
} from "./reader-settings.js";

export function App() {
  const initialDemo = new URLSearchParams(window.location.search).get("demo") === "1";
  const [loaded, setLoaded] = useState<LoadedBook | undefined>(() => initialDemo ? createDemoBook() : undefined);
  const [loading, setLoading] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    file: File;
    kind: "exact" | "possible";
    candidates: LibraryBookSummary[];
  }>();
  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string>();
  const [settings, setSettings] = useState<ReaderSettings>(() => cloneReaderSettings(DEFAULT_READER_SETTINGS));
  const epubInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(loaded);

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

  const installBook = (next: LoadedBook): void => {
    setLoaded((current) => {
      current?.dispose();
      return next;
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleImportResult = (file: File, result: EpubImportResult): void => {
    if (result.outcome === "imported") {
      installBook(result.loaded);
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
      handleImportResult(file, await importEpubFile(file, resolution));
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
            settings={settings}
            onSaveSettings={saveSettings}
          />
        : (
          <main className="welcome-screen">
            <div className="welcome-card">
              <h1>Airnobe</h1>
              <div className="welcome-actions">
                <button className="primary-action" type="button" onClick={openEpubPicker}>打开 EPUB</button>
                <button className="secondary-action" type="button" onClick={() => directoryInputRef.current?.click()}>打开转换结果</button>
              </div>
              <div className="shortcut-preview">
                <span><kbd>Q</kbd> 日文</span>
                <span><kbd>E</kbd> 注音</span>
                <span><kbd>W</kbd><kbd>S</kbd> 段落</span>
                <span><kbd>R</kbd><kbd>F</kbd> 顶部段落</span>
                <span><kbd>A</kbd><kbd>D</kbd> 翻页</span>
              </div>
            </div>
          </main>
        )}
      {loading && <div className="loading-overlay" role="status"><span className="loading-dot" />{loading}</div>}
      {duplicatePrompt && (
        <div className="reader-menu-backdrop">
          <div className="duplicate-dialog" role="dialog" aria-modal="true" aria-label="重复书籍">
            <strong>{duplicatePrompt.kind === "exact" ? "这本书已在书库中" : "可能是同一本书的新版本"}</strong>
            {duplicatePrompt.kind === "possible" && duplicatePrompt.candidates.length > 1
              ? (
                <select
                  aria-label="要替换的书籍"
                  value={selectedDuplicateId}
                  onChange={(event) => setSelectedDuplicateId(event.target.value)}
                >
                  {duplicatePrompt.candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                  ))}
                </select>
              )
              : <span>{duplicatePrompt.candidates[0]?.title || "未命名书籍"}</span>}
            <div className="duplicate-dialog-actions">
              {duplicatePrompt.kind === "exact"
                ? <button autoFocus type="button" className="primary-action" onClick={() => {
                    const id = duplicatePrompt.candidates[0]?.id;
                    setDuplicatePrompt(undefined);
                    if (!id) return;
                    setLoading("正在打开…");
                    void loadBookFromApi(id)
                      .then(installBook)
                      .catch((loadError) => setError((loadError as Error).message))
                      .finally(() => setLoading(undefined));
                  }}>打开已有书</button>
                : (
                  <>
                    <button autoFocus type="button" className="primary-action" onClick={() => {
                      const prompt = duplicatePrompt;
                      const bookId = selectedDuplicateId;
                      setDuplicatePrompt(undefined);
                      if (bookId) void submitEpub(prompt.file, { action: "replace", bookId });
                    }}>替换</button>
                    <button type="button" className="secondary-action" onClick={() => {
                      const file = duplicatePrompt.file;
                      setDuplicatePrompt(undefined);
                      void submitEpub(file, { action: "add" });
                    }}>另存为新书</button>
                  </>
                )}
              <button type="button" className="secondary-action" onClick={() => setDuplicatePrompt(undefined)}>取消</button>
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div className="notice-toast" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(undefined)} aria-label="关闭提示">×</button>
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <strong>无法打开</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(undefined)} aria-label="关闭错误">×</button>
        </div>
      )}
    </>
  );
}
