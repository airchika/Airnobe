import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AIRNOBE_FORMAT_VERSION, BookManifestSchema, type BookManifest } from "@airnobe/book-format";
import { inspectEpubBytes } from "@airnobe/epub-normalizer";
import type { Plugin } from "vite";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { importLibraryBook } from "./library-import.js";
import { readReadingState, writeReadingState } from "./reading-state-store.js";
import { addBookmark, deleteBookmark, readBookmarkState } from "./bookmark-store.js";
import {
  findExactDuplicate,
  findProbableDuplicates,
  deleteLibraryEntryAtomically,
  readLibraryIndex,
  updateLibraryEntry,
  writeLibraryIndexAtomically,
  type CollectionStatus,
} from "./library-store.js";
import { readReaderSettings, writeReaderSettings } from "./settings-store.js";
import { readAppState, writeAppState } from "./app-state-store.js";
import { readCustomThemes, writeCustomTheme } from "./theme-store.js";
import { parseReadingPosition, readingProgressSummary, type ReadingPosition } from "./src/reading-state.js";
import { parseBookmarkDraft } from "./src/bookmarks.js";
import { parseReaderSettings } from "./src/reader-settings.js";
import { parseAppState, parseAppStatePatch } from "./src/app-state.js";
import { BUILTIN_THEMES, parseThemeDefinition } from "./src/themes.js";
import { downloadNoveliaEpub, NoveliaDownloadError } from "./novelia-download.js";
import { syncGettingStartedBook } from "./bundled-books-store.js";

const APP_DIRECTORY = process.env.AIRNOBE_APP_DIRECTORY?.trim()
  ? resolve(process.env.AIRNOBE_APP_DIRECTORY)
  : dirname(fileURLToPath(import.meta.url));
const REPOSITORY_DIRECTORY = resolve(APP_DIRECTORY, "../..");
const LIBRARY_DIRECTORY = process.env.AIRNOBE_LIBRARY_DIRECTORY?.trim()
  ? resolve(process.env.AIRNOBE_LIBRARY_DIRECTORY)
  : resolve(REPOSITORY_DIRECTORY, "AirnobeLibrary");
const LIBRARY_INDEX_PATH = join(LIBRARY_DIRECTORY, "library.json");
const SETTINGS_PATH = join(LIBRARY_DIRECTORY, "user.json");
const APP_STATE_PATH = join(LIBRARY_DIRECTORY, "app-state.json");
const BUNDLED_GETTING_STARTED_EPUB = process.env.AIRNOBE_BUNDLED_GETTING_STARTED_EPUB?.trim()
  ? resolve(process.env.AIRNOBE_BUNDLED_GETTING_STARTED_EPUB)
  : resolve(REPOSITORY_DIRECTORY, "apps/desktop/src-tauri/resources/airnobe-getting-started.epub");
const THEMES_DIRECTORY = join(LIBRARY_DIRECTORY, "themes");
const MAX_EPUB_BYTES = 512 * 1024 * 1024;
const MAX_THEME_BYTES = 64 * 1024;
const MAX_BOOKMARK_BYTES = 16 * 1024;
const MAX_APP_STATE_BYTES = 4 * 1024;
const MAX_NOVELIA_REQUEST_BYTES = 4 * 1024;
const API_TOKEN = process.env.AIRNOBE_API_TOKEN?.trim() || undefined;
const BOOK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let mutationQueue: Promise<void> = Promise.resolve();
const upstreamDispatcher = new EnvHttpProxyAgent();
const fetchUpstream: typeof fetch = (input, init) => undiciFetch(
  input as unknown as Parameters<typeof undiciFetch>[0],
  { ...init, dispatcher: upstreamDispatcher } as Parameters<typeof undiciFetch>[1],
) as unknown as Promise<Response>;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readRequestBytes(
  request: IncomingMessage,
  maximumBytes = MAX_EPUB_BYTES,
  sizeError = "EPUB 超过 512 MB。当前版本暂不支持。",
  emptyError = "没有收到 EPUB 文件。",
): Promise<Uint8Array> {
  const declaredSize = Number(request.headers["content-length"] ?? 0);
  if (declaredSize > maximumBytes) throw new HttpError(413, sizeError);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) throw new HttpError(413, sizeError);
    chunks.push(bytes);
  }
  if (size === 0) throw new HttpError(400, emptyError);
  return Buffer.concat(chunks);
}

async function readRequestJson(request: IncomingMessage, maximumBytes = MAX_EPUB_BYTES, sizeError?: string, emptyError = "没有收到 JSON 请求正文。"): Promise<unknown> {
  const bytes = await readRequestBytes(request, maximumBytes, sizeError, emptyError);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new HttpError(400, "请求正文不是有效 JSON。");
  }
}

function decodeFileName(request: IncomingMessage): string {
  const header = request.headers["x-airnobe-filename"];
  if (typeof header !== "string") return "book.epub";
  try {
    const name = decodeURIComponent(header).replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
    return name || "book.epub";
  } catch {
    return "book.epub";
  }
}

function libraryBookDirectory(bookId: string): string {
  if (!BOOK_ID_PATTERN.test(bookId)) throw new HttpError(404, "书籍不存在。");
  return resolve(LIBRARY_DIRECTORY, "books", bookId);
}

function readingStatePath(bookId: string): string {
  return resolve(libraryBookDirectory(bookId), "reading-state.json");
}

function bookmarkStatePath(bookId: string): string {
  return resolve(libraryBookDirectory(bookId), "bookmarks.json");
}

function resolveBookFile(directory: string, relativePath: string): string {
  const target = resolve(directory, relativePath);
  if (!target.startsWith(`${directory}${sep}`)) throw new HttpError(500, "转换结果包含不安全的路径。");
  return target;
}

async function readBook(directory: string): Promise<BookManifest> {
  try {
    return BookManifestSchema.parse(JSON.parse(await readFile(resolve(directory, "book.json"), "utf8")));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, "书籍不存在或转换结果无效。");
  }
}

async function storedBookUsesCurrentFormat(bookId: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(libraryBookDirectory(bookId), "book.json"), "utf8")) as { version?: unknown };
    return value.version === AIRNOBE_FORMAT_VERSION;
  } catch {
    return false;
  }
}

async function importEpub(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const fileName = decodeFileName(request);
  if (extname(fileName).toLowerCase() !== ".epub") throw new HttpError(400, "请选择 EPUB 文件。");
  const bytes = await readRequestBytes(request);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const index = await readLibraryIndex(LIBRARY_INDEX_PATH);
  const exact = findExactDuplicate(index, sourceSha256);
  if (exact) {
    if (!await storedBookUsesCurrentFormat(exact.id)) {
      const result = await importLibraryBook({
        libraryDirectory: LIBRARY_DIRECTORY,
        bytes,
        fileName,
        replaceBookId: exact.id,
      });
      sendJson(response, 200, {
        outcome: "imported",
        bookId: result.entry.id,
        annotationStatus: result.entry.annotationStatus,
        warning: result.annotationError
          ? `旧版转换结果已重新生成，但程序注音失败，只能打开基础版本：${result.annotationError}`
          : "旧版转换结果已按当前格式重新生成。",
      });
      return;
    }
    sendJson(response, 200, {
      outcome: "exact-duplicate",
      book: { id: exact.id, title: exact.title, authors: exact.authors },
    });
    return;
  }

  const inspected = await inspectEpubBytes(bytes);
  const probable = findProbableDuplicates(index, inspected);
  const action = request.headers["x-airnobe-duplicate-action"];
  const replaceBookId = request.headers["x-airnobe-replace-book-id"];
  if (probable.length > 0 && action !== "add" && action !== "replace") {
    sendJson(response, 200, {
      outcome: "possible-duplicate",
      candidates: probable.map((entry) => ({ id: entry.id, title: entry.title, authors: entry.authors })),
    });
    return;
  }
  if (action === "replace") {
    if (typeof replaceBookId !== "string" || !probable.some((entry) => entry.id === replaceBookId)) {
      throw new HttpError(409, "要替换的书籍与当前 EPUB 不匹配。");
    }
  } else if (replaceBookId !== undefined) {
    throw new HttpError(400, "重复书籍处理参数无效。");
  }

  const result = await importLibraryBook({
    libraryDirectory: LIBRARY_DIRECTORY,
    bytes,
    fileName,
    ...(action === "replace" && typeof replaceBookId === "string" ? { replaceBookId } : {}),
  });
  sendJson(response, 200, {
    outcome: "imported",
    bookId: result.entry.id,
    annotationStatus: result.entry.annotationStatus,
    ...(result.annotationError ? { warning: `程序注音生成失败，已打开基础版本：${result.annotationError}` } : {}),
  });
}

async function sendNoveliaEpub(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const value = await readRequestJson(
    request,
    MAX_NOVELIA_REQUEST_BYTES,
    "轻小说机翻机器人导入请求超过 4 KB。",
  );
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || typeof (value as { url?: unknown }).url !== "string") {
    throw new HttpError(400, "轻小说机翻机器人导入请求格式无效。");
  }
  const result = await downloadNoveliaEpub((value as { url: string }).url, { fetch: fetchUpstream });
  response.writeHead(200, {
    "content-type": "application/epub+zip",
    "content-length": result.bytes.byteLength,
    "cache-control": "no-store",
    "x-airnobe-filename": encodeURIComponent(result.fileName),
  });
  response.end(Buffer.from(result.bytes));
}

function enqueueMutation(task: () => Promise<void>): Promise<void> {
  const pending = mutationQueue.then(task, task);
  mutationQueue = pending.catch(() => {});
  return pending;
}

async function sendLibrary(response: ServerResponse): Promise<void> {
  const index = await readLibraryIndex(LIBRARY_INDEX_PATH);
  const books = await Promise.all(index.books.map(async (book) => ({
    ...book,
    readingProgress: readingProgressSummary(await readReadingState(readingStatePath(book.id))),
  })));
  sendJson(response, 200, { ...index, books });
}

function parseLibraryPatch(value: unknown): { collectionStatus?: CollectionStatus; note?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "书籍修改内容无效。");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 || keys.some((key) => key !== "collectionStatus" && key !== "note")) {
    throw new HttpError(400, "只能修改收藏状态和备注。");
  }
  const statuses: CollectionStatus[] = ["wish", "reading", "completed", "on-hold", "dropped"];
  if (record.collectionStatus !== undefined && !statuses.includes(record.collectionStatus as CollectionStatus)) {
    throw new HttpError(400, "收藏状态无效。");
  }
  if (record.note !== undefined && (typeof record.note !== "string" || record.note.length > 10_000)) {
    throw new HttpError(400, "备注必须是不超过 10000 个字符的文本。");
  }
  return {
    ...(record.collectionStatus !== undefined ? { collectionStatus: record.collectionStatus as CollectionStatus } : {}),
    ...(record.note !== undefined ? { note: record.note as string } : {}),
  };
}

async function updateLibraryBook(bookId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const patch = parseLibraryPatch(await readRequestJson(request));
  const index = await readLibraryIndex(LIBRARY_INDEX_PATH);
  const updated = updateLibraryEntry(index, bookId, patch);
  if (!updated) throw new HttpError(404, "书籍不存在。");
  await writeLibraryIndexAtomically(LIBRARY_INDEX_PATH, updated.index);
  const readingProgress = readingProgressSummary(await readReadingState(readingStatePath(bookId)));
  sendJson(response, 200, { ...updated.entry, readingProgress });
}

async function reimportStoredBook(bookId: string, response: ServerResponse): Promise<void> {
  const index = await readLibraryIndex(LIBRARY_INDEX_PATH);
  const entry = index.books.find((candidate) => candidate.id === bookId);
  if (!entry) throw new HttpError(404, "书籍不存在。");
  let bytes: Uint8Array;
  try {
    bytes = await readFile(join(libraryBookDirectory(bookId), "source.epub"));
  } catch {
    throw new HttpError(404, "保存的原始 EPUB 不存在，无法重新导入。");
  }
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  if (sourceSha256 !== entry.sourceSha256) throw new HttpError(409, "保存的原始 EPUB 与书库记录不一致。");
  const result = await importLibraryBook({
    libraryDirectory: LIBRARY_DIRECTORY,
    bytes,
    fileName: entry.sourceFileName,
    replaceBookId: bookId,
  });
  sendJson(response, 200, {
    bookId,
    ...(result.annotationError ? { warning: `重新导入成功，但程序注音失败，只能打开基础版本：${result.annotationError}` } : {}),
  });
}

async function deleteStoredBook(bookId: string, response: ServerResponse): Promise<void> {
  if (!await deleteLibraryEntryAtomically(LIBRARY_DIRECTORY, bookId)) throw new HttpError(404, "书籍不存在。");
  sendJson(response, 200, { deletedBookId: bookId });
}

async function sendBookBundle(bookId: string, response: ServerResponse): Promise<void> {
  const directory = libraryBookDirectory(bookId);
  const book = await readBook(directory);
  const documents = await Promise.all(book.readingOrder.map(async (entry) =>
    JSON.parse(await readFile(resolveBookFile(directory, entry.path), "utf8")) as unknown));
  let report: unknown;
  try {
    report = JSON.parse(await readFile(resolve(directory, "report.json"), "utf8"));
  } catch {
    report = undefined;
  }
  const readingState = await readReadingState(readingStatePath(bookId));
  const bookmarkState = await readBookmarkState(bookmarkStatePath(bookId));
  sendJson(response, 200, { book, documents, report, readingState, bookmarkState });
}

function parseReadingPositionRequest(value: unknown): ReadingPosition | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "阅读进度无效。");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("position" in record)) throw new HttpError(400, "阅读进度无效。");
  if (record.position === null) return null;
  const position = parseReadingPosition(record.position);
  if (!position) throw new HttpError(400, "阅读进度无效。");
  return position;
}

async function updateReadingState(bookId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const directory = libraryBookDirectory(bookId);
  await readBook(directory);
  const position = parseReadingPositionRequest(await readRequestJson(request));
  sendJson(response, 200, await writeReadingState(readingStatePath(bookId), position));
}

async function createBookmark(bookId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  await readBook(libraryBookDirectory(bookId));
  const draft = parseBookmarkDraft(await readRequestJson(request, MAX_BOOKMARK_BYTES, "书签请求过大。"));
  if (!draft) throw new HttpError(400, "书签内容无效。");
  sendJson(response, 200, await addBookmark(bookmarkStatePath(bookId), draft));
}

async function removeBookmark(bookId: string, bookmarkId: string, response: ServerResponse): Promise<void> {
  await readBook(libraryBookDirectory(bookId));
  sendJson(response, 200, await deleteBookmark(bookmarkStatePath(bookId), bookmarkId));
}

async function sendAsset(bookId: string, assetId: string, response: ServerResponse): Promise<void> {
  const directory = libraryBookDirectory(bookId);
  const book = await readBook(directory);
  const asset = book.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new HttpError(404, "资源不存在。");
  const bytes = await readFile(resolveBookFile(directory, asset.path));
  response.writeHead(200, {
    "content-type": asset.mediaType,
    "cache-control": "public, max-age=31536000, immutable",
  });
  response.end(bytes);
}

function contentDispositionFileName(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "book.epub";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function sendSourceEpub(bookId: string, response: ServerResponse): Promise<void> {
  const index = await readLibraryIndex(LIBRARY_INDEX_PATH);
  const entry = index.books.find((candidate) => candidate.id === bookId);
  if (!entry) throw new HttpError(404, "书籍不存在。");
  const bytes = await readFile(resolve(libraryBookDirectory(bookId), "source.epub"));
  response.writeHead(200, {
    "content-type": "application/epub+zip",
    "content-length": bytes.byteLength,
    "content-disposition": contentDispositionFileName(entry.sourceFileName),
  });
  response.end(bytes);
}

async function sendReaderSettings(response: ServerResponse): Promise<void> {
  sendJson(response, 200, await readReaderSettings(SETTINGS_PATH));
}

async function updateReaderSettings(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const settings = parseReaderSettings(await readRequestJson(request));
  if (!settings) throw new HttpError(400, "阅读设置包含无效的排版、显示、导航或快捷键值。");
  await writeReaderSettings(SETTINGS_PATH, settings);
  sendJson(response, 200, settings);
}

async function sendAppState(response: ServerResponse): Promise<void> {
  sendJson(response, 200, await readAppState(APP_STATE_PATH));
}

async function updateAppState(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const state = parseAppState(await readRequestJson(request, MAX_APP_STATE_BYTES, "应用状态 JSON 超过 4 KB。"));
  if (!state) throw new HttpError(400, "应用状态格式无效。");
  if (state.lastReadingBookId) {
    const index = await readLibraryIndex(LIBRARY_INDEX_PATH);
    if (!index.books.some((book) => book.id === state.lastReadingBookId)) throw new HttpError(404, "最后阅读的书籍不存在。");
  }
  await writeAppState(APP_STATE_PATH, state);
  sendJson(response, 200, state);
}

async function patchAppState(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const patch = parseAppStatePatch(await readRequestJson(request, MAX_APP_STATE_BYTES, "应用状态 JSON 超过 4 KB。"));
  if (!patch) throw new HttpError(400, "应用状态修改内容无效。");
  if (patch.lastReadingBookId) {
    const index = await readLibraryIndex(LIBRARY_INDEX_PATH);
    if (!index.books.some((book) => book.id === patch.lastReadingBookId)) throw new HttpError(404, "最后阅读的书籍不存在。");
  }
  const current = await readAppState(APP_STATE_PATH);
  const state = { ...current, ...patch };
  await writeAppState(APP_STATE_PATH, state);
  sendJson(response, 200, state);
}

async function sendThemes(response: ServerResponse): Promise<void> {
  sendJson(response, 200, {
    version: 1,
    themes: [
      ...BUILTIN_THEMES.map((theme) => ({ theme, builtin: true })),
      ...(await readCustomThemes(THEMES_DIRECTORY)).map((theme) => ({ theme, builtin: false })),
    ],
  });
}

async function importTheme(themeId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const theme = parseThemeDefinition(await readRequestJson(request, MAX_THEME_BYTES, "主题 JSON 超过 64 KB。"));
  if (!theme || theme.id !== themeId) throw new HttpError(400, "主题 JSON 格式无效或 ID 不一致。");
  try {
    await writeCustomTheme(THEMES_DIRECTORY, theme);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  sendJson(response, 200, { theme, builtin: false });
}

function applyCors(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, PUT, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization, content-type, x-airnobe-filename");
  response.setHeader("access-control-expose-headers", "x-airnobe-filename, content-disposition");
}

function isAuthorized(request: IncomingMessage, url: URL): boolean {
  if (!API_TOKEN) return true;
  return request.headers.authorization === `Bearer ${API_TOKEN}` || url.searchParams.get("token") === API_TOKEN;
}

export async function handleLocalApi(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/")) {
    next();
    return;
  }
  applyCors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (!isAuthorized(request, url)) {
    sendJson(response, 401, { error: "本地服务访问令牌无效。" });
    return;
  }
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/import-epub") {
      await enqueueMutation(() => importEpub(request, response));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/novelia/epub") {
      await sendNoveliaEpub(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library") {
      await sendLibrary(response);
      return;
    }
    const libraryBookMatch = /^\/api\/library\/books\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(url.pathname);
    if (request.method === "PATCH" && libraryBookMatch) {
      await enqueueMutation(() => updateLibraryBook(libraryBookMatch[1] as string, request, response));
      return;
    }
    if (request.method === "DELETE" && libraryBookMatch) {
      await enqueueMutation(() => deleteStoredBook(libraryBookMatch[1] as string, response));
      return;
    }
    const reimportBookMatch = /^\/api\/library\/books\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/reimport$/i.exec(url.pathname);
    if (request.method === "POST" && reimportBookMatch) {
      await enqueueMutation(() => reimportStoredBook(reimportBookMatch[1] as string, response));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/settings") {
      await sendReaderSettings(response);
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/settings") {
      await enqueueMutation(() => updateReaderSettings(request, response));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/app-state") {
      await sendAppState(response);
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/app-state") {
      await enqueueMutation(() => updateAppState(request, response));
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/api/app-state") {
      await enqueueMutation(() => patchAppState(request, response));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/themes") {
      await sendThemes(response);
      return;
    }
    const themeMatch = /^\/api\/themes\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)$/.exec(url.pathname);
    if (request.method === "PUT" && themeMatch) {
      await enqueueMutation(() => importTheme(themeMatch[1] as string, request, response));
      return;
    }
    const bookMatch = /^\/api\/books\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(url.pathname);
    if (request.method === "GET" && bookMatch) {
      await sendBookBundle(bookMatch[1] as string, response);
      return;
    }
    const readingStateMatch = /^\/api\/books\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/reading-state$/i.exec(url.pathname);
    if (request.method === "PUT" && readingStateMatch) {
      await enqueueMutation(() => updateReadingState(readingStateMatch[1] as string, request, response));
      return;
    }
    const bookmarksMatch = /^\/api\/books\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/bookmarks$/i.exec(url.pathname);
    if (request.method === "POST" && bookmarksMatch) {
      await enqueueMutation(() => createBookmark(bookmarksMatch[1] as string, request, response));
      return;
    }
    const bookmarkMatch = /^\/api\/books\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/bookmarks\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(url.pathname);
    if (request.method === "DELETE" && bookmarkMatch) {
      await enqueueMutation(() => removeBookmark(bookmarkMatch[1] as string, bookmarkMatch[2] as string, response));
      return;
    }
    const assetMatch = /^\/api\/books\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/assets\/([^/]+)$/i.exec(url.pathname);
    if (request.method === "GET" && assetMatch) {
      await sendAsset(assetMatch[1] as string, decodeURIComponent(assetMatch[2] as string), response);
      return;
    }
    const sourceMatch = /^\/api\/books\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/source$/i.exec(url.pathname);
    if (request.method === "GET" && sourceMatch) {
      await sendSourceEpub(sourceMatch[1] as string, response);
      return;
    }
    sendJson(response, 404, { error: "本地服务接口不存在。" });
  } catch (error) {
    const status = error instanceof HttpError || error instanceof NoveliaDownloadError ? error.status : 500;
    sendJson(response, status, { error: (error as Error).message });
  }
}

export function localBookApi(): Plugin {
  return {
    name: "airnobe-local-book-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => void handleLocalApi(request, response, next));
    },
  };
}

async function startSidecar(): Promise<void> {
  const libraryWasMissing = await access(LIBRARY_INDEX_PATH).then(() => false, () => true);
  await syncGettingStartedBook({
    libraryDirectory: LIBRARY_DIRECTORY,
    epubPath: BUNDLED_GETTING_STARTED_EPUB,
    libraryWasMissing,
  }).catch((error) => console.error(`Airnobe Start 同步失败：${(error as Error).message}`));
  const server = createHttpServer((request, response) => {
    void handleLocalApi(request, response, () => {
      sendJson(response, 404, { error: "本地服务接口不存在。" });
    });
  });
  const port = Number(process.env.AIRNOBE_API_PORT ?? 0);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法确定本地服务端口。");
  process.stdout.write(`${JSON.stringify({ event: "ready", port: address.port })}\n`);
  const stop = (): void => { server.close(() => process.exit(0)); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function startDevelopmentServer(): Promise<void> {
  const libraryWasMissing = await access(LIBRARY_INDEX_PATH).then(() => false, () => true);
  await syncGettingStartedBook({
    libraryDirectory: LIBRARY_DIRECTORY,
    epubPath: BUNDLED_GETTING_STARTED_EPUB,
    libraryWasMissing,
  }).catch((error) => console.warn(`Airnobe Start 同步失败：${(error as Error).message}`));
  const viteModuleName = "vite";
  const { createServer } = await import(viteModuleName);
  const server = await createServer({
    root: APP_DIRECTORY,
    plugins: [localBookApi()],
    server: { host: "127.0.0.1", strictPort: true },
  });
  await server.listen();
  server.printUrls();
  console.log(`转换结果目录：${LIBRARY_DIRECTORY}`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--sidecar")) await startSidecar();
  else await startDevelopmentServer();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
