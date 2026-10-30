import { parseReadingPosition, type ReadingPosition } from "./reading-state.js";

const STORAGE_KEY = "airnobe.reader-session.v1";
const BOOK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReaderSession {
  version: 1;
  bookId: string;
  position: ReadingPosition | null;
}

// sessionStorage survives reload/discard, while keeping each tab's book independent.
export function loadReaderSession(): ReaderSession | undefined {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Partial<ReaderSession>;
    if (record.version !== 1 || typeof record.bookId !== "string" || !BOOK_ID_PATTERN.test(record.bookId)) return undefined;
    const position = record.position === null ? null : parseReadingPosition(record.position);
    if (position === undefined) return undefined;
    return { version: 1, bookId: record.bookId, position };
  } catch { return undefined; }
}

export function saveReaderSession(bookId: string, position: ReadingPosition | null): void {
  if (!BOOK_ID_PATTERN.test(bookId) || (position !== null && !parseReadingPosition(position))) return;
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, bookId, position })); }
  catch { /* Storage can be disabled; the server's normal progress saving still works. */ }
}

export function clearReaderSession(): void {
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* Disabled storage is non-fatal. */ }
}
