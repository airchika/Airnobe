import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BookManifestSchema, type BookManifest } from "@airnobe/book-format";
import { inspectEpubBytes } from "@airnobe/epub-normalizer";
import { createServer, type Plugin } from "vite";
import { importLibraryBook } from "./library-import.js";
import {
  findExactDuplicate,
  findProbableDuplicates,
  readLibraryIndex,
} from "./library-store.js";
import { readReaderSettings, writeReaderSettings } from "./settings-store.js";
import { parseReaderSettings } from "./src/reader-settings.js";

const APP_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_DIRECTORY = resolve(APP_DIRECTORY, "../..");
const LIBRARY_DIRECTORY = resolve(REPOSITORY_DIRECTORY, "AirnobeLibrary");
const LIBRARY_INDEX_PATH = join(LIBRARY_DIRECTORY, "library.json");
const SETTINGS_PATH = join(LIBRARY_DIRECTORY, "user.json");
const MAX_EPUB_BYTES = 512 * 1024 * 1024;
const BOOK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let importQueue: Promise<void> = Promise.resolve();

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

async function readRequestBytes(request: IncomingMessage): Promise<Uint8Array> {
  const declaredSize = Number(request.headers["content-length"] ?? 0);
  if (declaredSize > MAX_EPUB_BYTES) throw new HttpError(413, "EPUB 超过 512 MB。当前版本暂不支持。");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_EPUB_BYTES) throw new HttpError(413, "EPUB 超过 512 MB。当前版本暂不支持。");
    chunks.push(bytes);
  }
  if (size === 0) throw new HttpError(400, "没有收到 EPUB 文件。");
  return Buffer.concat(chunks);
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const bytes = await readRequestBytes(request);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new HttpError(400, "阅读设置不是有效 JSON。");
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

async function importEpub(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const fileName = decodeFileName(request);
  if (extname(fileName).toLowerCase() !== ".epub") throw new HttpError(400, "请选择 EPUB 文件。");
  const bytes = await readRequestBytes(request);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const index = await readLibraryIndex(LIBRARY_INDEX_PATH);
  const exact = findExactDuplicate(index, sourceSha256);
  if (exact) {
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

function enqueueImport(task: () => Promise<void>): Promise<void> {
  const pending = importQueue.then(task, task);
  importQueue = pending.catch(() => {});
  return pending;
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
  sendJson(response, 200, { book, documents, report });
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
  if (!settings) throw new HttpError(400, "阅读设置必须包含 1–99 的整数回退段数和快进段数。");
  await writeReaderSettings(SETTINGS_PATH, settings);
  sendJson(response, 200, settings);
}

function localBookApi(): Plugin {
  return {
    name: "airnobe-local-book-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        try {
          if (request.method === "POST" && url.pathname === "/api/import-epub") {
            await enqueueImport(() => importEpub(request, response));
            return;
          }
          if (request.method === "GET" && url.pathname === "/api/settings") {
            await sendReaderSettings(response);
            return;
          }
          if (request.method === "PUT" && url.pathname === "/api/settings") {
            await updateReaderSettings(request, response);
            return;
          }
          const bookMatch = /^\/api\/books\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(url.pathname);
          if (request.method === "GET" && bookMatch) {
            await sendBookBundle(bookMatch[1] as string, response);
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
          next();
        } catch (error) {
          const status = error instanceof HttpError ? error.status : 500;
          sendJson(response, status, { error: (error as Error).message });
        }
      });
    },
  };
}

const server = await createServer({
  root: APP_DIRECTORY,
  plugins: [localBookApi()],
  server: { host: "127.0.0.1", strictPort: true },
});

await server.listen();
server.printUrls();
console.log(`转换结果目录：${LIBRARY_DIRECTORY}`);
