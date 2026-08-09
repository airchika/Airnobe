async function responseError(response: Response): Promise<Error> {
  try {
    const value = await response.json() as { error?: unknown };
    if (typeof value.error === "string" && value.error) return new Error(value.error);
  } catch {
    // Fall through to the status-based message.
  }
  return new Error(`轻小说机翻机器人下载失败（${response.status}）。`);
}

function responseFileName(response: Response): string {
  const encoded = response.headers.get("x-airnobe-filename");
  if (!encoded) return "novelia.epub";
  try {
    const decoded = decodeURIComponent(encoded).replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
    return decoded.toLowerCase().endsWith(".epub") ? decoded : "novelia.epub";
  } catch {
    return "novelia.epub";
  }
}

export async function downloadNoveliaEpubFile(url: string): Promise<File> {
  const response = await fetch("/api/novelia/epub", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) throw await responseError(response);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/epub+zip") throw new Error("本地服务没有返回 EPUB 文件。");
  return new File([await response.arrayBuffer()], responseFileName(response), { type: "application/epub+zip" });
}
