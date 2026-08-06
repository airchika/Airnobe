import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel.js";
import { DEFAULT_READER_SETTINGS } from "./reader-settings.js";
import { builtinThemeOptions } from "./theme-client.js";
afterEach(cleanup);
const props = { settings: DEFAULT_READER_SETTINGS, themes: builtinThemeOptions(), onSave: async () => {}, onImport: async () => { throw new Error("unused"); }, onThemesChange: () => {}, onClose: () => {} };
describe("SettingsPanel", () => {
  it("previews reader typography and global display state", () => { const preview = vi.fn(); render(<SettingsPanel {...props} scope="reader" onPreview={preview} />); fireEvent.change(screen.getByLabelText("字号滑块"), { target: { value: "23" } }); expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ typography: expect.objectContaining({ fontSize: 23 }) }) })); fireEvent.click(screen.getByRole("button", { name: "显示日文关" })); expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ display: expect.objectContaining({ showJapanese: true }) }) })); expect(screen.getByLabelText("注音字号")).toHaveAttribute("min", "0.45"); });
  it("limits library settings to day, night, system and themes", () => { render(<SettingsPanel {...props} scope="library" onPreview={() => {}} />); expect(screen.getByRole("button", { name: "跟随系统" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "暖纸" })).toBeInTheDocument(); expect(screen.queryByLabelText("字号")).not.toBeInTheDocument(); expect(screen.queryByText("恢复阅读外观默认值")).not.toBeInTheDocument(); });
});
