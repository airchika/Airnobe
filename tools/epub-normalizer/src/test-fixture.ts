import JSZip from "jszip";

interface FixtureOptions {
  epub2?: boolean;
  direction?: "zh-jp" | "jp-zh";
  translations?: number;
  pureChinese?: boolean;
  malformedChapter?: boolean;
  rubyMarkup?: string;
  bodyMarkup?: string;
}

export async function makeEpubFixture(options: FixtureOptions = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const epub2 = options.epub2 ?? false;
  const navManifest = epub2
    ? `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`
    : `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`;
  const navSpine = epub2 ? "" : `<itemref idref="nav"/>`;
  zip.file("OPS/package.opf", `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${epub2 ? "2.0" : "3.0"}" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">fixture-id</dc:identifier><dc:title>Fixture</dc:title>
    <dc:creator>Airnobe</dc:creator><dc:language>${options.pureChinese ? "zh-CN" : "ja-JP"}</dc:language>
  </metadata>
  <manifest>${navManifest}<item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="pic" href="Images/pic.png" media-type="image/png" properties="cover-image"/></manifest>
  <spine${epub2 ? ` toc="ncx"` : ""}>${navSpine}<itemref idref="chapter"/></spine>
</package>`);
  if (epub2) {
    zip.file("OPS/toc.ncx", `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="one"><navLabel><text>第一章</text></navLabel><content src="Text/chapter.xhtml#start"/></navPoint></navMap></ncx>`);
  } else {
    zip.file("OPS/nav.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="Text/chapter.xhtml#start">第一章</a></li></ol></nav></body></html>`);
  }
  const rubyMarkup = options.rubyMarkup ?? `<ruby>帰<rt>き</rt>還<rt>かん</rt></ruby>`;
  const source = `<p id="start" style="opacity:0.4;">日${rubyMarkup} 本</p>`;
  const translations = Array.from({ length: options.translations ?? 1 }, (_, index) => `<p>中文译文${index + 1}</p>`).join("");
  let body: string;
  if (options.bodyMarkup !== undefined) body = options.bodyMarkup;
  else if (options.pureChinese) body = `<h1 id="start">第一章</h1><p>纯中文正文。</p>`;
  else body = (options.direction ?? "zh-jp") === "zh-jp" ? `${translations}${source}` : `${source}${translations}`;
  const fixtureExtras = options.bodyMarkup === undefined
    ? `<p>保留 <strong>强调</strong><br/>换行 <img src="../Images/pic.png" alt="字"/></p><svg xmlns="http://www.w3.org/2000/svg"><image href="../Images/pic.png"/></svg>`
    : "";
  const chapter = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><section>${body}${fixtureExtras}</section></body></html>`;
  zip.file("OPS/Text/chapter.xhtml", options.malformedChapter ? chapter.replace("</body>", "") : chapter);
  zip.file("OPS/Images/pic.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
