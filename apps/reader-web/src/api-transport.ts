export interface DesktopBackendConnection {
  baseUrl: string | null;
  token: string | null;
}

let connection: DesktopBackendConnection = { baseUrl: null, token: null };

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function initializeApiTransport(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const value = await invoke<DesktopBackendConnection>("desktop_backend_connection");
  if (value.baseUrl !== null && !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.baseUrl)) {
    throw new Error("桌面本地服务返回了无效地址。");
  }
  connection = value;
}

export function apiUrl(path: string): string {
  const target = connection.baseUrl ? `${connection.baseUrl}${path}` : path;
  if (!connection.token) return target;
  const url = new URL(target, window.location.href);
  url.searchParams.set("token", connection.token);
  return url.toString();
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!connection.token) return init === undefined ? fetch(path) : fetch(path, init);
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${connection.token}`);
  return fetch(connection.baseUrl ? `${connection.baseUrl}${path}` : path, { ...init, headers });
}
