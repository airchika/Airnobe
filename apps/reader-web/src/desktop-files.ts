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
