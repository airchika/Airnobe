import { createHash } from "node:crypto";
import path from "node:path";

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}-${sha256(value).slice(0, 16)}`;
}

export function normalizeZipPath(value: string): string {
  const decoded = decodeURIComponent(value.replace(/\\/g, "/"));
  const normalized = path.posix.normalize(decoded).replace(/^\.\//, "");
  if (
    normalized === ".."
    || normalized.startsWith("../")
    || normalized.startsWith("/")
    || /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe EPUB path: ${value}`);
  }
  return normalized;
}

export function resolveEpubPath(baseFile: string, href: string): string {
  const withoutFragment = href.split("#", 1)[0] ?? "";
  return normalizeZipPath(path.posix.join(path.posix.dirname(baseFile), withoutFragment));
}

export function hrefParts(href: string): { path: string; fragment?: string } {
  const hash = href.indexOf("#");
  if (hash < 0) return { path: href };
  const fragment = decodeURIComponent(href.slice(hash + 1));
  return fragment ? { path: href.slice(0, hash), fragment } : { path: href.slice(0, hash) };
}

export function localName(node: Node): string {
  return (((node as Element).localName) || node.nodeName.split(":").at(-1) || "").toLowerCase();
}

export function elementChildren(node: Node): Element[] {
  const result: Element[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes.item(index);
    if (child?.nodeType === 1) result.push(child as Element);
  }
  return result;
}

export function descendantElements(node: Node, name?: string): Element[] {
  const result: Element[] = [];
  const expected = name?.toLowerCase();
  const visit = (current: Node): void => {
    for (const child of elementChildren(current)) {
      if (!expected || localName(child) === expected) result.push(child);
      visit(child);
    }
  };
  visit(node);
  return result;
}

export function attr(element: Element, ...names: string[]): string | undefined {
  for (const name of names) {
    const direct = element.getAttribute(name);
    if (direct !== null && direct !== "") return direct;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const item = element.attributes.item(index);
      if (item && localName(item) === name.toLowerCase() && item.value) return item.value;
    }
  }
  return undefined;
}

export function normalizedText(node: Node): string {
  return (node.textContent ?? "").replace(/[\t\r\n ]+/g, " ").trim();
}

export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
