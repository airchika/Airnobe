import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { join, resolve } from "node:path";
import type { BookManifest } from "@airnobe/book-format";

export const LIBRARY_INDEX_VERSION = 1 as const;

export type CollectionStatus = "wish" | "reading" | "completed" | "on-hold" | "dropped";
export type AnnotationStatus = "not-applicable" | "ready" | "failed";
export type ContentKind = "chinese" | "japanese" | "parallel" | "mixed" | "unknown";

export interface LibraryEntry {
  id: string;
  sourceSha256: string;
  sourceFileName: string;
  sourceSize: number;
  sourceIdentifier?: string;
  title: string;
  authors: string[];
  contentKind: ContentKind;
  coverAssetId: string | null;
  annotationStatus: AnnotationStatus;
  collectionStatus: CollectionStatus;
  note: string;
  addedAt: string;
  updatedAt: string;
}

export interface LibraryIndex {
  version: typeof LIBRARY_INDEX_VERSION;
  books: LibraryEntry[];
}

export interface LibraryEntryPatch {
  collectionStatus?: CollectionStatus;
  note?: string;
}

export function emptyLibraryIndex(): LibraryIndex {
  return { version: LIBRARY_INDEX_VERSION, books: [] };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isLibraryEntry(value: unknown): value is LibraryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<LibraryEntry>;
  return typeof entry.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id)
    && typeof entry.sourceSha256 === "string"
    && /^[a-f0-9]{64}$/.test(entry.sourceSha256)
    && typeof entry.sourceFileName === "string"
    && typeof entry.sourceSize === "number"
    && Number.isSafeInteger(entry.sourceSize)
    && entry.sourceSize > 0
    && (entry.sourceIdentifier === undefined || typeof entry.sourceIdentifier === "string")
    && typeof entry.title === "string"
    && isStringArray(entry.authors)
    && ["chinese", "japanese", "parallel", "mixed", "unknown"].includes(String(entry.contentKind))
    && (entry.coverAssetId === null || typeof entry.coverAssetId === "string")
    && ["not-applicable", "ready", "failed"].includes(String(entry.annotationStatus))
    && ["wish", "reading", "completed", "on-hold", "dropped"].includes(String(entry.collectionStatus))
    && typeof entry.note === "string"
    && typeof entry.addedAt === "string"
    && typeof entry.updatedAt === "string";
}

export function parseLibraryIndex(value: unknown): LibraryIndex | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const index = value as Partial<LibraryIndex>;
  if (index.version !== LIBRARY_INDEX_VERSION || !Array.isArray(index.books) || !index.books.every(isLibraryEntry)) return undefined;
  const ids = new Set(index.books.map((entry) => entry.id));
  const hashes = new Set(index.books.map((entry) => entry.sourceSha256));
  if (ids.size !== index.books.length || hashes.size !== index.books.length) return undefined;
  return { version: LIBRARY_INDEX_VERSION, books: index.books };
}

export async function readLibraryIndex(indexPath: string): Promise<LibraryIndex> {
  try {
    const parsed = parseLibraryIndex(JSON.parse(await readFile(indexPath, "utf8")));
    if (!parsed) throw new Error("书库索引格式无效。");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLibraryIndex();
    throw error;
  }
}

export async function writeLibraryIndexAtomically(indexPath: string, index: LibraryIndex): Promise<void> {
  if (!parseLibraryIndex(index)) throw new Error("拒绝保存无效的书库索引。");
  await mkdir(dirname(indexPath), { recursive: true });
  const temporaryPath = `${indexPath}.${randomUUID()}.tmp`;
  const backupPath = `${indexPath}.${randomUUID()}.backup`;
  let movedExisting = false;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    try {
      await rename(indexPath, backupPath);
      movedExisting = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporaryPath, indexPath);
    if (movedExisting) await rm(backupPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    if (movedExisting) {
      await rm(indexPath, { force: true }).catch(() => {});
      await rename(backupPath, indexPath).catch(() => {});
    }
    throw new Error(`无法保存书库索引：${(error as Error).message}`);
  }
}

export async function deleteLibraryEntryAtomically(libraryDirectory: string, bookId: string): Promise<LibraryEntry | undefined> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookId)) return undefined;
  const root = resolve(libraryDirectory);
  const indexPath = join(root, "library.json");
  const index = await readLibraryIndex(indexPath);
  const entry = index.books.find((candidate) => candidate.id === bookId);
  if (!entry) return undefined;
  const targetDirectory = join(root, "books", bookId);
  const removedDirectory = join(root, "books", `.${bookId}.airnobe-delete-${randomUUID()}`);
  let moved = false;
  try {
    try {
      await rename(targetDirectory, removedDirectory);
      moved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeLibraryIndexAtomically(indexPath, {
      version: index.version,
      books: index.books.filter((candidate) => candidate.id !== bookId),
    });
  } catch (error) {
    if (moved) await rename(removedDirectory, targetDirectory).catch(() => {});
    throw error;
  }
  if (moved) await rm(removedDirectory, { recursive: true, force: true }).catch(() => {});
  return entry;
}

function normalizedMetadata(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export interface InspectedMetadata {
  sourceSha256: string;
  title: string;
  authors: string[];
  identifier?: string;
}

export function findExactDuplicate(index: LibraryIndex, sourceSha256: string): LibraryEntry | undefined {
  return index.books.find((entry) => entry.sourceSha256 === sourceSha256);
}

export function findProbableDuplicates(index: LibraryIndex, inspected: InspectedMetadata): LibraryEntry[] {
  const identifier = inspected.identifier ? normalizedMetadata(inspected.identifier) : "";
  const title = normalizedMetadata(inspected.title);
  const authors = inspected.authors.map(normalizedMetadata).filter(Boolean).sort().join("\u0000");
  return index.books.filter((entry) => {
    const identifierMatch = identifier
      && entry.sourceIdentifier
      && normalizedMetadata(entry.sourceIdentifier) === identifier;
    const entryAuthors = entry.authors.map(normalizedMetadata).filter(Boolean).sort().join("\u0000");
    const metadataMatch = Boolean(title && authors)
      && normalizedMetadata(entry.title) === title
      && entryAuthors === authors;
    return Boolean(identifierMatch || metadataMatch);
  });
}

export function updateLibraryEntry(
  index: LibraryIndex,
  bookId: string,
  patch: LibraryEntryPatch,
  now = new Date().toISOString(),
): { index: LibraryIndex; entry: LibraryEntry } | undefined {
  const current = index.books.find((entry) => entry.id === bookId);
  if (!current) return undefined;
  const entry: LibraryEntry = {
    ...current,
    ...(patch.collectionStatus ? { collectionStatus: patch.collectionStatus } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    updatedAt: now,
  };
  return {
    index: {
      version: index.version,
      books: index.books.map((candidate) => candidate.id === bookId ? entry : candidate),
    },
    entry,
  };
}

export function contentKindFor(book: BookManifest): ContentKind {
  const languages = new Set(book.metadata.languages);
  const chinese = languages.has("zh-CN");
  const japanese = languages.has("ja-JP");
  if (chinese && japanese) return "parallel";
  if (chinese) return "chinese";
  if (japanese) return "japanese";
  if (languages.size > 1 || (languages.size === 1 && !languages.has("und"))) return "mixed";
  return "unknown";
}

export function createLibraryEntry(args: {
  id?: string;
  book: BookManifest;
  sourceFileName: string;
  sourceSize: number;
  annotationStatus: AnnotationStatus;
  initialCollectionStatus?: CollectionStatus;
  now?: string;
  previous?: LibraryEntry;
}): LibraryEntry {
  const now = args.now ?? new Date().toISOString();
  return {
    id: args.previous?.id ?? args.id ?? randomUUID(),
    sourceSha256: args.book.source.sha256,
    sourceFileName: args.sourceFileName,
    sourceSize: args.sourceSize,
    ...(args.book.source.identifier ? { sourceIdentifier: args.book.source.identifier } : {}),
    title: args.book.metadata.title,
    authors: args.book.metadata.authors,
    contentKind: contentKindFor(args.book),
    coverAssetId: args.book.coverAssetId ?? null,
    annotationStatus: args.annotationStatus,
    collectionStatus: args.previous?.collectionStatus ?? args.initialCollectionStatus ?? "wish",
    note: args.previous?.note ?? "",
    addedAt: args.previous?.addedAt ?? now,
    updatedAt: now,
  };
}
