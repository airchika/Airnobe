import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { BookReader } from "./BookReader.js";
import { importEpubFile, loadBookFromFiles, type LoadedBook } from "./book-source.js";
import { createDemoBook } from "./demo-book.js";

export function App() {
  const initialDemo = new URLSearchParams(window.location.search).get("demo") === "1";
  const [loaded, setLoaded] = useState<LoadedBook | undefined>(() => initialDemo ? createDemoBook() : undefined);
  const [loading, setLoading] = useState<string>();
  const [error, setError] = useState<string>();
  const epubInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(loaded);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => () => loadedRef.current?.dispose(), []);

  const openEpubPicker = (): void => epubInputRef.current?.click();

  const installBook = (next: LoadedBook): void => {
    setLoaded((current) => {
      current?.dispose();
      return next;
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const onEpubSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setLoading("正在转换 EPUB…");
    setError(undefined);
    try {
      installBook(await importEpubFile(file));
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(undefined);
    }
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
        ? <BookReader key={loaded.book.id} loaded={loaded} onChooseBook={openEpubPicker} />
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
                <span><kbd>A</kbd><kbd>D</kbd> 翻页</span>
              </div>
            </div>
          </main>
        )}
      {loading && <div className="loading-overlay" role="status"><span className="loading-dot" />{loading}</div>}
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
