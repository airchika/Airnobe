import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadNoveliaEpubFile } from "./novelia-client.js";

afterEach(() => vi.restoreAllMocks());

describe("Novelia client", () => {
  it("creates an EPUB File using the server filename", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([0x50, 0x4b]), {
      status: 200,
      headers: {
        "content-type": "application/epub+zip",
        "x-airnobe-filename": encodeURIComponent("zh-jp.Ysg.再见巫师.epub"),
      },
    }));
    const file = await downloadNoveliaEpubFile("n.novelia.cc/novel/syosetu/n5562he");
    expect(file.name).toBe("zh-jp.Ysg.再见巫师.epub");
    expect(file.type).toBe("application/epub+zip");
    expect(fetchMock).toHaveBeenCalledWith("/api/novelia/epub", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ url: "n.novelia.cc/novel/syosetu/n5562he" }),
    }));
  });

  it("preserves the server error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "网站暂时不可用" }), { status: 502, headers: { "content-type": "application/json" } }));
    await expect(downloadNoveliaEpubFile("bad")).rejects.toThrow("网站暂时不可用");
  });
});
