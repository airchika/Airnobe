import path from "node:path";
import type JSZip from "jszip";
import type {
  BookAsset,
  BookDocument,
  ContentVariant,
  ConversionWarning,
  DocumentRole,
  InlineNode,
  LinkTarget,
  SourceRef,
  TextBlock,
} from "@airnobe/book-format";
import type { AssetPayload, ConversionState, ManifestItem, PackageInfo } from "./types.js";
import {
  attr,
  descendantElements,
  elementChildren,
  hrefParts,
  localName,
  normalizedText,
  resolveEpubPath,
  sha256,
  stableId,
} from "./util.js";
import { parseXml } from "./xml.js";

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

interface Candidate {
  element: Element;
  nodeIndex: number;
  parent: Node;
  role: "paragraph" | "heading" | "caption";
}

interface InlineContext {
  sourcePath: string;
  nodeIndex: number;
  documentIdByPath: Map<string, string>;
  assets: AssetRegistry;
  state: ConversionState;
}

export class AssetRegistry {
  readonly byId = new Map<string, AssetPayload>();
  private readonly byHash = new Map<string, AssetPayload>();
  private readonly manifestByPath: Map<string, ManifestItem>;

  constructor(
    private readonly zip: JSZip,
    manifest: Map<string, ManifestItem>,
    private readonly warnings: ConversionWarning[],
  ) {
    this.manifestByPath = new Map([...manifest.values()].map((item) => [item.path, item]));
  }

  async addReference(sourceDocument: string, href: string): Promise<BookAsset | undefined> {
    if (/^(?:https?:|data:|javascript:)/i.test(href)) {
      this.warnings.push({ code: "REMOTE_OR_UNSAFE_RESOURCE", message: `Resource was not embedded: ${href}`, sourcePath: sourceDocument });
      return undefined;
    }
    let sourcePath: string;
    try {
      sourcePath = resolveEpubPath(sourceDocument, hrefParts(href).path);
    } catch (error) {
      this.warnings.push({ code: "UNSAFE_RESOURCE_PATH", message: String(error), sourcePath: sourceDocument });
      return undefined;
    }
    const file = this.zip.file(sourcePath);
    if (!file) {
      this.warnings.push({ code: "MISSING_RESOURCE", message: `Referenced resource is missing: ${sourcePath}`, sourcePath: sourceDocument });
      return undefined;
    }
    const bytes = await file.async("uint8array");
    const hash = sha256(bytes);
    const existing = this.byHash.get(hash);
    if (existing) {
      if (!existing.descriptor.sourcePaths.includes(sourcePath)) {
        existing.descriptor.sourcePaths.push(sourcePath);
        existing.descriptor.sourcePaths.sort();
      }
      return existing.descriptor;
    }
    const manifestItem = this.manifestByPath.get(sourcePath);
    const extension = path.posix.extname(sourcePath).toLowerCase();
    const mediaType = manifestItem?.mediaType ?? IMAGE_MEDIA_TYPES[extension] ?? "application/octet-stream";
    if (!mediaType.startsWith("image/")) {
      this.warnings.push({ code: "UNSUPPORTED_RESOURCE", message: `Non-image resource was ignored: ${sourcePath}`, sourcePath: sourceDocument });
      return undefined;
    }
    const safeExtension = extension && /^[.][a-z0-9]+$/.test(extension) ? extension : extensionForMediaType(mediaType);
    const descriptor: BookAsset = {
      id: `asset-${hash}`,
      path: `assets/${hash}${safeExtension}`,
      mediaType,
      sourcePaths: [sourcePath],
    };
    const payload = { descriptor, bytes };
    this.byId.set(descriptor.id, payload);
    this.byHash.set(hash, payload);
    return descriptor;
  }

  values(): AssetPayload[] {
    return [...this.byId.values()].sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id));
  }
}

function extensionForMediaType(mediaType: string): string {
  switch (mediaType) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    case "image/svg+xml": return ".svg";
    default: return ".bin";
  }
}

function sourceRef(candidate: Candidate, sourcePath: string): SourceRef {
  const elementId = attr(candidate.element, "id");
  return {
    sourcePath,
    nodeIndex: candidate.nodeIndex,
    ...(elementId ? { elementId } : {}),
  };
}

function languageFromCode(value: string | undefined): "zh-CN" | "ja-JP" | "und" {
  if (!value) return "und";
  const code = value.trim().toLowerCase();
  if (code === "zh" || code.startsWith("zh-")) return "zh-CN";
  if (code === "ja" || code.startsWith("ja-")) return "ja-JP";
  return "und";
}

function languageForElement(element: Element, packageLanguages: string[]): "zh-CN" | "ja-JP" | "und" {
  let current: Node | null = element;
  while (current?.nodeType === 1) {
    const explicit = attr(current as Element, "lang");
    const mapped = languageFromCode(explicit);
    if (mapped !== "und") return mapped;
    current = current.parentNode;
  }
  const text = normalizedText(element);
  if (/[\u3040-\u30ff]/u.test(text)) return "ja-JP";
  const declared = packageLanguages.map(languageFromCode).filter((value) => value !== "und");
  if (new Set(declared).size === 1) return declared[0] ?? "und";
  return "und";
}

function isHidden(element: Element): boolean {
  const style = (attr(element, "style") ?? "").replace(/\s+/g, "").toLowerCase();
  return style.includes("display:none") || style.includes("visibility:hidden") || attr(element, "hidden") !== undefined;
}

function isAutoNovelAnchor(element: Element): boolean {
  if (localName(element) !== "p") return false;
  const style = attr(element, "style") ?? "";
  const match = /(?:^|;)\s*opacity\s*:\s*([^;!]+)/i.exec(style);
  return !!match && Number.parseFloat(match[1] ?? "") === 0.4;
}

function isPlainTranslation(element: Element): boolean {
  return localName(element) === "p"
    && element.attributes.length === 0
    && elementChildren(element).length === 0
    && normalizedText(element).length > 0;
}

function collectCandidates(document: Document): { candidates: Candidate[]; standalone: Array<{ element: Element; nodeIndex: number }> } {
  const body = descendantElements(document, "body")[0] ?? document.documentElement;
  const candidates: Candidate[] = [];
  const standalone: Array<{ element: Element; nodeIndex: number }> = [];
  let nodeIndex = 0;
  const inlineNames = new Set(["a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "em", "i", "q", "rb", "rp", "rt", "rtc", "ruby", "small", "span", "strong", "sub", "sup", "u", "wbr"]);
  const visit = (element: Element): void => {
    if (isHidden(element) || ["script", "style", "nav", "noscript", "template"].includes(localName(element))) return;
    const name = localName(element);
    if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "figcaption"].includes(name)) {
      const text = normalizedText(element);
      const images = descendantElements(element, "img");
      if (!text && images.length > 0) {
        for (const image of images) standalone.push({ element: image, nodeIndex: nodeIndex++ });
      } else if (text || images.length > 0) {
        candidates.push({
          element,
          nodeIndex: nodeIndex++,
          parent: element.parentNode ?? body,
          role: name.startsWith("h") ? "heading" : name === "figcaption" ? "caption" : "paragraph",
        });
      }
      return;
    }
    if (name === "img" || name === "svg" || name === "hr") {
      standalone.push({ element, nodeIndex: nodeIndex++ });
      return;
    }
    let inlineRun: Node[] = [];
    const flushInlineRun = (): void => {
      if (inlineRun.length === 0) return;
      const wrapper = document.createElement("p");
      for (const item of inlineRun) wrapper.appendChild(item.cloneNode(true));
      if (normalizedText(wrapper) || descendantElements(wrapper, "img").length > 0) {
        candidates.push({ element: wrapper, nodeIndex: nodeIndex++, parent: element, role: "paragraph" });
      }
      inlineRun = [];
    };
    for (let index = 0; index < element.childNodes.length; index += 1) {
      const child = element.childNodes.item(index);
      if (!child) continue;
      if (child.nodeType === 3 || child.nodeType === 4) {
        if ((child.nodeValue ?? "").trim() || inlineRun.length > 0) inlineRun.push(child);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const childName = localName(child);
      const imageOnlyLink = childName === "a" && !normalizedText(child) && descendantElements(child, "img").length > 0;
      if (inlineNames.has(childName) && !imageOnlyLink) {
        inlineRun.push(child);
      } else {
        flushInlineRun();
        visit(child as Element);
      }
    }
    flushInlineRun();
  };
  for (const child of elementChildren(body)) visit(child);
  return { candidates, standalone };
}

function nodeTextWithoutRubyAnnotations(node: Node): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? "";
  if (node.nodeType !== 1) return "";
  const name = localName(node);
  if (name === "rt" || name === "rp") return "";
  let value = "";
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes.item(index);
    if (child) value += nodeTextWithoutRubyAnnotations(child);
  }
  return value;
}

function rubyNodes(element: Element, state: ConversionState): InlineNode[] {
  const segments: Array<{ base: string; reading: string }> = [];
  let pendingBase = "";
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (!child) continue;
    if (child.nodeType === 1 && localName(child) === "rp") continue;
    if (child.nodeType === 1 && localName(child) === "rt") {
      const base = pendingBase.replace(/[\t\r\n]+/g, "").trim();
      const reading = normalizedText(child);
      if (base && reading) segments.push({ base, reading });
      pendingBase = "";
      continue;
    }
    pendingBase += nodeTextWithoutRubyAnnotations(child);
  }
  if (segments.length === 0) return [{ type: "text", value: nodeTextWithoutRubyAnnotations(element) }];
  state.sourceRubyCount += 1;
  const result: InlineNode[] = [{ type: "ruby", segments, origin: "source", readingType: "kana" }];
  if (pendingBase) result.push({ type: "text", value: pendingBase });
  return result;
}

async function parseInlineChildren(parent: Node, context: InlineContext): Promise<InlineNode[]> {
  const result: InlineNode[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (!child) continue;
    if (child.nodeType === 3 || child.nodeType === 4) {
      if (child.nodeValue) result.push({ type: "text", value: child.nodeValue });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const name = localName(element);
    if (["rt", "rp", "script", "style"].includes(name) || isHidden(element)) continue;
    if (name === "br") {
      result.push({ type: "lineBreak" });
    } else if (name === "ruby") {
      result.push(...rubyNodes(element, context.state));
    } else if (name === "img") {
      const src = attr(element, "src", "href");
      const alt = attr(element, "alt") ?? "";
      const asset = src ? await context.assets.addReference(context.sourcePath, src) : undefined;
      if (asset) result.push({ type: "image", assetId: asset.id, alt, role: "gaiji" });
      else result.push({ type: "text", value: alt || "[missing inline image]" });
    } else if (name === "a") {
      const children = await parseInlineChildren(element, context);
      const href = attr(element, "href");
      const target = href ? linkTarget(href, context) : undefined;
      if (target) result.push({ type: "link", target, children });
      else result.push(...children);
    } else if (["strong", "b"].includes(name)) {
      result.push({ type: "emphasis", style: "strong", children: await parseInlineChildren(element, context) });
    } else if (["em", "i"].includes(name)) {
      result.push({ type: "emphasis", style: "italic", children: await parseInlineChildren(element, context) });
    } else if (isSesame(element)) {
      result.push({ type: "emphasis", style: "sesame", children: await parseInlineChildren(element, context) });
    } else {
      if (!["span", "rb", "rtc", "small", "sup", "sub", "code", "u", "wbr"].includes(name)) {
        const key = `${context.sourcePath}:${name}`;
        if (!context.state.warnings.some((warning) => warning.code === "INLINE_NODE_FLATTENED" && warning.preview === key)) {
          context.state.warnings.push({
            code: "INLINE_NODE_FLATTENED",
            message: `Unsupported inline <${name}> was flattened to its children.`,
            sourcePath: context.sourcePath,
            nodeIndex: context.nodeIndex,
            preview: key,
          });
        }
      }
      result.push(...await parseInlineChildren(element, context));
    }
  }
  return mergeAdjacentText(result);
}

function mergeAdjacentText(nodes: InlineNode[]): InlineNode[] {
  const result: InlineNode[] = [];
  for (const node of nodes) {
    const last = result.at(-1);
    if (node.type === "text" && last?.type === "text") last.value += node.value;
    else result.push(node);
  }
  return result;
}

function isSesame(element: Element): boolean {
  const value = `${attr(element, "class") ?? ""} ${attr(element, "style") ?? ""}`.toLowerCase();
  return /sesame|text-emphasis|emphasis-dot|bou-ten|bouten/.test(value);
}

function linkTarget(href: string, context: InlineContext): LinkTarget | undefined {
  if (/^(?:https?:|mailto:)/i.test(href)) return { kind: "external", url: href };
  if (/^(?:data:|javascript:)/i.test(href)) {
    context.state.warnings.push({ code: "UNSAFE_LINK", message: `Unsafe link was removed: ${href}`, sourcePath: context.sourcePath, nodeIndex: context.nodeIndex });
    return undefined;
  }
  try {
    const parts = hrefParts(href);
    const targetPath = parts.path ? resolveEpubPath(context.sourcePath, parts.path) : context.sourcePath;
    const documentId = context.documentIdByPath.get(targetPath);
    if (!documentId) return undefined;
    return parts.fragment
      ? { kind: "internal", documentId, fragmentId: parts.fragment }
      : { kind: "internal", documentId };
  } catch {
    return undefined;
  }
}

function inferDirections(candidates: Candidate[]): Map<Node, "zh-jp" | "jp-zh"> {
  const grouped = new Map<Node, Candidate[]>();
  for (const candidate of candidates) {
    const list = grouped.get(candidate.parent) ?? [];
    list.push(candidate);
    grouped.set(candidate.parent, list);
  }
  const directions = new Map<Node, "zh-jp" | "jp-zh">();
  for (const [parent, list] of grouped) {
    const anchors = list.map((candidate, index) => isAutoNovelAnchor(candidate.element) ? index : -1).filter((index) => index >= 0);
    if (anchors.length === 0) continue;
    const first = anchors[0] ?? 0;
    const last = anchors.at(-1) ?? 0;
    const before = list.slice(0, first).filter((candidate) => isPlainTranslation(candidate.element)).length;
    const after = list.slice(last + 1).filter((candidate) => isPlainTranslation(candidate.element)).length;
    if (before > after) directions.set(parent, "zh-jp");
    else if (after > before) directions.set(parent, "jp-zh");
    else {
      let zhScore = 0;
      let jpScore = 0;
      for (const anchor of anchors) {
        if (anchor > 0 && isPlainTranslation(list[anchor - 1]?.element as Element)) zhScore += 1;
        if (anchor + 1 < list.length && isPlainTranslation(list[anchor + 1]?.element as Element)) jpScore += 1;
      }
      directions.set(parent, zhScore >= jpScore ? "zh-jp" : "jp-zh");
    }
  }
  return directions;
}

function adjacentTranslations(list: Candidate[], anchorIndex: number, direction: "zh-jp" | "jp-zh"): Candidate[] {
  const result: Candidate[] = [];
  const anchor = list[anchorIndex];
  if (!anchor) return result;
  const byElement = new Map(list.map((candidate) => [candidate.element, candidate]));
  let sibling: Node | null = direction === "zh-jp" ? anchor.element.previousSibling : anchor.element.nextSibling;
  while (sibling) {
    if ((sibling.nodeType === 3 || sibling.nodeType === 4) && !(sibling.nodeValue ?? "").trim()) {
      sibling = direction === "zh-jp" ? sibling.previousSibling : sibling.nextSibling;
      continue;
    }
    if (sibling.nodeType === 8) {
      sibling = direction === "zh-jp" ? sibling.previousSibling : sibling.nextSibling;
      continue;
    }
    if (sibling.nodeType !== 1) break;
    const candidate = byElement.get(sibling as Element);
    if (!candidate || !isPlainTranslation(candidate.element)) break;
    result.push(candidate);
    sibling = direction === "zh-jp" ? sibling.previousSibling : sibling.nextSibling;
  }
  if (direction === "zh-jp") result.reverse();
  return result;
}

async function makeVariant(
  candidate: Candidate,
  language: "zh-CN" | "ja-JP" | "und",
  origin: "source" | "translation",
  order: number,
  context: Omit<InlineContext, "nodeIndex">,
): Promise<ContentVariant> {
  return {
    language,
    origin,
    order,
    content: await parseInlineChildren(candidate.element, { ...context, nodeIndex: candidate.nodeIndex }),
    sourceRef: sourceRef(candidate, context.sourcePath),
  };
}

function roleFromPath(sourcePath: string, properties: Set<string>): DocumentRole {
  const value = `${sourcePath} ${[...properties].join(" ")}`.toLowerCase();
  if (/cover/.test(value)) return "cover";
  if (/(?:^|[/_.-])(nav|toc|contents?)(?:[/_.-]|$)/.test(value)) return "toc";
  if (/afterword|atogaki|あとがき/.test(value)) return "afterword";
  if (/colophon|okuduke|奥付/.test(value)) return "colophon";
  if (/promotion|advert|sample|trial/.test(value)) return "promotion";
  if (/titlepage|frontmatter|copyright|dedication/.test(value)) return "frontmatter";
  if (/illustration|imagepage|insert|kuchi-e/.test(value)) return "illustration";
  return "unknown";
}

export async function parseContentDocument(
  xml: string,
  sourcePath: string,
  documentId: string,
  properties: Set<string>,
  packageLanguages: string[],
  documentIdByPath: Map<string, string>,
  assets: AssetRegistry,
  state: ConversionState,
): Promise<BookDocument> {
  const dom = parseXml(xml, sourcePath);
  const { candidates, standalone } = collectCandidates(dom);
  const byParent = new Map<Node, Candidate[]>();
  for (const candidate of candidates) {
    const list = byParent.get(candidate.parent) ?? [];
    list.push(candidate);
    byParent.set(candidate.parent, list);
  }
  const directions = inferDirections(candidates);
  const translationsByAnchor = new Map<Element, Candidate[]>();
  const translationElements = new Set<Element>();
  for (const [parent, direction] of directions) {
    const siblings = byParent.get(parent) ?? [];
    for (let index = 0; index < siblings.length; index += 1) {
      const anchor = siblings[index];
      if (!anchor || !isAutoNovelAnchor(anchor.element)) continue;
      const translations = adjacentTranslations(siblings, index, direction);
      translationsByAnchor.set(anchor.element, translations);
      for (const translation of translations) translationElements.add(translation.element);
    }
  }
  const blocks: BookDocument["blocks"] = [];
  const anchors: Record<string, string> = {};
  const context = { sourcePath, documentIdByPath, assets, state };

  for (const candidate of candidates) {
    if (translationElements.has(candidate.element)) continue;
    const blockId = `${documentId}-block-${String(candidate.nodeIndex).padStart(6, "0")}`;
    let variants: ContentVariant[];
    const direction = directions.get(candidate.parent);
    if (direction && isAutoNovelAnchor(candidate.element)) {
      const translations = translationsByAnchor.get(candidate.element) ?? [];
      if (translations.length === 0) {
        state.warnings.push({ code: "AUTO_NOVEL_ANCHOR_UNPAIRED", message: "An opacity:0.4 source paragraph had no adjacent plain-text translation.", sourcePath, nodeIndex: candidate.nodeIndex });
      }
      variants = [await makeVariant(candidate, "ja-JP", "source", 0, context)];
      for (let index = 0; index < translations.length; index += 1) {
        const translation = translations[index];
        if (translation) variants.push(await makeVariant(translation, "zh-CN", "translation", index, context));
      }
      if (translations.length > 0) {
        state.parallelBlockCount += 1;
        state.directions.add(direction);
        state.maximumTranslationVariants = Math.max(state.maximumTranslationVariants, translations.length);
      }
    } else {
      const language = languageForElement(candidate.element, packageLanguages);
      if (language === "und") state.unclassifiedTextCount += 1;
      variants = [await makeVariant(candidate, language, "source", 0, context)];
    }
    const block: TextBlock = { id: blockId, type: "text", role: candidate.role, variants };
    blocks.push(block);
    state.textBlockCount += 1;
    for (const variant of variants) {
      const elementId = variant.sourceRef.elementId;
      if (elementId) anchors[elementId] = blockId;
    }
    for (const element of [candidate.element, ...translationsByAnchor.get(candidate.element)?.map((item) => item.element) ?? []]) {
      for (const descendant of descendantElements(element)) {
        const descendantId = attr(descendant, "id");
        if (descendantId) anchors[descendantId] = blockId;
      }
    }
  }

  for (let index = 0; index < standalone.length; index += 1) {
    const item = standalone[index];
    if (!item) continue;
    const { element, nodeIndex } = item;
    const name = localName(element);
    const ref: SourceRef = { sourcePath, nodeIndex, ...(attr(element, "id") ? { elementId: attr(element, "id") } : {}) };
    const blockId = `${documentId}-media-${String(nodeIndex).padStart(6, "0")}`;
    if (name === "hr") {
      blocks.push({ id: blockId, type: "divider", sourceRef: ref });
      continue;
    }
    let href: string | undefined;
    let alt = attr(element, "alt") ?? "";
    if (name === "img") href = attr(element, "src", "href");
    else {
      const imageElements = descendantElements(element, "image");
      if (imageElements.length === 1 && descendantElements(element).every((child) => ["image", "title", "desc"].includes(localName(child)))) {
        href = attr(imageElements[0] as Element, "href");
        alt = descendantElements(element, "title")[0]?.textContent?.trim() ?? alt;
      } else {
        state.warnings.push({ code: "COMPLEX_SVG_PLACEHOLDER", message: "Complex standalone SVG was replaced by a text placeholder.", sourcePath, nodeIndex });
        blocks.push({
          id: blockId,
          type: "text",
          role: "caption",
          variants: [{ language: "und", origin: "source", order: 0, content: [{ type: "text", value: "[unsupported SVG]" }], sourceRef: ref }],
        });
        state.textBlockCount += 1;
        continue;
      }
    }
    const asset = href ? await assets.addReference(sourcePath, href) : undefined;
    if (asset) {
      const divider = /(?:^|[/_.-])(?:kugiri|divider|separator)(?:[/_.-]|$)/i.test(href ?? "");
      blocks.push(divider
        ? { id: blockId, type: "divider", assetId: asset.id, sourceRef: ref }
        : { id: blockId, type: "image", role: "illustration", assetId: asset.id, alt, sourceRef: ref });
    } else {
      blocks.push({
        id: blockId,
        type: "text",
        role: "caption",
        variants: [{ language: "und", origin: "source", order: 0, content: [{ type: "text", value: alt || "[missing image]" }], sourceRef: ref }],
      });
      state.textBlockCount += 1;
    }
  }

  let role = roleFromPath(sourcePath, properties);
  if (role === "unknown") {
    const hasText = blocks.some((block) => block.type === "text");
    const imageOnly = blocks.length > 0 && blocks.every((block) => block.type === "image" || block.type === "divider");
    role = imageOnly ? "illustration" : hasText ? "chapter" : "unknown";
  }
  blocks.sort((left, right) => {
    const blockIndex = (block: BookDocument["blocks"][number]): number => {
      if (block.type !== "text") return block.sourceRef.nodeIndex;
      return Math.min(...block.variants.map((variant) => variant.sourceRef.nodeIndex));
    };
    return blockIndex(left) - blockIndex(right);
  });
  const fallbackBlockId = blocks[0]?.id;
  if (fallbackBlockId) {
    for (const element of descendantElements(dom)) {
      const elementId = attr(element, "id");
      if (elementId && !anchors[elementId]) anchors[elementId] = fallbackBlockId;
    }
  }
  return { id: documentId, sourcePath, role, anchors, blocks };
}

export async function registerCoverAsset(packageInfo: PackageInfo, assets: AssetRegistry): Promise<BookAsset | undefined> {
  const cover = [...packageInfo.manifest.values()].find((item) => item.properties.has("cover-image"))
    ?? (packageInfo.coverId ? packageInfo.manifest.get(packageInfo.coverId) : undefined);
  if (!cover) return undefined;
  return assets.addReference(packageInfo.packagePath, cover.href);
}

export function documentIdForPath(sourcePath: string): string {
  return stableId("document", sourcePath);
}
