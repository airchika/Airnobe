import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGamepadPaging } from "./use-gamepad-paging.js";

describe("useGamepadPaging", () => {
  let pad: Gamepad;
  const tick = (ms = 50) => vi.advanceTimersByTime(ms);
  const button = (index: number, pressed: boolean) => {
    (pad.buttons as GamepadButton[])[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 };
  };
  beforeEach(() => {
    vi.useFakeTimers();
    pad = { index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })) } as unknown as Gamepad;
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { getGamepads: () => [null, pad] }));
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([[12, -1], [13, 1], [14, -1], [15, 1]])("maps D-pad button %i to page %i", (index, expected) => {
    const page = vi.fn();
    renderHook(() => useGamepadPaging(true, page));
    tick();
    button(index, true);
    tick();
    expect(page).toHaveBeenCalledExactlyOnceWith(expected);
    tick(450);
    expect(page).toHaveBeenCalledTimes(1);
    tick(50);
    expect(page).toHaveBeenCalledTimes(2);
    tick(350);
    expect(page).toHaveBeenCalledTimes(3);
    button(index, false);
    tick(1_000);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it.each([0, 1, 2, 3])("supports stick axis %i and ignores drift", (axis) => {
    const page = vi.fn();
    renderHook(() => useGamepadPaging(true, page));
    (pad.axes as number[])[axis] = 0.2;
    tick(1_000);
    expect(page).not.toHaveBeenCalled();
    (pad.axes as number[])[axis] = -0.8;
    tick();
    expect(page).toHaveBeenLastCalledWith(-1);
    (pad.axes as number[])[axis] = 0.8;
    tick();
    expect(page).toHaveBeenLastCalledWith(1);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("requires neutral after focus loss and disabling; stops after unmount", () => {
    const page = vi.fn();
    const { rerender, unmount } = renderHook(({ enabled }) => useGamepadPaging(enabled, page), { initialProps: { enabled: true } });
    tick();
    button(13, true);
    tick();
    fireEvent.blur(window);
    tick(1_000);
    expect(page).toHaveBeenCalledTimes(1);
    button(13, false);
    tick();
    button(13, true);
    tick();
    expect(page).toHaveBeenCalledTimes(2);
    rerender({ enabled: false });
    tick(1_000);
    rerender({ enabled: true });
    tick(1_000);
    expect(page).toHaveBeenCalledTimes(2);
    button(13, false);
    tick();
    button(13, true);
    tick();
    expect(page).toHaveBeenCalledTimes(3);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [0, "toggleJapanese"], [2, "toggleAssistedRuby"], [3, "toggleKatakanaRomaji"],
    [9, "toggleFullscreen"], [1, "returnLibrary"],
  ] as const)("maps button %i to %s once per press", (index, expected) => {
    const action = vi.fn();
    const page = vi.fn();
    renderHook(() => useGamepadPaging(true, page, action));
    tick();
    button(index, true);
    tick(2_000);
    expect(action).toHaveBeenCalledExactlyOnceWith(expected);
    expect(page).not.toHaveBeenCalled();
    button(index, false);
    tick();
    button(index, true);
    tick();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("requires release of action buttons after connecting or closing an overlay", () => {
    const action = vi.fn();
    button(0, true);
    const { rerender } = renderHook(({ enabled }) => useGamepadPaging(enabled, vi.fn(), action), { initialProps: { enabled: true } });
    tick(1_000);
    expect(action).not.toHaveBeenCalled();
    button(0, false);
    tick();
    button(0, true);
    tick();
    expect(action).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    tick();
    rerender({ enabled: true });
    tick(1_000);
    expect(action).toHaveBeenCalledTimes(1);
    button(0, false);
    tick();
    button(0, true);
    tick();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("prioritizes returning over simultaneous toggles and paging", () => {
    const action = vi.fn();
    const page = vi.fn();
    renderHook(() => useGamepadPaging(true, page, action));
    tick();
    button(1, true);
    button(0, true);
    button(13, true);
    tick(1_000);
    expect(action).toHaveBeenCalledExactlyOnceWith("returnLibrary");
    expect(page).not.toHaveBeenCalled();
  });

  it("ignores unmapped controllers and handles an unavailable API", () => {
    const page = vi.fn();
    Object.assign(pad, { mapping: "" });
    renderHook(() => useGamepadPaging(true, page));
    tick();
    button(13, true);
    tick(1_000);
    expect(page).not.toHaveBeenCalled();
    vi.spyOn(navigator, "getGamepads").mockImplementation(() => { throw new Error("unavailable"); });
    expect(() => tick()).not.toThrow();
  });
});
