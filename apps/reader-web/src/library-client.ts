export type CollectionStatus = "wish" | "reading" | "completed" | "on-hold" | "dropped";
export type AnnotationStatus = "not-applicable" | "ready" | "failed";
export type ContentKind = "chinese" | "japanese" | "parallel" | "mixed" | "unknown";

export interface LibraryBook {
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
  readingProgress: ReadingProgressSummary | null;
}

interface LibraryResponse {
  version: 1;
  books: LibraryBook[];
}

function isLibraryBook(value: unknown): value is LibraryBook {
  if (typeof value !== "object" || value === null) return false;
  const book = value as Partial<LibraryBook>;
  return typeof book.id === "string"
    && typeof book.title === "string"
    && Array.isArray(book.authors)
    && typeof book.sourceFileName === "string"
    && typeof book.sourceSize === "number"
    && typeof book.sourceSha256 === "string"
    && (book.coverAssetId === null || typeof book.coverAssetId === "string")
    && ["chinese", "japanese", "parallel", "mixed", "unknown"].includes(String(book.contentKind))
    && ["not-applicable", "ready", "failed"].includes(String(book.annotationStatus))
    && ["wish", "reading", "completed", "on-hold", "dropped"].includes(String(book.collectionStatus))
    && typeof book.note === "string"
    && typeof book.addedAt === "string"
    && typeof book.updatedAt === "string"
    && (book.readingProgress === null || (
      typeof book.readingProgress === "object"
      && typeof book.readingProgress.progress === "number"
      && Number.isFinite(book.readingProgress.progress)
      && book.readingProgress.progress >= 0
      && book.readingProgress.progress <= 1
      && (book.readingProgress.chapterLabel === null || typeof book.readingProgress.chapterLabel === "string")
      && typeof book.readingProgress.updatedAt === "string"
    ));
}

async function responseJson(response: Response): Promise<unknown> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`本地服务返回了无效响应（${response.status}）。`);
  }
  if (!response.ok) {
    const message = typeof value === "object" && value !== null && "error" in value
      ? String((value as { error: unknown }).error)
      : `请求失败（${response.status}）。`;
    throw new Error(message);
  }
  return value;
}

export async function loadLibrary(): Promise<LibraryBook[]> {
  const value = await responseJson(await fetch("/api/library"));
  if (typeof value !== "object" || value === null) throw new Error("书库响应无效。");
  const response = value as Partial<LibraryResponse>;
  if (response.version !== 1 || !Array.isArray(response.books) || !response.books.every(isLibraryBook)) {
    throw new Error("书库响应不符合当前格式。");
  }
  return response.books;
}

export async function updateLibraryBook(
  bookId: string,
  patch: { collectionStatus?: CollectionStatus; note?: string },
): Promise<LibraryBook> {
  const value = await responseJson(await fetch(`/api/library/books/${bookId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }));
  if (!isLibraryBook(value)) throw new Error("本地服务返回了无效的书籍记录。");
  return value;
}

export function coverUrl(book: LibraryBook): string | undefined {
  return book.coverAssetId
    ? `/api/books/${book.id}/assets/${encodeURIComponent(book.coverAssetId)}`
    : undefined;
}

export function sourceEpubUrl(book: LibraryBook): string {
  return `/api/books/${book.id}/source`;
}
import type { ReadingProgressSummary } from "./reading-state.js";
