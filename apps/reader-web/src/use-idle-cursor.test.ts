import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdleCursor } from "./use-idle-cursor.js";

describe("useIdleCursor", () => {
  const hidden = () => document.documentElement.classList.contains("cursor-idle");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hides after three seconds, preserves keyboard reading, and restores on mouse input", () => {
    renderHook(useIdleCursor);
    vi.advanceTimersByTime(2_999);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(hidden()).toBe(true);
    fireEvent.mouseMove(document);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(hidden()).toBe(true);
    fireEvent.mouseDown(document);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(hidden()).toBe(false);
    fireEvent.mouseUp(document);
    vi.advanceTimersByTime(3_000);
    expect(hidden()).toBe(true);
  });

  it("cancels hiding outside the window or page and cleans up on unmount", () => {
    const { unmount } = renderHook(useIdleCursor);
    vi.advanceTimersByTime(3_000);
    fireEvent.blur(window);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(hidden()).toBe(false);
    fireEvent.focus(window);
    vi.advanceTimersByTime(3_000);
    expect(hidden()).toBe(true);
    fireEvent.mouseLeave(document.documentElement);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(hidden()).toBe(false);
    fireEvent.mouseEnter(document.documentElement);
    vi.advanceTimersByTime(3_000);
    expect(hidden()).toBe(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(hidden()).toBe(false);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.mouseMove(document);
    expect(vi.getTimerCount()).toBe(0);
  });
});
