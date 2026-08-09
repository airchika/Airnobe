import type { ShortcutAction, ShortcutBinding, ShortcutModifier } from "./reader-settings.js";

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  toggleJapanese: "切换日文",
  toggleAssistedRuby: "切换振假名",
  toggleKatakanaRomaji: "切换罗马音",
  topBackward: "从顶部回退",
  topForward: "从顶部快进",
  bottomBackward: "从底部回退",
  bottomForward: "从底部快进",
  pageUp: "向上翻页",
  pageDown: "向下翻页",
  toggleSidebar: "侧边栏",
  toggleFullscreen: "全屏",
  returnLibrary: "切换书库/阅读界面",
  addBookmark: "添加书签",
};

export function shortcutModifier(event: KeyboardEvent): ShortcutModifier | "invalid" | undefined {
  if (event.metaKey) return "invalid";
  const modifiers: ShortcutModifier[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return modifiers.length > 1 ? "invalid" : modifiers[0];
}

export function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding | null | undefined): boolean {
  if (!binding || event.code !== binding.code || event.metaKey) return false;
  return event.ctrlKey === (binding.modifier === "Control")
    && event.altKey === (binding.modifier === "Alt")
    && event.shiftKey === (binding.modifier === "Shift");
}

function shortcutCodeLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    PageUp: "PgUp",
    PageDown: "PgDn",
    Space: "Space",
  }[code] ?? code;
}

function modifierLabel(modifier: ShortcutModifier): string {
  return modifier === "Control" ? "Ctrl" : modifier;
}

interface ShortcutBindingButtonProps {
  action: ShortcutAction;
  binding: ShortcutBinding | null;
  capturing: boolean;
  onCapture(action: ShortcutAction): void;
  spatialRow: string;
  spatialZone?: string;
  spatialZoneOrder?: string;
}

export function ShortcutBindingButton({ action, binding, capturing, onCapture, spatialRow, spatialZone = "shortcut-dialog", spatialZoneOrder = "0" }: ShortcutBindingButtonProps) {
  return (
    <button
      type="button"
      className={`shortcut-binding${capturing ? " shortcut-binding--capturing" : ""}`}
      aria-label={`${binding ? "修改" : "设置"}${SHORTCUT_LABELS[action]}快捷键${binding ? "" : "，当前未设置"}`}
      aria-pressed={capturing}
      data-spatial-item
      data-spatial-zone={spatialZone}
      data-spatial-zone-order={spatialZoneOrder}
      data-spatial-row={spatialRow}
      onClick={() => onCapture(action)}
    >
      {capturing
        ? <kbd>按键…</kbd>
        : binding ? (
          <>
            {binding.modifier && <><kbd>{modifierLabel(binding.modifier)}</kbd><i>+</i></>}
            <kbd>{shortcutCodeLabel(binding.code)}</kbd>
          </>
        ) : <kbd className="shortcut-binding-empty" aria-hidden="true" />}
    </button>
  );
}
