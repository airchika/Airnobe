import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseDesktopEpubFiles, listenForDesktopEpubDrop } from "./desktop-files.js";

const mocks = vi.hoisted(() => ({ open: vi.fn(), readFile: vi.fn(), onDragDropEvent: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: mocks.readFile }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: mocks.onDragDropEvent }),
}));

function enableTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
}

describe("desktop file integration", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    mocks.open.mockReset();
    mocks.readFile.mockReset();
    mocks.onDragDropEvent.mockReset();
  });

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
