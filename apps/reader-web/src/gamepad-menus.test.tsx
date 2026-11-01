import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookReader } from "./BookReader.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { DEFAULT_READER_SETTINGS } from "./reader-settings.js";
import { builtinThemeOptions } from "./theme-client.js";
import { createDemoBook } from "./demo-book.js";

describe("gamepad menus", () => {
  let buttons: GamepadButton[];
  const tick = () => act(() => { vi.advanceTimersByTime(100); });
  const press = (index: number) => {
    buttons[index] = { pressed: true, touched: true, value: 1 }; tick();
    buttons[index] = { pressed: false, touched: false, value: 0 }; tick();
  };
  beforeEach(() => {
    vi.useFakeTimers();
    buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { getGamepads: () => [{ index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons }] }));
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("opens with Y, moves focus, activates controls and closes without leaking input into reading", () => {
    const loaded = createDemoBook();
    const scroll = vi.spyOn(window, "scrollBy");
    render(<BookReader loaded={loaded} onChooseBook={() => {}} onReturnToLibrary={() => {}} settings={DEFAULT_READER_SETTINGS} onSaveSettings={async () => {}} />);
    tick(); press(3);
    const close = screen.getByRole("button", { name: "关闭侧边栏" });
    act(() => close.focus());
    press(13);
    expect(close).not.toHaveFocus();
    expect(document.activeElement).toHaveAttribute("data-spatial-item");
    scroll.mockClear();
    press(1);
    expect(screen.queryByRole("button", { name: "关闭侧边栏" })).not.toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
    press(3);
    act(() => screen.getByRole("button", { name: "关闭侧边栏" }).focus());
    press(0);
    expect(screen.queryByRole("button", { name: "关闭侧边栏" })).not.toBeInTheDocument();
    press(3); press(3);
    expect(screen.queryByRole("button", { name: "关闭侧边栏" })).not.toBeInTheDocument();
    loaded.dispose();
  });

  it("adjusts and saves numbers and selects without typing, then exits settings with B", async () => {
    const save = vi.fn(async () => {});
    const close = vi.fn();
    render(<SettingsPanel settings={DEFAULT_READER_SETTINGS} themes={builtinThemeOptions()} onPreview={() => {}} onSave={save} onImport={async () => { throw new Error("unused"); }} onThemesChange={() => {}} onClose={close} />);
    tick();
    const entry = screen.getByRole("spinbutton", { name: "滚动段数" }).parentElement!;
    act(() => entry.focus());
    press(0); press(15);
    expect(screen.getByRole("spinbutton", { name: "滚动段数" })).toHaveValue(DEFAULT_READER_SETTINGS.navigation.textSteps + 1);
    act(() => { vi.advanceTimersByTime(400); });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ navigation: { textSteps: DEFAULT_READER_SETTINGS.navigation.textSteps + 1 } }));
    press(1);
    expect(close).not.toHaveBeenCalled();
    expect(entry).not.toHaveAttribute("data-gamepad-editing");
    const font = screen.getByRole("combobox", { name: "中文字体" });
    act(() => font.focus());
    const before = (font as HTMLSelectElement).value;
    press(0); press(15); press(0);
    expect((font as HTMLSelectElement).value).not.toBe(before);
    press(13);
    expect(font).not.toHaveFocus();
    press(1);
    await act(async () => { await Promise.resolve(); });
    expect(close).toHaveBeenCalledOnce();
  });
});
