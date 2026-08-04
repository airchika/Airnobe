import type { BookDocument, InlineNode } from "@airnobe/book-format";

export interface TokenLike {
  surface_form: string;
  reading?: string | undefined;
  word_type?: string | undefined;
  pos_detail_1?: string | undefined;
  pos_detail_2?: string | undefined;
}

export interface TokenizerLike {
  tokenize(text: string): TokenLike[];
}

interface TextLeaf {
  node: Extract<InlineNode, { type: "text" }>;
  start: number;
  end: number;
}

interface Range {
  start: number;
  end: number;
}

interface Annotation extends Range {
  reading: string;
  origin: "reused" | "generated";
}

interface FlatContent {
  text: string;
  leaves: TextLeaf[];
  protectedRanges: Range[];
}

interface PositionedToken extends Range {
  token: TokenLike;
}

export interface AnnotationStats {
  reusedRubyCount: number;
  generatedRubyCount: number;
  skippedLowConfidenceCount: number;
}

function flatten(nodes: InlineNode[]): FlatContent {
  let text = "";
  const leaves: TextLeaf[] = [];
  const protectedRanges: Range[] = [];
  const append = (value: string, protect = false): void => {
    const start = text.length;
    text += value;
    if (protect && value) protectedRanges.push({ start, end: text.length });
  };
  const visit = (items: InlineNode[]): void => {
    for (const node of items) {
      if (node.type === "text") {
        const start = text.length;
        append(node.value);
        leaves.push({ node, start, end: text.length });
      } else if (node.type === "ruby") {
        append(node.segments.map((segment) => segment.base).join(""), true);
      } else if (node.type === "emphasis" || node.type === "link") {
        visit(node.children);
      } else if (node.type === "lineBreak") {
        append("\n", true);
      } else {
        append("\ufffc", true);
      }
    }
  };
  visit(nodes);
  return { text, leaves, protectedRanges };
}

function positionTokens(text: string, tokens: TokenLike[]): PositionedToken[] {
  const result: PositionedToken[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (!token.surface_form) continue;
    const start = text.indexOf(token.surface_form, cursor);
    if (start < 0) continue;
    const end = start + token.surface_form.length;
    result.push({ token, start, end });
    cursor = end;
  }
  return result;
}

function overlaps(range: Range, ranges: Range[]): boolean {
  return ranges.some((other) => range.start < other.end && range.end > other.start);
}

function containingLeaf(range: Range, leaves: TextLeaf[]): TextLeaf | undefined {
  return leaves.find((leaf) => range.start >= leaf.start && range.end <= leaf.end);
}

function isLowConfidence(token: TokenLike): boolean {
  const detail = `${token.pos_detail_1 ?? ""} ${token.pos_detail_2 ?? ""}`;
  return token.word_type === "UNKNOWN" || /人名/.test(detail);
}

function hasKanji(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff々〆ヶ]/u.test(value);
}

function katakanaToHiragana(value: string): string {
  return [...value].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : character;
  }).join("");
}

function isKana(character: string): boolean {
  return /^[\u3040-\u30ffー]$/u.test(character);
}

function annotationNodes(
  surface: string,
  rawReading: string,
  origin: "reused" | "generated",
): InlineNode[] {
  const reading = katakanaToHiragana(rawReading);
  let prefixLength = 0;
  while (
    prefixLength < surface.length
    && prefixLength < reading.length
    && isKana(surface[prefixLength] ?? "")
    && katakanaToHiragana(surface[prefixLength] ?? "") === reading[prefixLength]
  ) prefixLength += 1;
  let suffixLength = 0;
  while (
    suffixLength < surface.length - prefixLength
    && suffixLength < reading.length - prefixLength
  ) {
    const surfaceCharacter = surface[surface.length - suffixLength - 1] ?? "";
    const readingCharacter = reading[reading.length - suffixLength - 1] ?? "";
    if (!isKana(surfaceCharacter) || katakanaToHiragana(surfaceCharacter) !== readingCharacter) break;
    suffixLength += 1;
  }
  const surfaceCore = surface.slice(prefixLength, surface.length - suffixLength || undefined);
  const readingCore = reading.slice(prefixLength, reading.length - suffixLength || undefined);
  if (!surfaceCore || !readingCore || !hasKanji(surfaceCore)) return [{ type: "text", value: surface }];
  const nodes: InlineNode[] = [];
  const prefix = surface.slice(0, prefixLength);
  const suffix = suffixLength ? surface.slice(surface.length - suffixLength) : "";
  if (prefix) nodes.push({ type: "text", value: prefix });
  nodes.push({ type: "ruby", segments: [{ base: surfaceCore, reading: readingCore }], origin });
  if (suffix) nodes.push({ type: "text", value: suffix });
  return nodes;
}

function transformNodes(nodes: InlineNode[], annotationsByLeaf: Map<InlineNode, Annotation[]>): InlineNode[] {
  const output: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const annotations = annotationsByLeaf.get(node) ?? [];
      let cursor = 0;
      for (const annotation of annotations) {
        if (annotation.start > cursor) output.push({ type: "text", value: node.value.slice(cursor, annotation.start) });
        const surface = node.value.slice(annotation.start, annotation.end);
        output.push(...annotationNodes(surface, annotation.reading, annotation.origin));
        cursor = annotation.end;
      }
      if (cursor < node.value.length) output.push({ type: "text", value: node.value.slice(cursor) });
    } else if (node.type === "emphasis") {
      output.push({ ...node, children: transformNodes(node.children, annotationsByLeaf) });
    } else if (node.type === "link") {
      output.push({ ...node, children: transformNodes(node.children, annotationsByLeaf) });
    } else {
      output.push(node);
    }
  }
  return output;
}

function sourceReadingMap(documents: BookDocument[]): Map<string, string> {
  const readings = new Map<string, Set<string>>();
  const collect = (base: string, reading: string): void => {
    if (!base || !reading) return;
    const set = readings.get(base) ?? new Set<string>();
    set.add(katakanaToHiragana(reading));
    readings.set(base, set);
  };
  const visit = (nodes: InlineNode[]): void => {
    for (const node of nodes) {
      if (node.type === "ruby" && node.origin === "source") {
        for (const segment of node.segments) collect(segment.base, segment.reading);
        if (node.segments.length > 1) {
          collect(
            node.segments.map((segment) => segment.base).join(""),
            node.segments.map((segment) => segment.reading).join(""),
          );
        }
      } else if (node.type === "emphasis" || node.type === "link") visit(node.children);
    }
  };
  for (const document of documents) {
    for (const block of document.blocks) {
      if (block.type === "text") for (const variant of block.variants) visit(variant.content);
    }
  }
  return new Map([...readings].flatMap(([base, values]) => values.size === 1 ? [[base, [...values][0] as string]] : []));
}

export function annotateDocuments(documents: BookDocument[], tokenizer: TokenizerLike): AnnotationStats {
  const reusable = sourceReadingMap(documents);
  const reusableBases = [...reusable.keys()].sort((left, right) => right.length - left.length);
  let reusedRubyCount = 0;
  let generatedRubyCount = 0;
  let skippedLowConfidenceCount = 0;
  for (const document of documents) {
    for (const block of document.blocks) {
      if (block.type !== "text") continue;
      for (const variant of block.variants) {
        if (variant.language !== "ja-JP") continue;
        const flat = flatten(variant.content);
        const tokens = positionTokens(flat.text, tokenizer.tokenize(flat.text));
        const annotationsByLeaf = new Map<InlineNode, Annotation[]>();
        for (let index = 0; index < tokens.length; index += 1) {
          const current = tokens[index];
          if (!current || overlaps(current, flat.protectedRanges)) continue;
          let selected: Annotation | undefined;
          let consumedTokens = 1;
          for (const base of reusableBases) {
            if (!flat.text.startsWith(base, current.start)) continue;
            let end = current.end;
            let cursor = index;
            while (end < current.start + base.length && cursor + 1 < tokens.length) {
              cursor += 1;
              end = tokens[cursor]?.end ?? end;
            }
            if (end !== current.start + base.length) continue;
            const range = { start: current.start, end };
            if (overlaps(range, flat.protectedRanges) || !containingLeaf(range, flat.leaves)) continue;
            selected = { ...range, reading: reusable.get(base) as string, origin: "reused" };
            consumedTokens = cursor - index + 1;
            break;
          }
          if (!selected) {
            if (!hasKanji(current.token.surface_form) || !current.token.reading) continue;
            if (isLowConfidence(current.token)) {
              skippedLowConfidenceCount += 1;
              continue;
            }
            if (!containingLeaf(current, flat.leaves)) continue;
            selected = {
              start: current.start,
              end: current.end,
              reading: current.token.reading,
              origin: "generated",
            };
          }
          const leaf = containingLeaf(selected, flat.leaves);
          if (!leaf) continue;
          const local = {
            start: selected.start - leaf.start,
            end: selected.end - leaf.start,
            reading: selected.reading,
            origin: selected.origin,
          };
          const list = annotationsByLeaf.get(leaf.node) ?? [];
          list.push(local);
          annotationsByLeaf.set(leaf.node, list);
          if (selected.origin === "reused") reusedRubyCount += 1;
          else generatedRubyCount += 1;
          index += consumedTokens - 1;
        }
        for (const annotations of annotationsByLeaf.values()) annotations.sort((left, right) => left.start - right.start);
        variant.content = transformNodes(variant.content, annotationsByLeaf);
      }
    }
  }
  return { reusedRubyCount, generatedRubyCount, skippedLowConfidenceCount };
}
