import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { AIRNOBE_FORMAT_VERSION } from "@airnobe/book-format";
import { importLibraryBook, type ImportResult } from "./library-import.js";
import { readLibraryIndex } from "./library-store.js";

export const BUNDLED_BOOKS_VERSION = 1 as const;
export const GETTING_STARTED_KEY = "airnobe-getting-started" as const;
export const GETTING_STARTED_IDENTIFIER = "urn:airnobe:getting-started" as const;

export interface BundledBookRecord {
  bookId: string;
  sourceSha256: string;
}

export interface BundledBooksState {
  version: typeof BUNDLED_BOOKS_VERSION;
  books: Partial<Record<typeof GETTING_STARTED_KEY, BundledBookRecord>>;
}

export interface BundledBookSyncResult {
  outcome: "unavailable" | "skipped-existing-library" | "unchanged" | "installed" | "updated" | "deleted";
  importResult?: ImportResult;
}

const BOOK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyBundledBooksState(): BundledBooksState {
  return { version: BUNDLED_BOOKS_VERSION, books: {} };
}

export function parseBundledBooksState(value: unknown): BundledBooksState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== BUNDLED_BOOKS_VERSION || !record.books || typeof record.books !== "object" || Array.isArray(record.books)) return undefined;
  const books = record.books as Record<string, unknown>;
  if (Object.keys(books).some((key) => key !== GETTING_STARTED_KEY)) return undefined;
  const guide = books[GETTING_STARTED_KEY];
  if (guide !== undefined) {
    if (!guide || typeof guide !== "object" || Array.isArray(guide)) return undefined;
    const fields = guide as Record<string, unknown>;
    if (Object.keys(fields).some((key) => key !== "bookId" && key !== "sourceSha256")) return undefined;
    if (typeof fields.bookId !== "string" || !BOOK_ID_PATTERN.test(fields.bookId)) return undefined;
    if (typeof fields.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(fields.sourceSha256)) return undefined;
  }
  return {
    version: BUNDLED_BOOKS_VERSION,
    books: guide ? { [GETTING_STARTED_KEY]: guide as BundledBookRecord } : {},
  };
}

export async function readBundledBooksState(statePath: string): Promise<BundledBooksState> {
  try {
    return parseBundledBooksState(JSON.parse(await readFile(statePath, "utf8"))) ?? emptyBundledBooksState();
  } catch {
    return emptyBundledBooksState();
  }
}

export async function writeBundledBooksState(statePath: string, state: BundledBooksState): Promise<void> {
  if (!parseBundledBooksState(state)) throw new Error("拒绝保存无效的内置书状态。");
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  const backupPath = `${statePath}.${randomUUID()}.backup`;
  let movedExisting = false;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    try {
      await rename(statePath, backupPath);
      movedExisting = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporaryPath, statePath);
    if (movedExisting) await rm(backupPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    if (movedExisting) {
      await rm(statePath, { force: true }).catch(() => {});
      await rename(backupPath, statePath).catch(() => {});
    }
    throw new Error(`无法保存内置书状态：${(error as Error).message}`);
  }
}

async function usesCurrentFormat(libraryDirectory: string, bookId: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(libraryDirectory, "books", bookId, "book.json"), "utf8")) as { version?: unknown };
    return value.version === AIRNOBE_FORMAT_VERSION;
  } catch {
    return false;
  }
}

export async function syncGettingStartedBook(args: {
  libraryDirectory: string;
  epubPath?: string;
  libraryWasMissing: boolean;
}): Promise<BundledBookSyncResult> {
  if (!args.epubPath) return { outcome: "unavailable" };
  let bytes: Uint8Array;
  try {
    bytes = await readFile(resolve(args.epubPath));
  } catch {
    return { outcome: "unavailable" };
  }
  const libraryDirectory = resolve(args.libraryDirectory);
  const index = await readLibraryIndex(join(libraryDirectory, "library.json"));
  const statePath = join(libraryDirectory, "bundled-books.json");
  const state = await readBundledBooksState(statePath);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  let record = state.books[GETTING_STARTED_KEY];

  if (!record) {
    const adopted = index.books.find((book) => book.sourceIdentifier === GETTING_STARTED_IDENTIFIER);
    if (adopted) {
      record = { bookId: adopted.id, sourceSha256: adopted.sourceSha256 };
      await writeBundledBooksState(statePath, { version: BUNDLED_BOOKS_VERSION, books: { [GETTING_STARTED_KEY]: record } });
    }
  }

  if (record) {
    const current = index.books.find((book) => book.id === record.bookId);
    if (!current) return { outcome: "deleted" };
    if (sourceSha256 === record.sourceSha256 && current.sourceSha256 === sourceSha256 && await usesCurrentFormat(libraryDirectory, current.id)) return { outcome: "unchanged" };
    const importResult = await importLibraryBook({
      libraryDirectory,
      bytes,
      fileName: "Airnobe Start.epub",
      replaceBookId: current.id,
      initialCollectionStatus: "reading",
    });
    await writeBundledBooksState(statePath, {
      version: BUNDLED_BOOKS_VERSION,
      books: { [GETTING_STARTED_KEY]: { bookId: importResult.entry.id, sourceSha256 } },
    });
    return { outcome: "updated", importResult };
  }

  if (!args.libraryWasMissing) return { outcome: "skipped-existing-library" };
  const importResult = await importLibraryBook({
    libraryDirectory,
    bytes,
    fileName: "Airnobe Start.epub",
    initialCollectionStatus: "reading",
  });
  await writeBundledBooksState(statePath, {
    version: BUNDLED_BOOKS_VERSION,
    books: { [GETTING_STARTED_KEY]: { bookId: importResult.entry.id, sourceSha256 } },
  });
  return { outcome: "installed", importResult };
}
