import {
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
  dispose(): void;
}

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
  if (!/^[a-f0-9]{16}$/.test(bookId)) throw new Error("本地书籍编号无效。");
  const value = await responseJson(await fetch(`/api/books/${bookId}`)) as BookBundle;
  return createLoadedBook(
    value.book,
    value.documents,
    value.report,
    "本地 EPUB",
    (assetId) => `/api/books/${bookId}/assets/${encodeURIComponent(assetId)}`,
    () => {},
  );
}

export async function importEpubFile(file: File): Promise<LoadedBook> {
  if (!file.name.toLowerCase().endsWith(".epub")) throw new Error("请选择 EPUB 文件。");
  const value = await responseJson(await fetch("/api/import-epub", {
    method: "POST",
    headers: { "x-airnobe-filename": encodeURIComponent(file.name) },
    body: file,
  }));
  if (typeof value !== "object" || value === null || !("bookId" in value)) {
    throw new Error("本地服务没有返回书籍编号。");
  }
  return loadBookFromApi(String((value as { bookId: unknown }).bookId));
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

  const book = await parseJsonFile(fileByPath.get("book.json"), BookManifestSchema, "book.json");
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

export function hasGeneratedRuby(book: LoadedBook): boolean {
  const visit = (nodes: InlineNode[]): boolean => nodes.some((node) => {
    if (node.type === "ruby") return node.origin === "generated";
    if (node.type === "emphasis" || node.type === "link") return visit(node.children);
    return false;
  });
  return book.documents.some((document) => document.blocks.some((block) =>
    block.type === "text" && block.variants.some((variant) => visit(variant.content))));
}
