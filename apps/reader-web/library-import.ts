import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { basename, join, resolve, sep } from "node:path";
import {
  BookDocumentSchema,
  BookManifestSchema,
  ConversionReportSchema,
  validateBookGraph,
  type BookDocument,
  type BookManifest,
  type ConversionReport,
} from "@airnobe/book-format";
import {
  convertEpubBytes,
  writeConversionAtomically,
  type ConversionResult,
} from "@airnobe/epub-normalizer";
import { deriveFurigana, loadTokenizer, type TokenizerLike } from "@airnobe/furigana";
import {
  createLibraryEntry,
  findExactDuplicate,
  readLibraryIndex,
  writeLibraryIndexAtomically,
  type AnnotationStatus,
  type LibraryEntry,
} from "./library-store.js";

export const BASE_SNAPSHOT_FORMAT = "airnobe-base-snapshot" as const;
export const BASE_SNAPSHOT_VERSION = 1 as const;

export interface BaseSnapshot {
  format: typeof BASE_SNAPSHOT_FORMAT;
  version: typeof BASE_SNAPSHOT_VERSION;
  book: BookManifest;
  documents: BookDocument[];
  report: ConversionReport;
}

export interface ImportResult {
  entry: LibraryEntry;
  annotationError?: string;
}

function safeBookDirectory(libraryDirectory: string, bookId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookId)) throw new Error("书库编号无效。");
  const booksDirectory = resolve(libraryDirectory, "books");
  const directory = resolve(booksDirectory, bookId);
  if (!directory.startsWith(`${booksDirectory}${sep}`)) throw new Error("书库路径无效。");
  return directory;
}

function hasJapanese(book: BookManifest): boolean {
  return book.metadata.languages.includes("ja-JP");
}

function snapshotBytes(base: ConversionResult): Uint8Array {
  const snapshot: BaseSnapshot = {
    format: BASE_SNAPSHOT_FORMAT,
    version: BASE_SNAPSHOT_VERSION,
    book: base.book,
    documents: base.documents,
    report: base.report,
  };
  return gzipSync(Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8"), { level: 9 });
}

export function parseBaseSnapshot(bytes: Uint8Array): BaseSnapshot {
  const value = JSON.parse(gunzipSync(bytes).toString("utf8")) as Partial<BaseSnapshot>;
  if (value.format !== BASE_SNAPSHOT_FORMAT || value.version !== BASE_SNAPSHOT_VERSION) {
    throw new Error("基础书快照格式无效。");
  }
  const book = BookManifestSchema.parse(value.book);
  if (book.derivation) throw new Error("基础书快照不能包含派生结果。");
  if (!Array.isArray(value.documents)) throw new Error("基础书快照缺少文档。");
  const documents = value.documents.map((document) => BookDocumentSchema.parse(document));
  const report = ConversionReportSchema.parse(value.report);
  const graphErrors = validateBookGraph(book, documents);
  if (graphErrors.length > 0) throw new Error(`基础书快照引用校验失败：\n${graphErrors.join("\n")}`);
  return { format: BASE_SNAPSHOT_FORMAT, version: BASE_SNAPSHOT_VERSION, book, documents, report };
}

function baseWithAnnotationFailure(base: ConversionResult, message: string): ConversionResult {
  const report = structuredClone(base.report) as ConversionReport;
  report.warnings.push({
    code: "FURIGANA_DERIVATION_FAILED",
    message: `Automatic annotation failed; the base book remains readable. ${message}`,
  });
  report.status = "ok-with-warnings";
  return { ...base, report };
}

async function prepareStoredBook(
  bytes: Uint8Array,
  fileName: string,
  stagingDirectory: string,
  tokenizerFactory: () => Promise<TokenizerLike>,
): Promise<{ final: ConversionResult; annotationStatus: AnnotationStatus; annotationError?: string }> {
  const base = await convertEpubBytes(bytes, fileName);
  let final = base;
  let annotationStatus: AnnotationStatus = "not-applicable";
  let annotationError: string | undefined;
  if (hasJapanese(base.book)) {
    try {
      final = deriveFurigana(base, await tokenizerFactory());
      annotationStatus = "ready";
    } catch (error) {
      annotationError = (error as Error).message;
      final = baseWithAnnotationFailure(base, annotationError);
      annotationStatus = "failed";
    }
  }

  await writeConversionAtomically(stagingDirectory, final, false);
  await writeFile(join(stagingDirectory, "source.epub"), bytes);
  if (annotationStatus === "ready") {
    const compressed = snapshotBytes(base);
    parseBaseSnapshot(compressed);
    await writeFile(join(stagingDirectory, "base.snapshot.json.gz"), compressed);
  }
  const storedSource = await readFile(join(stagingDirectory, "source.epub"));
  const storedHash = createHash("sha256").update(storedSource).digest("hex");
  if (storedHash !== base.book.source.sha256) throw new Error("保存后的原始 EPUB 校验失败。");
  return { final, annotationStatus, ...(annotationError ? { annotationError } : {}) };
}

export async function importLibraryBook(args: {
  libraryDirectory: string;
  bytes: Uint8Array;
  fileName: string;
  replaceBookId?: string;
  tokenizerFactory?: () => Promise<TokenizerLike>;
  now?: string;
}): Promise<ImportResult> {
  const libraryDirectory = resolve(args.libraryDirectory);
  const indexPath = join(libraryDirectory, "library.json");
  const index = await readLibraryIndex(indexPath);
  const sourceSha256 = createHash("sha256").update(args.bytes).digest("hex");
  const exact = findExactDuplicate(index, sourceSha256);
  if (exact && exact.id !== args.replaceBookId) throw new Error(`EPUB 已存在于书库：${exact.id}`);

  const previous = args.replaceBookId
    ? index.books.find((entry) => entry.id === args.replaceBookId)
    : undefined;
  if (args.replaceBookId && !previous) throw new Error("要替换的书籍不存在。");
  const bookId = previous?.id ?? randomUUID();
  const booksDirectory = join(libraryDirectory, "books");
  const targetDirectory = safeBookDirectory(libraryDirectory, bookId);
  const stagingDirectory = join(booksDirectory, `.${bookId}.airnobe-import-${randomUUID()}`);
  const backupDirectory = join(booksDirectory, `.${bookId}.airnobe-backup-${randomUUID()}`);
  await mkdir(booksDirectory, { recursive: true });
  let movedExisting = false;
  let promoted = false;
  try {
    const prepared = await prepareStoredBook(
      args.bytes,
      basename(args.fileName),
      stagingDirectory,
      args.tokenizerFactory ?? loadTokenizer,
    );
    const entry = createLibraryEntry({
      id: bookId,
      book: prepared.final.book,
      sourceFileName: basename(args.fileName),
      sourceSize: args.bytes.byteLength,
      annotationStatus: prepared.annotationStatus,
      ...(args.now ? { now: args.now } : {}),
      ...(previous ? { previous } : {}),
    });
    const nextIndex = {
      version: index.version,
      books: previous
        ? index.books.map((candidate) => candidate.id === previous.id ? entry : candidate)
        : [...index.books, entry],
    };
    try {
      await rename(targetDirectory, backupDirectory);
      movedExisting = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(stagingDirectory, targetDirectory);
    promoted = true;
    await writeLibraryIndexAtomically(indexPath, nextIndex);
    if (movedExisting) await rm(backupDirectory, { recursive: true, force: true }).catch(() => {});
    return { entry, ...(prepared.annotationError ? { annotationError: prepared.annotationError } : {}) };
  } catch (error) {
    if (promoted) await rm(targetDirectory, { recursive: true, force: true }).catch(() => {});
    if (movedExisting) await rename(backupDirectory, targetDirectory).catch(() => {});
    throw error;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    if (!movedExisting || await stat(targetDirectory).then(() => true, () => false)) {
      await rm(backupDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}
