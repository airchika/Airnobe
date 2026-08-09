import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import JSZip from "jszip";

const desktopDirectory = resolve(import.meta.dirname, "..");
const repositoryDirectory = resolve(desktopDirectory, "../..");
const sourcePath = resolve(repositoryDirectory, "Airnobe Start.md");
const outputPath = resolve(desktopDirectory, "src-tauri/resources/airnobe-getting-started.epub");
const fixedDate = new Date("2000-01-01T00:00:00.000Z");

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function japaneseInline(value) {
  const rubyPattern = /<ruby>([^<>]+)<rt>([^<>]+)<\/rt><\/ruby>/gu;
  let result = "";
  let offset = 0;
  for (const match of value.matchAll(rubyPattern)) {
    result += escapeXml(value.slice(offset, match.index));
    result += `<ruby>${escapeXml(match[1])}<rt>${escapeXml(match[2])}</rt></ruby>`;
    offset = match.index + match[0].length;
  }
  return result + escapeXml(value.slice(offset));
}

function parseGuide(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const body = [];
  const toc = [];
  let japanese;
  let headingIndex = 0;
  let hasContent = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("# ")) {
      body.push(`<h1 id="title">${escapeXml(line.slice(2).trim())}</h1>`);
      hasContent = true;
      continue;
    }
    if (line.startsWith("## ")) {
      if (japanese) throw new Error(`日文段落缺少中文译文：${japanese}`);
      if (hasContent) body.push("<p><br/></p>");
      const label = line.slice(3).trim();
      const id = `section-${String(++headingIndex).padStart(2, "0")}`;
      toc.push({ id, label });
      body.push(`<h2 id="${id}">${escapeXml(label)}</h2>`);
      hasContent = true;
      continue;
    }
    if (line.startsWith("> ")) {
      if (japanese) throw new Error(`相邻日文段落之间缺少中文译文：${japanese}`);
      japanese = line.slice(2).trim();
      continue;
    }
    if (!japanese) throw new Error(`中文段落前缺少对应日文：${line}`);
    body.push(`<p style="opacity:0.4">${japaneseInline(japanese)}</p>`);
    body.push(`<p>${escapeXml(line)}</p>`);
    japanese = undefined;
    hasContent = true;
  }
  if (japanese) throw new Error(`文档末尾的日文段落缺少中文译文：${japanese}`);
  if (toc.length === 0) throw new Error("入门文档没有章节。");
  return { body: body.join("\n    "), toc };
}

function xhtml(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">\n<head><meta charset="UTF-8"/><title>Airnobe Start</title><link rel="stylesheet" type="text/css" href="../styles/book.css"/></head>\n<body>\n    ${body}\n</body>\n</html>\n`;
}

function addFile(zip, name, value, compression = "DEFLATE") {
  zip.file(name, value, { date: fixedDate, compression, createFolders: false });
}

export async function buildGuideEpub() {
  const parsed = parseGuide(await readFile(sourcePath, "utf8"));
  const zip = new JSZip();
  addFile(zip, "mimetype", "application/epub+zip", "STORE");
  addFile(zip, "META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n`);
  addFile(zip, "EPUB/package.opf", `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:airnobe:getting-started</dc:identifier><dc:title>Airnobe Start</dc:title><dc:creator>Airnobe</dc:creator><dc:language>zh-CN</dc:language><dc:language>ja-JP</dc:language><meta property="dcterms:modified">2000-01-01T00:00:00Z</meta></metadata>\n<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="images/cover.svg" media-type="image/svg+xml" properties="cover-image"/><item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/><item id="content" href="text/introduction.xhtml" media-type="application/xhtml+xml"/><item id="style" href="styles/book.css" media-type="text/css"/></manifest>\n<spine><itemref idref="cover-page"/><itemref idref="content"/></spine>\n</package>\n`);
  addFile(zip, "EPUB/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN"><head><meta charset="UTF-8"/><title>目录</title></head><body><nav epub:type="toc" id="toc"><h1>目录</h1><ol><li><a href="text/introduction.xhtml#title">Airnobe Start</a><ol>${parsed.toc.map((item) => `<li><a href="text/introduction.xhtml#${item.id}">${escapeXml(item.label)}</a></li>`).join("")}</ol></li></ol></nav></body></html>\n`);
  addFile(zip, "EPUB/text/cover.xhtml", xhtml(`<section class="cover"><img src="../images/cover.svg" alt="Airnobe Start"/></section>`));
  addFile(zip, "EPUB/text/introduction.xhtml", xhtml(parsed.body));
  addFile(zip, "EPUB/styles/book.css", `@charset "UTF-8";\nbody { margin: 6%; line-height: 1.7; }\nh1, h2 { break-after: avoid; }\np { margin: 0.7em 0; }\nruby { ruby-align: center; }\n.cover { margin: 0; min-height: 90vh; display: flex; align-items: center; justify-content: center; }\n.cover img { width: 100%; max-height: 90vh; object-fit: contain; }\n`);
  addFile(zip, "EPUB/images/cover.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600" role="img" aria-label="Airnobe Start"><rect width="1200" height="1600" fill="#202126"/><rect x="76" y="76" width="1048" height="1448" rx="34" fill="none" stroke="#d7a85c" stroke-width="8"/><text x="600" y="760" fill="#d7a85c" font-family="sans-serif" font-size="420" font-weight="700" text-anchor="middle">A</text><text x="600" y="1010" fill="#f1eee8" font-family="sans-serif" font-size="92" font-weight="600" text-anchor="middle">Airnobe Start</text><text x="600" y="1110" fill="#d7a85c" font-family="sans-serif" font-size="42" text-anchor="middle">GETTING STARTED</text></svg>\n`);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  console.log(`已生成入门 EPUB：${outputPath}`);
  return outputPath;
}

await buildGuideEpub();
