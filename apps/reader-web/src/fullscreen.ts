export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function fullscreenState(): Promise<boolean> {
  if (isTauriRuntime()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().isFullscreen();
  }
  return Boolean(document.fullscreenElement);
}

export async function setFullscreenState(fullscreen: boolean): Promise<boolean> {
  if (isTauriRuntime()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const currentWindow = getCurrentWindow();
    await currentWindow.setFullscreen(fullscreen);
    return currentWindow.isFullscreen();
  }
  if (fullscreen) {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
  return Boolean(document.fullscreenElement);
}

export async function toggleFullscreenState(): Promise<boolean> {
  return setFullscreenState(!(await fullscreenState()));
}

export async function watchFullscreenState(onChange: (fullscreen: boolean) => void): Promise<() => void> {
  if (isTauriRuntime()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const currentWindow = getCurrentWindow();
    const update = (): void => { void currentWindow.isFullscreen().then(onChange).catch(() => {}); };
    update();
    return currentWindow.onResized(update);
  }
  const update = (): void => onChange(Boolean(document.fullscreenElement));
  document.addEventListener("fullscreenchange", update);
  update();
  return () => document.removeEventListener("fullscreenchange", update);
}
