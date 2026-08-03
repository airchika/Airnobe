import JSZip from "jszip";
import type { ConversionWarning, TocItem } from "@airnobe/book-format";
import type { ManifestItem, PackageInfo, ParsedNavigation } from "./types.js";
import {
  attr,
  descendantElements,
  elementChildren,
  hrefParts,
  localName,
  normalizeZipPath,
  normalizedText,
  resolveEpubPath,
} from "./util.js";
import { parseXml } from "./xml.js";

export async function loadEpub(bytes: Uint8Array, warnings: ConversionWarning[]): Promise<JSZip> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  for (const entry of Object.values(zip.files)) {
    const unsafeName = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    if (unsafeName && normalizeZipPath(unsafeName) !== entry.name) {
      throw new Error(`Unsafe path in EPUB archive: ${unsafeName}`);
    }
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const mimetype = zip.file("mimetype");
  const compression = mimetype
    ? (mimetype as JSZip.JSZipObject & { _data?: { compression?: { magic?: string } } })._data?.compression?.magic
    : undefined;
  if (!mimetype || entries[0]?.name !== "mimetype" || compression !== "\u0000\u0000") {
    warnings.push({
      code: "EPUB_MIMETYPE_NONCONFORMING",
      message: "EPUB mimetype entry is missing, not first, or compressed; conversion continues.",
    });
  } else {
    const value = await mimetype.async("string");
    if (value.trim() !== "application/epub+zip") {
      warnings.push({ code: "EPUB_MIMETYPE_INVALID", message: "EPUB mimetype content is invalid; conversion continues." });
    }
  }
  return zip;
}

async function readRequiredText(zip: JSZip, filePath: string): Promise<string> {
  const file = zip.file(filePath);
  if (!file) throw new Error(`Required EPUB entry is missing: ${filePath}`);
  return file.async("string");
}

export async function parsePackage(zip: JSZip): Promise<PackageInfo> {
  const containerPath = "META-INF/container.xml";
  const container = parseXml(await readRequiredText(zip, containerPath), containerPath);
  const rootfile = descendantElements(container, "rootfile")[0];
  const rawPackagePath = rootfile ? attr(rootfile, "full-path") : undefined;
  if (!rawPackagePath) throw new Error("container.xml does not declare an OPF rootfile");
  const packagePath = normalizeZipPath(rawPackagePath);
  const opf = parseXml(await readRequiredText(zip, packagePath), packagePath);
  const packageElement = opf.documentElement;
  const metadata = descendantElements(packageElement, "metadata")[0];
  const manifestElement = descendantElements(packageElement, "manifest")[0];
  const spineElement = descendantElements(packageElement, "spine")[0];
  if (!metadata || !manifestElement || !spineElement) throw new Error(`Incomplete OPF package: ${packagePath}`);

  const textValues = (name: string): string[] => descendantElements(metadata, name)
    .map(normalizedText)
    .filter(Boolean);
  const title = textValues("title")[0] ?? "";
  const authors = textValues("creator");
  const languages = textValues("language");
  const uniqueIdentifier = textValues("identifier")[0] ?? "";
  const manifest = new Map<string, ManifestItem>();
  for (const item of elementChildren(manifestElement).filter((node) => localName(node) === "item")) {
    const id = attr(item, "id");
    const href = attr(item, "href");
    const mediaType = attr(item, "media-type");
    if (!id || !href || !mediaType) continue;
    manifest.set(id, {
      id,
      href,
      path: resolveEpubPath(packagePath, href),
      mediaType,
      properties: new Set((attr(item, "properties") ?? "").split(/\s+/).filter(Boolean)),
    });
  }
  const spine = elementChildren(spineElement)
    .filter((node) => localName(node) === "itemref")
    .map((node) => {
      const idref = attr(node, "idref") ?? "";
      const item = manifest.get(idref);
      if (!item) throw new Error(`Spine references missing manifest item: ${idref}`);
      return { idref, linear: (attr(node, "linear") ?? "yes").toLowerCase() !== "no", item };
    });
  if (spine.length === 0) throw new Error("OPF spine is empty");

  const coverMeta = descendantElements(metadata, "meta")
    .find((node) => (attr(node, "name") ?? "").toLowerCase() === "cover");
  const coverId = coverMeta ? attr(coverMeta, "content") : undefined;
  const tocId = attr(spineElement, "toc");
  return {
    packagePath,
    title,
    authors,
    languages,
    uniqueIdentifier,
    manifest,
    spine,
    ...(tocId ? { tocId } : {}),
    ...(coverId ? { coverId } : {}),
  };
}

function mapTarget(
  href: string,
  navigationPath: string,
  documentIdByPath: Map<string, string>,
): TocItem["target"] | undefined {
  const parts = hrefParts(href);
  let targetPath: string;
  try {
    targetPath = resolveEpubPath(navigationPath, parts.path || navigationPath.split("/").at(-1) || "");
  } catch {
    return undefined;
  }
  const documentId = documentIdByPath.get(targetPath);
  if (!documentId) return undefined;
  return parts.fragment ? { documentId, fragmentId: parts.fragment } : { documentId };
}

function parseNavList(
  list: Element,
  navPath: string,
  documentIdByPath: Map<string, string>,
): TocItem[] {
  const items: TocItem[] = [];
  for (const li of elementChildren(list).filter((node) => localName(node) === "li")) {
    const direct = elementChildren(li);
    const labelElement = direct.find((node) => ["a", "span"].includes(localName(node)));
    const nested = direct.find((node) => ["ol", "ul"].includes(localName(node)));
    const href = labelElement && localName(labelElement) === "a" ? attr(labelElement, "href") : undefined;
    const target = href ? mapTarget(href, navPath, documentIdByPath) : undefined;
    items.push({
      label: labelElement ? normalizedText(labelElement) : normalizedText(li),
      ...(target ? { target } : {}),
      children: nested ? parseNavList(nested, navPath, documentIdByPath) : [],
    });
  }
  return items;
}

function findEpub3Toc(document: Document): Element | undefined {
  return descendantElements(document, "nav").find((nav) => {
    const type = attr(nav, "type") ?? "";
    return type.split(/\s+/).includes("toc");
  });
}

function parseNcxPoints(
  parent: Element,
  ncxPath: string,
  documentIdByPath: Map<string, string>,
): TocItem[] {
  return elementChildren(parent)
    .filter((node) => localName(node) === "navpoint")
    .map((point) => {
      const labelNode = descendantElements(point, "navlabel")[0];
      const content = elementChildren(point).find((node) => localName(node) === "content");
      const src = content ? attr(content, "src") : undefined;
      const target = src ? mapTarget(src, ncxPath, documentIdByPath) : undefined;
      return {
        label: labelNode ? normalizedText(labelNode) : "",
        ...(target ? { target } : {}),
        children: parseNcxPoints(point, ncxPath, documentIdByPath),
      };
    });
}

export async function parseNavigation(
  zip: JSZip,
  packageInfo: PackageInfo,
  documentIdByPath: Map<string, string>,
  warnings: ConversionWarning[],
): Promise<ParsedNavigation> {
  const navItem = [...packageInfo.manifest.values()].find((item) => item.properties.has("nav"));
  if (navItem) {
    const navFile = zip.file(navItem.path);
    if (!navFile) throw new Error(`Navigation document is missing: ${navItem.path}`);
    const document = parseXml(await navFile.async("string"), navItem.path);
    const tocNav = findEpub3Toc(document);
    if (tocNav) {
      const list = elementChildren(tocNav).find((node) => ["ol", "ul"].includes(localName(node)));
      return { toc: list ? parseNavList(list, navItem.path, documentIdByPath) : [], navPath: navItem.path };
    }
    warnings.push({ code: "EPUB3_NAV_TOC_MISSING", message: "EPUB3 nav document has no toc navigation.", sourcePath: navItem.path });
  }

  const ncx = packageInfo.tocId ? packageInfo.manifest.get(packageInfo.tocId) : undefined;
  if (ncx) {
    const ncxFile = zip.file(ncx.path);
    if (!ncxFile) throw new Error(`NCX document is missing: ${ncx.path}`);
    const document = parseXml(await ncxFile.async("string"), ncx.path);
    const navMap = descendantElements(document, "navmap")[0];
    return { toc: navMap ? parseNcxPoints(navMap, ncx.path, documentIdByPath) : [] };
  }
  warnings.push({ code: "TOC_MISSING", message: "No EPUB3 nav or EPUB2 NCX table of contents was found." });
  return { toc: [] };
}
