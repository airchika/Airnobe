import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { applyTheme, parseThemeDefinition, THEME_COLOR_KEYS, type ThemeDefinition } from "./themes.js";
import { useSpatialNavigation } from "./spatial-navigation.js";
import type { AvailableTheme } from "./theme-client.js";
import { isTauriRuntime } from "./fullscreen.js";

const labels = { background: "页面背景", surface: "面板背景", sidebar: "侧栏背景", text: "文字颜色", accent: "强调颜色" };
export function ThemeEditor({ base, themes = [], onReadClipboard, onDelete, onSave, onClose }: { base: ThemeDefinition; themes?: AvailableTheme[]; onReadClipboard?(): Promise<ThemeDefinition>; onDelete?(id: string): Promise<ThemeDefinition>; onSave(theme: ThemeDefinition): Promise<void>; onClose(): void }) {
  const [draft, setDraft] = useState<ThemeDefinition>(() => ({ ...structuredClone(base), id: `custom-${crypto.randomUUID()}`, name: `${base.name} 自定义`.slice(0, 60) }));
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const committed = useRef(false);
  const original = useRef(base);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => { applyTheme(draft); }, [draft]);
  useEffect(() => { rootRef.current?.querySelector<HTMLElement>("button")?.focus(); return () => { if (!committed.current) applyTheme(original.current); requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true })); }; }, []);
  const close = () => { if (!busy) onClose(); };
  useSpatialNavigation({ rootRef, enabled: !busy, keys: "both", onCancel: () => { close(); return true; } });
  const importClipboard = async () => {
    if (!onReadClipboard) return;
    setBusy(true); setError(undefined);
    try { const theme = await onReadClipboard(); setDraft({ ...theme, id: draft.id }); }
    catch (cause) { setError(`无法导入：${(cause as Error).message}`); } finally { setBusy(false); }
  };
  const removeTheme = async (id: string) => {
    if (!onDelete) return;
    setBusy(true); setError(undefined);
    try { const fallback = await onDelete(id); if (original.current.id === id) original.current = fallback; setDeleting(undefined); applyTheme(draft); }
    catch (cause) { setError(`无法删除：${(cause as Error).message}`); } finally { setBusy(false); }
  };
  const validated = () => { const theme = parseThemeDefinition(draft); if (!theme) throw new Error("请输入 1–60 字的主题名称和有效颜色。"); return theme; };
  const save = async () => {
    setBusy(true); setError(undefined);
    try { const theme = validated(); await onSave(theme); committed.current = true; applyTheme(theme); onClose(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const exportTheme = async () => {
    setBusy(true); setError(undefined);
    try {
      const theme = validated(); const text = JSON.stringify(theme, null, 2);
      if (isTauriRuntime()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({ defaultPath: `${theme.id}.json`, filters: [{ name: "主题 JSON", extensions: ["json"] }] });
        if (!path) return;
        const { writeTextFile } = await import("@tauri-apps/plugin-fs"); await writeTextFile(path, text);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = `${theme.id}.json`; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  return createPortal(<div className="theme-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="theme-editor settings-panel" ref={rootRef} role="dialog" aria-modal="true" aria-label="自定义主题" onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); close(); }
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><h2>自定义主题</h2><button type="button" data-spatial-item data-spatial-row="0" disabled={busy} onClick={close} aria-label="关闭自定义主题">×</button></header>
      <p>基于“{base.name}”创建新主题。调色即时预览，关闭则恢复原主题。</p>
      {onReadClipboard && <button type="button" data-spatial-item data-spatial-row="0" disabled={busy} onClick={() => void importClipboard()}>从剪贴板导入主题</button>}
      <label>主题名称<input aria-label="主题名称" maxLength={60} value={draft.name} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>主题类型<select aria-label="主题类型" data-spatial-item data-spatial-row="1" value={draft.variant} disabled={busy} onChange={(event) => setDraft({ ...draft, variant: event.target.value as "light" | "dark" })}><option value="light">浅色</option><option value="dark">深色</option></select></label>
      {THEME_COLOR_KEYS.map((key, index) => <label className="theme-color-field" key={key}><span>{labels[key]}</span><input type="color" aria-label={labels[key]} data-spatial-item data-spatial-row={String(index + 2)} disabled={busy} value={draft.colors[key].slice(0, 7)} onChange={(event) => setDraft({ ...draft, colors: { ...draft.colors, [key]: event.target.value } })} /><code>{draft.colors[key]}</code></label>)}
      <p>边框、次要文字和按钮颜色由以上颜色自动生成。</p>
      {error && <p role="alert">{error}</p>}
      <div className="theme-editor-actions"><button type="button" data-spatial-item data-spatial-row="8" disabled={busy} onClick={() => setDraft({ ...draft, colors: { ...base.colors }, variant: base.variant })}>重置颜色</button><button type="button" data-spatial-item data-spatial-row="9" disabled={busy} onClick={() => void exportTheme()}>导出 JSON</button><button type="button" className="theme-editor-save" data-spatial-item data-spatial-row="9" disabled={busy} onClick={() => void save()}>保存并应用</button><button type="button" data-spatial-item data-spatial-row="10" disabled={busy} onClick={close}>取消</button></div>
      {onDelete && <section className="theme-saved-list"><h3>已保存的自定义主题</h3>{themes.filter((item) => !item.builtin).length === 0 && <p>暂无自定义主题</p>}{themes.filter((item) => !item.builtin).map(({ theme }, index) => <div key={theme.id} className="theme-saved-row"><span>{theme.name}</span>{deleting === theme.id ? <><button type="button" data-spatial-item data-spatial-row={String(12 + index)} disabled={busy} onClick={() => void removeTheme(theme.id)}>确认删除</button><button type="button" data-spatial-item data-spatial-row={String(12 + index)} disabled={busy} onClick={() => setDeleting(undefined)}>取消删除</button></> : <button type="button" data-spatial-item data-spatial-row={String(12 + index)} disabled={busy} aria-label={`删除主题：${theme.name}`} onClick={() => setDeleting(theme.id)}>删除</button>}</div>)}</section>}
    </div>
  </div>, document.body);
}
