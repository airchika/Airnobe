import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeEditor } from "./ThemeEditor.js";
import { applyTheme, BUILTIN_THEMES } from "./themes.js";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const base = BUILTIN_THEMES[0]!;
describe("ThemeEditor", () => {
  it("previews color changes and restores the original theme on dismissal", () => {
    applyTheme(base);
    const view = render(<ThemeEditor base={base} onSave={async () => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("页面背景"), { target: { value: "#123456" } });
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#123456");
    view.unmount();
    expect(document.documentElement.style.getPropertyValue("--background")).toBe(base.colors.background);
  });
  it("saves a new theme without overwriting the source and retains its colors", async () => {
    const save = vi.fn(async () => {}); const close = vi.fn();
    const view = render(<ThemeEditor base={base} onSave={save} onClose={close} />);
    fireEvent.change(screen.getByLabelText("主题名称"), { target: { value: "我的主题" } });
    fireEvent.change(screen.getByLabelText("强调颜色"), { target: { value: "#abcdef" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: expect.stringMatching(/^custom-/), name: "我的主题", colors: expect.objectContaining({ accent: "#abcdef" }) }));
    view.unmount();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#abcdef");
  });
  it("exports a reusable JSON theme without saving or closing the draft", async () => {
    const save = vi.fn(async () => {}); const close = vi.fn();
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:theme-export");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ThemeEditor base={base} onSave={save} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "导出 JSON" }));
    expect(click).toHaveBeenCalledOnce();
    const blob = createUrl.mock.calls[0]![0] as Blob;
    const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(JSON.parse(text)).toEqual(expect.objectContaining({ version: 4, id: expect.stringMatching(/^custom-/), colors: base.colors }));
    expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  });
  it("imports into a draft and confirms custom theme deletion", async () => {
    const custom = { ...base, id: "custom-saved", name: "已保存主题" };
    const remove = vi.fn(async () => base);
    const save = vi.fn(async () => {});
    render(<ThemeEditor base={base} themes={[{ theme: base, builtin: true }, { theme: custom, builtin: false }]} onReadClipboard={async () => ({ ...custom, colors: { ...base.colors, accent: "#123456" } })} onDelete={remove} onSave={save} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "从剪贴板导入主题" }));
    await waitFor(() => expect(screen.getByLabelText("主题名称")).toHaveValue(custom.name));
    expect(save).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#123456");
    expect(screen.queryByRole("button", { name: `删除主题：${base.name}` })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除主题：已保存主题" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(custom.id));
  });
  it("keeps the editor open on a failed save", async () => {
    const close = vi.fn();
    render(<ThemeEditor base={base} onSave={async () => { throw new Error("保存失败"); }} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
    expect(close).not.toHaveBeenCalled();
  });
});
