export interface DesktopSettings {
  version: 1;
  toggleWindowShortcut: string | null;
  autostart: boolean;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeDesktopSettings(command: string, args?: Record<string, unknown>): Promise<DesktopSettings> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopSettings>(command, args);
}

export async function loadDesktopSettings(): Promise<DesktopSettings | undefined> {
  if (!isTauriRuntime()) return undefined;
  return invokeDesktopSettings("desktop_settings");
}

export function saveDesktopShortcut(shortcut: string | null): Promise<DesktopSettings> {
  return invokeDesktopSettings("set_desktop_shortcut", { shortcut });
}

export function saveDesktopAutostart(enabled: boolean): Promise<DesktopSettings> {
  return invokeDesktopSettings("set_desktop_autostart", { enabled });
}

export function desktopShortcutFromEvent(event: KeyboardEvent): string | undefined {
  if (event.metaKey || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) return undefined;
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
  else key = ({
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Space: "Space",
  } as Record<string, string>)[event.code];
  if (!key) return undefined;
  return [event.ctrlKey ? "Ctrl" : undefined, event.altKey ? "Alt" : undefined, event.shiftKey ? "Shift" : undefined, key].filter(Boolean).join("+");
}

