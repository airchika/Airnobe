import { describe, expect, it, vi } from "vitest";
import {
  buildNoveliaDownloadUrl,
  downloadNoveliaEpub,
  NoveliaDownloadError,
  parseNoveliaNovelUrl,
  sanitizeNoveliaTitle,
} from "./novelia-download.js";

const epubBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

describe("Novelia download", () => {
  it.each([
    "https://n.novelia.cc/novel/syosetu/n5562he",
    "n.novelia.cc/novel/syosetu/n5562he/",
    "n.novelia.cc/novel/syosetu/n5562he?from=test#toc",
  ])("accepts a novel home URL: %s", (input) => {
    expect(parseNoveliaNovelUrl(input)).toEqual({ providerId: "syosetu", novelId: "n5562he" });
  });

  it.each([
    "http://n.novelia.cc/novel/syosetu/n5562he",
    "https://example.com/novel/syosetu/n5562he",
    "https://user@n.novelia.cc/novel/syosetu/n5562he",
    "https://n.novelia.cc/novel/syosetu/n5562he/chapter-1",
    "https://n.novelia.cc/wenku/1",
    "https://n.novelia.cc/novel/syosetu/n5562he%2fchapter",
  ])("rejects an unsafe or unsupported URL: %s", (input) => {
    expect(() => parseNoveliaNovelUrl(input)).toThrow(NoveliaDownloadError);
  });

  it("builds the fixed Sakura then GPT priority parameters", () => {
    const url = buildNoveliaDownloadUrl({ providerId: "syosetu", novelId: "n5562he" }, "zh-jp.Ysg.再见巫师.epub");
    expect(url.href).toBe("https://n.novelia.cc/api/novel/syosetu/n5562he/file?mode=zh-jp&translationsMode=priority&translations=sakura&translations=gpt&type=epub&filename=zh-jp.Ysg.%E5%86%8D%E8%A7%81%E5%B7%AB%E5%B8%88.epub");
  });

  it("prefers the Chinese title, sanitizes the filename, and downloads an EPUB", async () => {
    const calls: URL[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      calls.push(new URL(String(input)));
      if (calls.length === 1) return new Response(JSON.stringify({ titleZh: "再见:巫师?", titleJp: "さよなら" }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(epubBytes, { status: 200, headers: { "content-type": "application/epub+zip" } });
    });
    const result = await downloadNoveliaEpub("n.novelia.cc/novel/syosetu/n5562he", { fetch: fetchMock as typeof fetch });
    expect(result.fileName).toBe("zh-jp.Ysg.再见巫师.epub");
    expect(result.bytes).toEqual(epubBytes);
    expect(calls[1]?.searchParams.getAll("translations")).toEqual(["sakura", "gpt"]);
  });

  it("falls back to the Japanese title and follows only same-origin redirects", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ titleJp: "さよなら" }), { status: 200 });
      if (call === 2) return new Response(null, { status: 302, headers: { location: "/files-temp/web/book.epub" } });
      return new Response(epubBytes, { status: 200, headers: { "content-type": "application/octet-stream" } });
    });
    await expect(downloadNoveliaEpub("n.novelia.cc/novel/syosetu/n5562he", { fetch: fetchMock as typeof fetch })).resolves.toMatchObject({ fileName: "zh-jp.Ysg.さよなら.epub" });

    call = 0;
    const unsafeFetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ titleZh: "测试" }), { status: 200 });
      return new Response(null, { status: 302, headers: { location: "https://example.com/book.epub" } });
    });
    await expect(downloadNoveliaEpub("n.novelia.cc/novel/syosetu/n5562he", { fetch: unsafeFetch as typeof fetch })).rejects.toThrow("不安全的重定向地址");
  });

  it("rejects oversized and non-EPUB responses", async () => {
    const oversizedFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => oversizedFetch.mock.calls.length === 1
      ? new Response(JSON.stringify({ titleZh: "测试" }), { status: 200 })
      : new Response(epubBytes, { status: 200, headers: { "content-length": "100" } }));
    await expect(downloadNoveliaEpub("n.novelia.cc/novel/syosetu/n5562he", { fetch: oversizedFetch as typeof fetch, maximumBytes: 10 })).rejects.toMatchObject({ status: 413 });

    const invalidFetch = vi.fn(async () => invalidFetch.mock.calls.length === 1
      ? new Response(JSON.stringify({ titleZh: "测试" }), { status: 200 })
      : new Response("not an epub", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(downloadNoveliaEpub("n.novelia.cc/novel/syosetu/n5562he", { fetch: invalidFetch as typeof fetch })).rejects.toThrow("不是 EPUB");
  });

  it("reports metadata timeout without waiting for the default deadline", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    await expect(downloadNoveliaEpub("n.novelia.cc/novel/syosetu/n5562he", {
      fetch: fetchMock as typeof fetch,
      metadataTimeoutMs: 5,
    })).rejects.toMatchObject({ status: 504 });
  });

  it("cleans filesystem-reserved title characters", () => {
    expect(sanitizeNoveliaTitle("  a/b\\c:*?\"<>|.  ")).toBe("abc");
  });
});
