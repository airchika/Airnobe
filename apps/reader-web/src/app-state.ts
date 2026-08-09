import { apiFetch } from "./api-transport.js";

export type LibraryFilter = "all" | "wish" | "reading" | "completed" | "on-hold" | "dropped";

export interface AppState {
  version: 2;
  lastReadingBookId: string | null;
  libraryFilter: LibraryFilter;
}

export interface AppStatePatch {
  lastReadingBookId?: string | null;
  libraryFilter?: LibraryFilter;
}

export const EMPTY_APP_STATE: AppState = { version: 2, lastReadingBookId: null, libraryFilter: "all" };
const BOOK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIBRARY_FILTERS: LibraryFilter[] = ["all", "wish", "reading", "completed", "on-hold", "dropped"];

function validBookId(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && BOOK_ID_PATTERN.test(value));
}

export function parseAppState(value: unknown): AppState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version === 1) {
    if (Object.keys(record).some((key) => key !== "version" && key !== "lastReadingBookId") || !validBookId(record.lastReadingBookId)) return undefined;
    return { version: 2, lastReadingBookId: record.lastReadingBookId, libraryFilter: "all" };
  }
  if (record.version !== 2 || Object.keys(record).some((key) => !["version", "lastReadingBookId", "libraryFilter"].includes(key))) return undefined;
  if (!validBookId(record.lastReadingBookId) || !LIBRARY_FILTERS.includes(record.libraryFilter as LibraryFilter)) return undefined;
  return { version: 2, lastReadingBookId: record.lastReadingBookId, libraryFilter: record.libraryFilter as LibraryFilter };
}

export function parseAppStatePatch(value: unknown): AppStatePatch | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 || keys.some((key) => key !== "lastReadingBookId" && key !== "libraryFilter")) return undefined;
  if ("lastReadingBookId" in record && !validBookId(record.lastReadingBookId)) return undefined;
  if ("libraryFilter" in record && !LIBRARY_FILTERS.includes(record.libraryFilter as LibraryFilter)) return undefined;
  return {
    ...(Object.hasOwn(record, "lastReadingBookId") ? { lastReadingBookId: record.lastReadingBookId as string | null } : {}),
    ...(Object.hasOwn(record, "libraryFilter") ? { libraryFilter: record.libraryFilter as LibraryFilter } : {}),
  };
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
  return appStateResponse(await apiFetch("/api/app-state"));
}

export async function updateAppState(patch: AppStatePatch): Promise<AppState> {
  return appStateResponse(await apiFetch("/api/app-state", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }));
}

export function saveAppState(lastReadingBookId: string | null): Promise<AppState> {
  return updateAppState({ lastReadingBookId });
}

export function saveLibraryFilter(libraryFilter: LibraryFilter): Promise<AppState> {
  return updateAppState({ libraryFilter });
}
