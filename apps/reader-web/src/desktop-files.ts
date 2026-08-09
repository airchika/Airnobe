import { apiFetch } from "./api-transport.js";
import type { LibraryBook } from "./library-client.js";

export interface DesktopDropHandlers {
  onActive(active: boolean): void;
  onFiles(files: File[], invalidCount: number): void;
  onError(message: string): void;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "book.epub";
}

function exportFileName(sourceFileName: string): string {
  const name = fileName(sourceFileName).trim() || "book.epub";
  return name.toLowerCase().endsWith(".epub") ? name : `${name}.epub`;
}

async function fetchSourceEpub(bookId: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await apiFetch(`/api/books/${encodeURIComponent(bookId)}/source`);
  if (!response.ok) {
    let message = `无法读取原始 EPUB（${response.status}）。`;
    try {
      const value = await response.json() as { error?: unknown };
      if (typeof value.error === "string" && value.error) message = value.error;
    } catch {
      // Keep the status-based fallback when the service did not return JSON.
    }
    throw new Error(message);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("原始 EPUB 文件为空。");
  return bytes;
}

export type ExportEpubOutcome = "saved" | "started" | "cancelled";

export async function exportOriginalEpub(
  book: Pick<LibraryBook, "id" | "sourceFileName">,
): Promise<ExportEpubOutcome> {
  const name = exportFileName(book.sourceFileName);
  if (isTauriRuntime()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      title: "导出原始 EPUB",
      defaultPath: name,
      filters: [{ name: "EPUB", extensions: ["epub"] }],
    });
    if (path === null) return "cancelled";
    const bytes = await fetchSourceEpub(book.id);
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, bytes);
    return "saved";
  }

  const bytes = await fetchSourceEpub(book.id);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/epub+zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  return "started";
}

async function readDesktopFiles(paths: string[]): Promise<{ files: File[]; invalidCount: number }> {
  const epubPaths = paths.filter((path) => path.toLowerCase().endsWith(".epub"));
  if (epubPaths.length === 0) return { files: [], invalidCount: paths.length };
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const files: File[] = [];
  for (const path of epubPaths) {
    const bytes = await readFile(path);
    files.push(new File([bytes], fileName(path), { type: "application/epub+zip" }));
  }
  return { files, invalidCount: paths.length - epubPaths.length };
}

export async function chooseDesktopEpubFiles(): Promise<File[] | undefined> {
  if (!isTauriRuntime()) return undefined;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selection = await open({
    multiple: true,
    directory: false,
    title: "导入 EPUB",
    filters: [{ name: "EPUB", extensions: ["epub"] }],
  });
  const paths = selection === null ? [] : Array.isArray(selection) ? selection : [selection];
  return (await readDesktopFiles(paths)).files;
}

export async function listenForDesktopEpubDrop(handlers: DesktopDropHandlers): Promise<(() => void) | undefined> {
  if (!isTauriRuntime()) return undefined;
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "over") {
      handlers.onActive(true);
      return;
    }
    if (event.payload.type === "leave") {
      handlers.onActive(false);
      return;
    }
    handlers.onActive(false);
    void readDesktopFiles(event.payload.paths)
      .then(({ files, invalidCount }) => handlers.onFiles(files, invalidCount))
      .catch((error) => handlers.onError((error as Error).message));
  });
}
