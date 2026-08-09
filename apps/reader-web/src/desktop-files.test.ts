import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseDesktopEpubFiles, exportOriginalEpub, listenForDesktopEpubDrop } from "./desktop-files.js";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  onDragDropEvent: vi.fn(),
  apiFetch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: mocks.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: mocks.onDragDropEvent }),
}));
vi.mock("./api-transport.js", () => ({ apiFetch: mocks.apiFetch }));

function enableTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
}

describe("desktop file integration", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    mocks.open.mockReset();
    mocks.save.mockReset();
    mocks.readFile.mockReset();
    mocks.writeFile.mockReset();
    mocks.onDragDropEvent.mockReset();
    mocks.apiFetch.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("leaves the browser file input in charge outside Tauri", async () => {
    await expect(chooseDesktopEpubFiles()).resolves.toBeUndefined();
    await expect(listenForDesktopEpubDrop({ onActive: vi.fn(), onFiles: vi.fn(), onError: vi.fn() })).resolves.toBeUndefined();
  });

  it("reads every EPUB selected by the native multi-file dialog", async () => {
    enableTauri();
    mocks.open.mockResolvedValue(["C:\\Books\\one.epub", "D:\\two.epub"]);
    mocks.readFile.mockResolvedValueOnce(new Uint8Array([1])).mockResolvedValueOnce(new Uint8Array([2]));

    const files = await chooseDesktopEpubFiles();

    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ multiple: true, directory: false }));
    expect(mocks.readFile).toHaveBeenCalledTimes(2);
    expect(files?.map((file) => file.name)).toEqual(["one.epub", "two.epub"]);
  });

  it("saves the original EPUB bytes through the native save dialog", async () => {
    enableTauri();
    mocks.save.mockResolvedValue("D:\\Exports\\书 名.epub");
    mocks.apiFetch.mockResolvedValue(new Response(new Uint8Array([0x50, 0x4b, 3, 4])));

    await expect(exportOriginalEpub({
      id: "01234567-89ab-4cde-8fab-0123456789ab",
      sourceFileName: "书 名.epub",
    })).resolves.toBe("saved");

    expect(mocks.save).toHaveBeenCalledWith({
      title: "导出原始 EPUB",
      defaultPath: "书 名.epub",
      filters: [{ name: "EPUB", extensions: ["epub"] }],
    });
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/books/01234567-89ab-4cde-8fab-0123456789ab/source");
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "D:\\Exports\\书 名.epub",
      new Uint8Array([0x50, 0x4b, 3, 4]),
    );
  });

  it("does not fetch or write when the native save dialog is cancelled", async () => {
    enableTauri();
    mocks.save.mockResolvedValue(null);

    await expect(exportOriginalEpub({ id: "book-id", sourceFileName: "book.epub" })).resolves.toBe("cancelled");
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("uses a temporary Blob download in the browser and releases its URL", async () => {
    mocks.apiFetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:airnobe-export");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await expect(exportOriginalEpub({ id: "book-id", sourceFileName: "原书" })).resolves.toBe("started");

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("原书.epub");
    expect(anchor.href).toBe("blob:airnobe-export");
    expect(anchor.isConnected).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:airnobe-export");
  });

  it("surfaces the local service error when the source EPUB cannot be read", async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: "原书文件不存在。" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }));

    await expect(exportOriginalEpub({ id: "book-id", sourceFileName: "book.epub" }))
      .rejects.toThrow("原书文件不存在。");
  });

  it("uses native window drop events and reports ignored non-EPUB paths", async () => {
    enableTauri();
    let handler: ((event: { payload: { type: string; paths?: string[] } }) => void) | undefined;
    const unlisten = vi.fn();
    mocks.onDragDropEvent.mockImplementation(async (next) => { handler = next; return unlisten; });
    mocks.readFile.mockResolvedValue(new Uint8Array([3]));
    const onActive = vi.fn();
    const onFiles = vi.fn();
    const onError = vi.fn();

    await expect(listenForDesktopEpubDrop({ onActive, onFiles, onError })).resolves.toBe(unlisten);
    handler?.({ payload: { type: "over" } });
    handler?.({ payload: { type: "drop", paths: ["C:\\one.epub", "C:\\note.txt"] } });
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalled());

    expect(onActive).toHaveBeenNthCalledWith(1, true);
    expect(onActive).toHaveBeenLastCalledWith(false);
    expect(onFiles.mock.calls[0]?.[0].map((file: File) => file.name)).toEqual(["one.epub"]);
    expect(onFiles).toHaveBeenCalledWith(expect.any(Array), 1);
    expect(onError).not.toHaveBeenCalled();
  });
});
