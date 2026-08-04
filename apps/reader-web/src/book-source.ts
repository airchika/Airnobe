import {
  AIRNOBE_FORMAT_VERSION,
  BookDocumentSchema,
  BookManifestSchema,
  ConversionReportSchema,
  validateBookGraph,
  type BookDocument,
  type BookManifest,
  type ConversionReport,
  type InlineNode,
} from "@airnobe/book-format";

export interface LoadedBook {
  book: BookManifest;
  documents: BookDocument[];
  documentById: Map<string, BookDocument>;
  assetUrlById: Map<string, string>;
  report?: ConversionReport;
  sourceLabel: string;
  sourceEpubUrl?: string;
  dispose(): void;
}

export interface LibraryBookSummary {
  id: string;
  title: string;
  authors: string[];
}

export type EpubImportResult =
  | { outcome: "imported"; loaded: LoadedBook; warning?: string }
  | { outcome: "exact-duplicate"; book: LibraryBookSummary }
  | { outcome: "possible-duplicate"; candidates: LibraryBookSummary[] };

export type DuplicateResolution =
  | { action: "add" }
  | { action: "replace"; bookId: string };

interface BookBundle {
  book: unknown;
  documents: unknown;
  report?: unknown;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`不安全的文件路径：${value}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`不安全的文件路径：${value}`);
  }
  return normalized;
}

function selectedPath(file: File): string {
  return normalizeRelativePath(file.webkitRelativePath || file.name);
}

function locateBookRoot(files: File[]): { rootPrefix: string; sourceLabel: string } {
  const candidates = files
    .map(selectedPath)
    .filter((filePath) => filePath === "book.json" || filePath.endsWith("/book.json"))
    .sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right));
  if (candidates.length === 0) throw new Error("所选目录中没有 book.json。请选择 P0 或 P0.5 的书籍目录。");
  const shortestDepth = candidates[0]?.split("/").length;
  const shortest = candidates.filter((candidate) => candidate.split("/").length === shortestDepth);
  if (shortest.length > 1) throw new Error("所选目录包含多本书，请一次只选择一个书籍目录。");
  const bookPath = shortest[0] as string;
  const slash = bookPath.lastIndexOf("/");
  return slash < 0
    ? { rootPrefix: "", sourceLabel: "本地目录" }
    : { rootPrefix: bookPath.slice(0, slash + 1), sourceLabel: bookPath.slice(0, slash).split("/").at(-1) ?? "本地目录" };
}

async function parseJsonFile<T>(file: File | undefined, parser: { parse(value: unknown): T }, label: string): Promise<T> {
  if (!file) throw new Error(`书籍缺少 ${label}。`);
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON：${(error as Error).message}`);
  }
  try {
    return parser.parse(value);
  } catch (error) {
    throw new Error(`${label} 不符合 Airnobe 格式：${(error as Error).message}`);
  }
}

async function parseBookFile(file: File | undefined): Promise<BookManifest> {
  if (!file) throw new Error("书籍缺少 book.json。");
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`book.json 不是有效 JSON：${(error as Error).message}`);
  }
  if (
    typeof value === "object"
    && value !== null
    && "format" in value
    && (value as { format?: unknown }).format === "airnobe-book"
    && "version" in value
    && (value as { version?: unknown }).version !== AIRNOBE_FORMAT_VERSION
  ) {
    throw new Error(`这是旧版 Airnobe 转换结果（格式版本 ${(value as { version?: unknown }).version}）。请重新导入原始 EPUB。`);
  }
  try {
    return BookManifestSchema.parse(value);
  } catch (error) {
    throw new Error(`book.json 不符合 Airnobe 格式：${(error as Error).message}`);
  }
}

function createLoadedBook(
  bookValue: unknown,
  documentValues: unknown,
  reportValue: unknown,
  sourceLabel: string,
  assetUrl: (assetId: string) => string,
  dispose: () => void,
): LoadedBook {
  const book = BookManifestSchema.parse(bookValue);
  if (!Array.isArray(documentValues)) throw new Error("书籍文档列表无效。");
  const documents = documentValues.map((document) => BookDocumentSchema.parse(document));
  const graphErrors = validateBookGraph(book, documents);
  if (graphErrors.length > 0) throw new Error(`书籍引用校验失败：\n${graphErrors.join("\n")}`);
  const report = reportValue === undefined ? undefined : ConversionReportSchema.parse(reportValue);
  return {
    book,
    documents,
    documentById: new Map(documents.map((document) => [document.id, document])),
    assetUrlById: new Map(book.assets.map((asset) => [asset.id, assetUrl(asset.id)])),
    ...(report ? { report } : {}),
    sourceLabel,
    dispose,
  };
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

export async function loadBookFromApi(bookId: string): Promise<LoadedBook> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookId)) throw new Error("本地书籍编号无效。");
  const value = await responseJson(await fetch(`/api/books/${bookId}`)) as BookBundle;
  const loaded = createLoadedBook(
    value.book,
    value.documents,
    value.report,
    "本地 EPUB",
    (assetId) => `/api/books/${bookId}/assets/${encodeURIComponent(assetId)}`,
    () => {},
  );
  loaded.sourceEpubUrl = `/api/books/${bookId}/source`;
  return loaded;
}

function parseBookSummary(value: unknown): LibraryBookSummary {
  if (typeof value !== "object" || value === null) throw new Error("本地服务返回了无效的书籍信息。");
  const summary = value as Partial<LibraryBookSummary>;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(summary.id)) || typeof summary.title !== "string" || !Array.isArray(summary.authors)) {
    throw new Error("本地服务返回了无效的书籍信息。");
  }
  return { id: String(summary.id), title: summary.title, authors: summary.authors.map(String) };
}

export async function importEpubFile(file: File, resolution?: DuplicateResolution): Promise<EpubImportResult> {
  if (!file.name.toLowerCase().endsWith(".epub")) throw new Error("请选择 EPUB 文件。");
  const headers: Record<string, string> = { "x-airnobe-filename": encodeURIComponent(file.name) };
  if (resolution) {
    headers["x-airnobe-duplicate-action"] = resolution.action;
    if (resolution.action === "replace") headers["x-airnobe-replace-book-id"] = resolution.bookId;
  }
  const value = await responseJson(await fetch("/api/import-epub", {
    method: "POST",
    headers,
    body: file,
  }));
  if (typeof value !== "object" || value === null || !("outcome" in value)) {
    throw new Error("本地服务没有返回导入结果。");
  }
  const response = value as Record<string, unknown>;
  if (response.outcome === "exact-duplicate") {
    return { outcome: "exact-duplicate", book: parseBookSummary(response.book) };
  }
  if (response.outcome === "possible-duplicate") {
    if (!Array.isArray(response.candidates) || response.candidates.length === 0) throw new Error("疑似重复书籍列表无效。");
    return { outcome: "possible-duplicate", candidates: response.candidates.map(parseBookSummary) };
  }
  if (response.outcome !== "imported" || typeof response.bookId !== "string") {
    throw new Error("本地服务没有返回书籍编号。");
  }
  const loaded = await loadBookFromApi(response.bookId);
  return {
    outcome: "imported",
    loaded,
    ...(typeof response.warning === "string" ? { warning: response.warning } : {}),
  };
}

export async function loadBookFromFiles(input: Iterable<File>): Promise<LoadedBook> {
  const files = [...input];
  if (files.length === 0) throw new Error("没有选择任何文件。");
  const { rootPrefix, sourceLabel } = locateBookRoot(files);
  const fileByPath = new Map<string, File>();
  for (const file of files) {
    const fullPath = selectedPath(file);
    if (!fullPath.startsWith(rootPrefix)) continue;
    const relativePath = normalizeRelativePath(fullPath.slice(rootPrefix.length));
    if (fileByPath.has(relativePath)) throw new Error(`书籍中存在重复路径：${relativePath}`);
    fileByPath.set(relativePath, file);
  }

  const book = await parseBookFile(fileByPath.get("book.json"));
  const documents: BookDocument[] = [];
  for (const entry of book.readingOrder) {
    documents.push(await parseJsonFile(fileByPath.get(entry.path), BookDocumentSchema, entry.path));
  }
  const graphErrors = validateBookGraph(book, documents);
  if (graphErrors.length > 0) throw new Error(`书籍引用校验失败：\n${graphErrors.join("\n")}`);

  const objectUrls: string[] = [];
  const assetUrlById = new Map<string, string>();
  try {
    for (const asset of book.assets) {
      const file = fileByPath.get(asset.path);
      if (!file) throw new Error(`书籍缺少资源：${asset.path}`);
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      assetUrlById.set(asset.id, url);
    }
  } catch (error) {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    throw error;
  }

  const reportFile = fileByPath.get("report.json");
  const report = reportFile
    ? await parseJsonFile(reportFile, ConversionReportSchema, "report.json")
    : undefined;
  return createLoadedBook(
    book,
    documents,
    report,
    sourceLabel,
    (assetId) => assetUrlById.get(assetId) as string,
    () => {
      for (const url of objectUrls) URL.revokeObjectURL(url);
    },
  );
}

export function hasAssistedRuby(book: LoadedBook): boolean {
  const visit = (nodes: InlineNode[]): boolean => nodes.some((node) => {
    if (node.type === "ruby") return node.origin !== "source";
    if (node.type === "emphasis" || node.type === "link") return visit(node.children);
    return false;
  });
  return book.documents.some((document) => document.blocks.some((block) =>
    block.type === "text" && block.variants.some((variant) => visit(variant.content))));
}
