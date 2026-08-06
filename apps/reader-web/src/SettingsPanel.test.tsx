import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel.js";
import { DEFAULT_READER_SETTINGS } from "./reader-settings.js";
import { builtinThemeOptions } from "./theme-client.js";

afterEach(cleanup);

describe("SettingsPanel", () => {
  it("previews typography and display defaults immediately", () => {
    const preview = vi.fn();
    render(<SettingsPanel
      settings={DEFAULT_READER_SETTINGS}
      themes={builtinThemeOptions()}
      onPreview={preview}
      onSave={() => Promise.resolve()}
      onImport={() => Promise.reject(new Error("unused"))}
      onThemesChange={() => {}}
      onClose={() => {}}
    />);
    fireEvent.change(screen.getByLabelText("字号滑块"), { target: { value: "23" } });
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ typography: expect.objectContaining({ fontSize: 23 }) }) }));
    fireEvent.change(screen.getByLabelText("段内间距滑块"), { target: { value: "1.4" } });
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ typography: expect.objectContaining({ lineHeight: 1.4 }) }) }));
    fireEvent.change(screen.getByLabelText("段落间距滑块"), { target: { value: "2" } });
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ typography: expect.objectContaining({ paragraphSpacing: 2 }) }) }));
    expect(screen.getByLabelText("段内间距").parentElement).toHaveTextContent("倍");
    expect(screen.getByLabelText("段落间距").parentElement).toHaveTextContent("em");
    fireEvent.click(screen.getByRole("button", { name: /显示日文/ }));
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ defaults: expect.objectContaining({ showJapanese: true }) }) }));
  });

  it("offers all built-in themes and protects unrelated settings on reset", () => {
    const preview = vi.fn();
    render(<SettingsPanel
      settings={{ ...DEFAULT_READER_SETTINGS, navigation: { textSteps: 8 }, pageTransitions: true }}
      themes={builtinThemeOptions()}
      onPreview={preview}
      onSave={() => Promise.resolve()}
      onImport={() => Promise.reject(new Error("unused"))}
      onThemesChange={() => {}}
      onClose={() => {}}
    />);
    expect(screen.getByRole("button", { name: "暖纸" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复阅读外观默认值" }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ navigation: { textSteps: 8 }, pageTransitions: true }));
  });
});
