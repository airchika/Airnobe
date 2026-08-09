import { parseReadingPosition, type ReadingPosition } from "./reading-state.js";

export interface Bookmark {
  id: string;
  position: ReadingPosition;
  excerpt: string;
  createdAt: string;
}

export interface BookmarkState {
  version: 1;
  bookmarks: Bookmark[];
}

export interface BookmarkDraft {
  position: ReadingPosition;
  excerpt: string;
}

export interface BookmarkMutationResult {
  outcome: "created" | "duplicate";
  state: BookmarkState;
}

export const EMPTY_BOOKMARK_STATE: BookmarkState = { version: 1, bookmarks: [] };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseBookmarkDraft(value: unknown): BookmarkDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const position = parseReadingPosition(record.position);
  if (!position || typeof record.excerpt !== "string") return undefined;
  const excerpt = record.excerpt.trim();
  if (!excerpt || Array.from(excerpt).length > 120) return undefined;
  return { position, excerpt };
}

export function parseBookmark(value: unknown): Bookmark | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const draft = parseBookmarkDraft(record);
  if (!draft || typeof record.id !== "string" || !UUID_PATTERN.test(record.id)) return undefined;
  if (typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) return undefined;
  return { id: record.id, ...draft, createdAt: record.createdAt };
}

export function parseBookmarkState(value: unknown): BookmarkState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.bookmarks)) return undefined;
  const bookmarks = record.bookmarks.map(parseBookmark);
  if (bookmarks.some((bookmark) => !bookmark)) return undefined;
  const parsed = bookmarks as Bookmark[];
  if (new Set(parsed.map((bookmark) => bookmark.id)).size !== parsed.length) return undefined;
  if (new Set(parsed.map((bookmark) => bookmark.position.blockId)).size !== parsed.length) return undefined;
  return { version: 1, bookmarks: parsed };
}
