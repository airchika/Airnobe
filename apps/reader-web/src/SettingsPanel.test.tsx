import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseThemeClipboard, SettingsPanel } from "./SettingsPanel.js";
import { DEFAULT_READER_SETTINGS } from "./reader-settings.js";
import { builtinThemeOptions } from "./theme-client.js";
afterEach(cleanup);
const props = { settings: DEFAULT_READER_SETTINGS, themes: builtinThemeOptions(), onSave: async () => {}, onImport: async () => { throw new Error("unused"); }, onThemesChange: () => {}, onClose: () => {} };
describe("SettingsPanel", () => {
  it("previews reader typography and global display state", () => { const preview = vi.fn(); render(<SettingsPanel {...props} scope="reader" onPreview={preview} />); fireEvent.change(screen.getByLabelText("字号滑块"), { target: { value: "23" } }); expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ typography: expect.objectContaining({ fontSize: 23 }) }) })); fireEvent.click(screen.getByRole("button", { name: "显示日文关" })); expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ display: expect.objectContaining({ showJapanese: true }) }) })); expect(screen.getByLabelText("注音字号")).toHaveAttribute("min", "0.45"); });
  it("shows themes for the effective mode in two spatial columns", () => { render(<SettingsPanel {...props} scope="library" onPreview={() => {}} />); expect(screen.getByRole("button", { name: "系统" })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "暖纸" })).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Airnobe Night" })).toHaveAttribute("data-spatial-row", "2"); expect(screen.getByRole("button", { name: "Absolutely" })).toHaveAttribute("data-spatial-row", "2"); expect(screen.getByRole("button", { name: "One Dark" })).toHaveAttribute("data-spatial-row", "3"); fireEvent.click(screen.getByRole("button", { name: "浅色" })); expect(screen.getByRole("button", { name: "暖纸" })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Airnobe Night" })).not.toBeInTheDocument(); expect(screen.queryByLabelText("字号")).not.toBeInTheDocument(); });
  it("supports bold weight, Chinese opacity and limits navigation steps to ten", () => { const preview = vi.fn(); render(<SettingsPanel {...props} scope="reader" onPreview={preview} />); fireEvent.click(screen.getByRole("button", { name: "粗体" })); expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ typography: expect.objectContaining({ fontWeight: 800 }) }) })); expect(screen.getByRole("spinbutton", { name: "中文透明度" })).toHaveAttribute("min", "0.2"); expect(screen.getByRole("spinbutton", { name: "滚动段数" })).toHaveAttribute("max", "10"); fireEvent.change(screen.getByLabelText("滚动段数滑块"), { target: { value: "7" } }); expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ navigation: { textSteps: 7 } })); expect(screen.queryByRole("button", { name: /显示滚动条/ })).not.toBeInTheDocument(); });
  it("parses raw or fenced v4 themes from the clipboard", () => { const raw = JSON.stringify(builtinThemeOptions()[0]!.theme); expect(parseThemeClipboard(raw).version).toBe(4); expect(parseThemeClipboard(`\`\`\`json\n${raw}\n\`\`\``).id).toBe(builtinThemeOptions()[0]!.theme.id); expect(() => parseThemeClipboard("not json")).toThrow(/有效/); });
  it("commits number edits with Enter and restores them with Escape", async () => { const preview = vi.fn(); const save = vi.fn(async () => {}); render(<SettingsPanel {...props} scope="reader" onPreview={preview} onSave={save} />); const input = screen.getByRole("spinbutton", { name: "字号" }); fireEvent.focus(input); fireEvent.change(input, { target: { value: "25" } }); fireEvent.keyDown(input, { key: "Escape", code: "Escape" }); expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ typography: expect.objectContaining({ fontSize: 19 }) }) })); fireEvent.focus(input); fireEvent.change(input, { target: { value: "24" } }); fireEvent.keyDown(input, { key: "Enter", code: "Enter" }); expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ typography: expect.objectContaining({ fontSize: 24 }) }) })); });
  it("shows the prompt-copy and clipboard-import theme actions", () => { render(<SettingsPanel {...props} scope="library" onPreview={() => {}} />); expect(screen.getByRole("button", { name: "复制导入主题提示词" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "从剪贴板导入主题" })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "导入主题 JSON" })).not.toBeInTheDocument(); });
  it("edits the shared library/reader switch shortcut from library settings", async () => {
    const preview = vi.fn();
    const save = vi.fn(async () => {});
    render(<SettingsPanel {...props} scope="library" onPreview={preview} onSave={save} />);
    fireEvent.click(screen.getByRole("button", { name: "修改切换书库/阅读界面快捷键" }));
    fireEvent.keyDown(window, { key: "v", code: "KeyV" });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shortcuts: expect.objectContaining({ returnLibrary: { code: "KeyV" } }) }));
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ shortcuts: expect.objectContaining({ returnLibrary: { code: "KeyV" } }) }));
  });
  it("edits the shared fullscreen shortcut from library settings", () => {
    const preview = vi.fn();
    const save = vi.fn(async () => {});
    render(<SettingsPanel {...props} scope="library" onPreview={preview} onSave={save} />);
    fireEvent.click(screen.getByRole("button", { name: "修改全屏快捷键" }));
    fireEvent.keyDown(window, { key: "g", code: "KeyG" });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shortcuts: expect.objectContaining({ toggleFullscreen: { code: "KeyG" } }) }));
  });
  it("swaps and deletes bindings from library settings", () => {
    const save = vi.fn(async () => {});
    render(<SettingsPanel {...props} scope="library" onPreview={() => {}} onSave={save} />);
    fireEvent.click(screen.getByRole("button", { name: "修改全屏快捷键" }));
    fireEvent.keyDown(window, { key: "e", code: "KeyE" });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shortcuts: expect.objectContaining({ toggleFullscreen: { code: "KeyE" }, returnLibrary: { code: "KeyF" } }) }));
    fireEvent.click(screen.getByRole("button", { name: "修改全屏快捷键" }));
    fireEvent.keyDown(window, { key: "Backspace", code: "Backspace" });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shortcuts: expect.objectContaining({ toggleFullscreen: null }) }));
    expect(screen.getByRole("button", { name: "设置全屏快捷键，当前未设置" })).toBeInTheDocument();
  });
  it("rolls back all shortcut changes when saving fails", async () => {
    render(<SettingsPanel {...props} scope="library" onPreview={() => {}} onSave={async () => { throw new Error("failed"); }} />);
    fireEvent.click(screen.getByRole("button", { name: "修改全屏快捷键" }));
    fireEvent.keyDown(window, { key: "e", code: "KeyE" });
    await waitFor(() => expect(screen.getByRole("button", { name: "修改全屏快捷键" })).toHaveTextContent("F"));
    expect(screen.getByRole("button", { name: "修改切换书库/阅读界面快捷键" })).toHaveTextContent("E");
  });
});
