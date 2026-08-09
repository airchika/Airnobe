export interface AppState {
  version: 1;
  lastReadingBookId: string | null;
}

export const EMPTY_APP_STATE: AppState = { version: 1, lastReadingBookId: null };
const BOOK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAppState(value: unknown): AppState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "version" && key !== "lastReadingBookId")) return undefined;
  if (record.version !== 1) return undefined;
  if (record.lastReadingBookId !== null && (typeof record.lastReadingBookId !== "string" || !BOOK_ID_PATTERN.test(record.lastReadingBookId))) return undefined;
  return { version: 1, lastReadingBookId: record.lastReadingBookId as string | null };
}

async function appStateResponse(response: Response): Promise<AppState> {
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error("应用状态服务返回了无效响应。"); }
  if (!response.ok) {
    const message = typeof value === "object" && value !== null && "error" in value
      ? String((value as { error: unknown }).error)
      : `应用状态请求失败（${response.status}）。`;
    throw new Error(message);
  }
  const state = parseAppState(value);
  if (!state) throw new Error("应用状态服务返回了无效状态。");
  return state;
}

export async function loadAppState(): Promise<AppState> {
  return appStateResponse(await fetch("/api/app-state"));
}

export async function saveAppState(lastReadingBookId: string | null): Promise<AppState> {
  return appStateResponse(await fetch("/api/app-state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, lastReadingBookId }),
  }));
}
