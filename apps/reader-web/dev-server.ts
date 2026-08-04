import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BookManifestSchema, type BookManifest } from "@airnobe/book-format";
import { convertEpubBytes, writeConversionAtomically } from "@airnobe/epub-normalizer";
import { deriveFuriganaDirectory } from "@airnobe/furigana";
import { createServer, type Plugin } from "vite";

const APP_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_DIRECTORY = resolve(APP_DIRECTORY, "../..");
const LIBRARY_DIRECTORY = resolve(REPOSITORY_DIRECTORY, "AirnobeLibrary");
const MAX_EPUB_BYTES = 512 * 1024 * 1024;
const BOOK_ID_PATTERN = /^[a-f0-9]{16}$/;

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

function decodeFileName(request: IncomingMessage): string {
  const header = request.headers["x-airnobe-filename"];
  if (typeof header !== "string") return "book.epub";
  try {
    const name = decodeURIComponent(header).replace(/[\\/]/g, "_").trim();
    return name || "book.epub";
  } catch {
    return "book.epub";
  }
}

function libraryBookDirectory(kind: "base" | "furigana", bookId: string): string {
  if (!BOOK_ID_PATTERN.test(bookId)) throw new HttpError(404, "书籍不存在。");
  return resolve(LIBRARY_DIRECTORY, kind, bookId);
}

function legacyBookDirectory(bookId: string): string {
  if (!BOOK_ID_PATTERN.test(bookId)) throw new HttpError(404, "书籍不存在。");
  return resolve(LIBRARY_DIRECTORY, bookId);
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
  const bookId = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const baseDirectory = libraryBookDirectory("base", bookId);
  const furiganaDirectory = libraryBookDirectory("furigana", bookId);
  try {
    const cached = await readBook(furiganaDirectory);
    if (!cached.derivation || cached.derivation.type !== "furigana") throw new Error("Cached book has no furigana derivation.");
    sendJson(response, 200, { bookId });
    return;
  } catch {
    // Missing or invalid cached output is rebuilt below.
  }
  let furiganaInputDirectory = baseDirectory;
  try {
    await readBook(baseDirectory);
  } catch {
    const legacyDirectory = legacyBookDirectory(bookId);
    try {
      const legacyBook = await readBook(legacyDirectory);
      if (legacyBook.derivation) throw new Error("Legacy cache is already derived.");
      furiganaInputDirectory = legacyDirectory;
    } catch {
      const result = await convertEpubBytes(bytes, fileName);
      await writeConversionAtomically(baseDirectory, result, true);
    }
  }
  await deriveFuriganaDirectory(furiganaInputDirectory, furiganaDirectory, true);
  sendJson(response, 200, { bookId });
}

async function sendBookBundle(bookId: string, response: ServerResponse): Promise<void> {
  const directory = libraryBookDirectory("furigana", bookId);
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
  const directory = libraryBookDirectory("furigana", bookId);
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

function localBookApi(): Plugin {
  return {
    name: "airnobe-local-book-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        try {
          if (request.method === "POST" && url.pathname === "/api/import-epub") {
            await importEpub(request, response);
            return;
          }
          const bookMatch = /^\/api\/books\/([a-f0-9]{16})$/.exec(url.pathname);
          if (request.method === "GET" && bookMatch) {
            await sendBookBundle(bookMatch[1] as string, response);
            return;
          }
          const assetMatch = /^\/api\/books\/([a-f0-9]{16})\/assets\/([^/]+)$/.exec(url.pathname);
          if (request.method === "GET" && assetMatch) {
            await sendAsset(assetMatch[1] as string, decodeURIComponent(assetMatch[2] as string), response);
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
