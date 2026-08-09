const NOVELIA_ORIGIN = "https://n.novelia.cc";
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const MAX_REDIRECTS = 3;
const DEFAULT_MAX_EPUB_BYTES = 512 * 1024 * 1024;

export interface NoveliaNovelReference {
  providerId: string;
  novelId: string;
}

export interface NoveliaDownloadResult {
  bytes: Uint8Array;
  fileName: string;
}

export interface NoveliaDownloadOptions {
  fetch?: typeof fetch;
  metadataTimeoutMs?: number;
  downloadTimeoutMs?: number;
  maximumBytes?: number;
}

export class NoveliaDownloadError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "NoveliaDownloadError";
  }
}

export function parseNoveliaNovelUrl(input: string): NoveliaNovelReference {
  const trimmed = input.trim();
  if (!trimmed) throw new NoveliaDownloadError(400, "请输入轻小说机翻机器人的小说地址。");
  if (/^http:\/\//i.test(trimmed)) throw new NoveliaDownloadError(400, "小说地址必须使用 HTTPS。");
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https:\/\//i.test(trimmed)) {
    throw new NoveliaDownloadError(400, "小说地址必须使用 HTTPS。");
  }

  let url: URL;
  try {
    url = new URL(/^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new NoveliaDownloadError(400, "小说地址格式无效。");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "n.novelia.cc" || url.port || url.username || url.password) {
    throw new NoveliaDownloadError(400, "只支持 n.novelia.cc 的 HTTPS 小说地址。");
  }
  if (url.pathname.includes("%")) throw new NoveliaDownloadError(400, "小说地址包含不安全的路径编码。");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 3 || segments[0] !== "novel") {
    throw new NoveliaDownloadError(400, "请输入小说主页地址，不支持文库或单章地址。");
  }
  const providerId = segments[1] ?? "";
  const novelId = segments[2] ?? "";
  if (!ID_PATTERN.test(providerId) || !ID_PATTERN.test(novelId)) {
    throw new NoveliaDownloadError(400, "小说来源或编号格式无效。");
  }
  return { providerId, novelId };
}

export function sanitizeNoveliaTitle(value: string): string {
  const cleaned = value
    .replace(/[\/|\\:*?"<>\u0000-\u001f\u007f]/g, "")
    .replace(/[. ]+$/g, "")
    .trim();
  return [...(cleaned || "未命名小说")].slice(0, 140).join("");
}

export function buildNoveliaDownloadUrl(reference: NoveliaNovelReference, fileName: string): URL {
  const url = new URL(`/api/novel/${reference.providerId}/${reference.novelId}/file`, NOVELIA_ORIGIN);
  url.searchParams.append("mode", "zh-jp");
  url.searchParams.append("translationsMode", "priority");
  url.searchParams.append("translations", "sakura");
  url.searchParams.append("translations", "gpt");
  url.searchParams.append("type", "epub");
  url.searchParams.append("filename", fileName);
  return url;
}

function validateUpstreamUrl(url: URL): void {
  if (url.origin !== NOVELIA_ORIGIN) {
    throw new NoveliaDownloadError(502, "轻小说机翻机器人返回了不安全的重定向地址。");
  }
}

async function fetchWithRedirects(fetchImpl: typeof fetch, initialUrl: URL, signal: AbortSignal, accept: string): Promise<Response> {
  let current = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    validateUpstreamUrl(current);
    const response = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { accept },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects === MAX_REDIRECTS) throw new NoveliaDownloadError(502, "轻小说机翻机器人的下载重定向次数过多。");
    const location = response.headers.get("location");
    if (!location) throw new NoveliaDownloadError(502, "轻小说机翻机器人返回了无效的重定向响应。");
    current = new URL(location, current);
  }
  throw new NoveliaDownloadError(502, "轻小说机翻机器人的下载重定向次数过多。");
}

function upstreamFailure(response: Response, target: "metadata" | "epub"): NoveliaDownloadError {
  if (response.status === 404) return new NoveliaDownloadError(404, "轻小说机翻机器人上没有找到这本小说。");
  const label = target === "metadata" ? "小说信息" : "EPUB";
  return new NoveliaDownloadError(502, `轻小说机翻机器人无法提供${label}（HTTP ${response.status}）。`);
}

async function fetchMetadata(fetchImpl: typeof fetch, url: URL, timeoutMs: number): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchWithRedirects(fetchImpl, url, controller.signal, "application/json");
    if (!response.ok) throw upstreamFailure(response, "metadata");
    const value = await response.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new NoveliaDownloadError(502, "轻小说机翻机器人返回了无效的小说信息。");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new NoveliaDownloadError(504, "读取轻小说机翻机器人的小说信息超时。");
    }
    if (error instanceof NoveliaDownloadError) throw error;
    throw new NoveliaDownloadError(502, `无法连接轻小说机翻机器人：${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedBody(response: Response, maximumBytes: number, controller: AbortController): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    controller.abort();
    throw new NoveliaDownloadError(413, "下载的 EPUB 超过 512 MB。当前版本暂不支持。");
  }
  if (!response.body) throw new NoveliaDownloadError(502, "轻小说机翻机器人返回了空的 EPUB 响应。");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maximumBytes) {
        controller.abort();
        throw new NoveliaDownloadError(413, "下载的 EPUB 超过 512 MB。当前版本暂不支持。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function downloadEpub(
  fetchImpl: typeof fetch,
  url: URL,
  timeoutMs: number,
  maximumBytes: number,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchWithRedirects(fetchImpl, url, controller.signal, "application/epub+zip, application/octet-stream;q=0.9");
    if (!response.ok) throw upstreamFailure(response, "epub");
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/html") || contentType.includes("application/json")) {
      throw new NoveliaDownloadError(502, "轻小说机翻机器人返回的内容不是 EPUB。");
    }
    const bytes = await readLimitedBody(response, maximumBytes, controller);
    if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new NoveliaDownloadError(502, "轻小说机翻机器人返回的内容不是有效的 EPUB 文件。");
    }
    return bytes;
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof NoveliaDownloadError && error.status === 413)) {
      throw new NoveliaDownloadError(504, "轻小说机翻机器人的 EPUB 生成或下载超时。");
    }
    if (error instanceof NoveliaDownloadError) throw error;
    throw new NoveliaDownloadError(502, `无法下载轻小说机翻机器人的 EPUB：${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadNoveliaEpub(input: string, options: NoveliaDownloadOptions = {}): Promise<NoveliaDownloadResult> {
  const reference = parseNoveliaNovelUrl(input);
  const fetchImpl = options.fetch ?? fetch;
  const metadataUrl = new URL(`/api/novel/${reference.providerId}/${reference.novelId}`, NOVELIA_ORIGIN);
  const record = await fetchMetadata(fetchImpl, metadataUrl, options.metadataTimeoutMs ?? 30_000);
  const rawTitle = typeof record.titleZh === "string" && record.titleZh.trim()
    ? record.titleZh
    : typeof record.titleJp === "string" && record.titleJp.trim()
      ? record.titleJp
      : "未命名小说";
  const fileName = `zh-jp.Ysg.${sanitizeNoveliaTitle(rawTitle)}.epub`;
  return {
    bytes: await downloadEpub(
      fetchImpl,
      buildNoveliaDownloadUrl(reference, fileName),
      options.downloadTimeoutMs ?? 5 * 60_000,
      options.maximumBytes ?? DEFAULT_MAX_EPUB_BYTES,
    ),
    fileName,
  };
}
