import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullscreenState, setFullscreenState, toggleFullscreenState, watchFullscreenState } from "./fullscreen.js";

const mocks = vi.hoisted(() => ({
  isFullscreen: vi.fn(),
  setFullscreen: vi.fn(),
  onResized: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mocks,
}));

describe("fullscreen integration", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    mocks.isFullscreen.mockReset();
    mocks.setFullscreen.mockReset();
    mocks.onResized.mockReset();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(document, "exitFullscreen");
  });

  it("uses the browser Fullscreen API and reports changes", async () => {
    const requestFullscreen = vi.fn(async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.documentElement });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exitFullscreen = vi.fn(async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
    const onChange = vi.fn();
    const stop = await watchFullscreenState(onChange);

    await expect(setFullscreenState(true)).resolves.toBe(true);
    await expect(toggleFullscreenState()).resolves.toBe(false);
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onChange).toHaveBeenLastCalledWith(false);
    stop();
  });

  it("uses the native Tauri window and watches resize state", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    let fullscreen = false;
    let resize: (() => void) | undefined;
    const unlisten = vi.fn();
    mocks.isFullscreen.mockImplementation(async () => fullscreen);
    mocks.setFullscreen.mockImplementation(async (next: boolean) => { fullscreen = next; });
    mocks.onResized.mockImplementation(async (handler: () => void) => { resize = handler; return unlisten; });
    const onChange = vi.fn();
    const stop = await watchFullscreenState(onChange);

    await expect(fullscreenState()).resolves.toBe(false);
    await expect(toggleFullscreenState()).resolves.toBe(true);
    resize?.();
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith(true));
    expect(mocks.setFullscreen).toHaveBeenCalledWith(true);
    stop();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
