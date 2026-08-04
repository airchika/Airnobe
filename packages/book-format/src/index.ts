import { z } from "zod";

export const AIRNOBE_FORMAT = "airnobe-book" as const;
export const AIRNOBE_FORMAT_VERSION = 2 as const;

function isPortableRelativePath(value: string): boolean {
  return !value.includes("\\")
    && !value.startsWith("/")
    && !/^[a-zA-Z]:/.test(value)
    && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export const RelativePathSchema = z.string().min(1).refine(isPortableRelativePath, "Expected a safe portable relative path");

export const LanguageSchema = z.enum(["zh-CN", "ja-JP", "und"]);
export type Language = z.infer<typeof LanguageSchema>;

export const SourceRefSchema = z.object({
  sourcePath: RelativePathSchema,
  nodeIndex: z.number().int().nonnegative(),
  elementId: z.string().min(1).optional(),
}).strict();
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const LinkTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("internal"),
    documentId: z.string().min(1),
    fragmentId: z.string().min(1).optional(),
  }).strict(),
  z.object({
    kind: z.literal("external"),
    url: z.string().url().refine((value) => /^(?:https?:|mailto:)/i.test(value), "Unsupported external URL protocol"),
  }).strict(),
]);
export type LinkTarget = z.infer<typeof LinkTargetSchema>;

export type InlineNode =
  | { type: "text"; value: string }
  | {
      type: "ruby";
      segments: Array<{ base: string; reading: string }>;
      origin: "source" | "reused" | "generated";
    }
  | {
      type: "emphasis";
      style: "sesame" | "strong" | "italic";
      children: InlineNode[];
    }
  | { type: "lineBreak" }
  | { type: "image"; assetId: string; alt: string; role: "gaiji" }
  | { type: "link"; target: LinkTarget; children: InlineNode[] };

export const InlineNodeSchema: z.ZodType<InlineNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("text"), value: z.string() }).strict(),
    z.object({
      type: z.literal("ruby"),
      segments: z.array(z.object({
        base: z.string().min(1),
        reading: z.string().min(1),
      }).strict()).min(1),
      origin: z.enum(["source", "reused", "generated"]),
    }).strict(),
    z.object({
      type: z.literal("emphasis"),
      style: z.enum(["sesame", "strong", "italic"]),
      children: z.array(InlineNodeSchema),
    }).strict(),
    z.object({ type: z.literal("lineBreak") }).strict(),
    z.object({
      type: z.literal("image"),
      assetId: z.string().min(1),
      alt: z.string(),
      role: z.literal("gaiji"),
    }).strict(),
    z.object({
      type: z.literal("link"),
      target: LinkTargetSchema,
      children: z.array(InlineNodeSchema),
    }).strict(),
  ]),
);

export const ContentVariantSchema = z.object({
  language: LanguageSchema,
  origin: z.enum(["source", "translation"]),
  order: z.number().int().nonnegative(),
  content: z.array(InlineNodeSchema),
  sourceRef: SourceRefSchema,
}).strict();
export type ContentVariant = z.infer<typeof ContentVariantSchema>;

export const TextBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("text"),
  role: z.enum(["paragraph", "heading", "caption"]),
  variants: z.array(ContentVariantSchema).min(1),
}).strict();
export type TextBlock = z.infer<typeof TextBlockSchema>;

export const ImageBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("image"),
  role: z.enum(["cover", "illustration", "other"]),
  assetId: z.string().min(1),
  alt: z.string(),
  sourceRef: SourceRefSchema,
}).strict();
export type ImageBlock = z.infer<typeof ImageBlockSchema>;

export const DividerBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("divider"),
  assetId: z.string().min(1).optional(),
  sourceRef: SourceRefSchema,
}).strict();
export type DividerBlock = z.infer<typeof DividerBlockSchema>;

export const BlockNodeSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ImageBlockSchema,
  DividerBlockSchema,
]);
export type BlockNode = z.infer<typeof BlockNodeSchema>;

export const DocumentRoleSchema = z.enum([
  "cover",
  "frontmatter",
  "toc",
  "chapter",
  "illustration",
  "afterword",
  "colophon",
  "promotion",
  "unknown",
]);
export type DocumentRole = z.infer<typeof DocumentRoleSchema>;

export const BookDocumentSchema = z.object({
  id: z.string().min(1),
  sourcePath: RelativePathSchema,
  role: DocumentRoleSchema,
  anchors: z.record(z.string(), z.string()).default({}),
  blocks: z.array(BlockNodeSchema),
}).strict();
export type BookDocument = z.infer<typeof BookDocumentSchema>;

export const AssetSchema = z.object({
  id: z.string().min(1),
  path: RelativePathSchema.refine((value) => value.startsWith("assets/"), "Asset path must be inside assets/"),
  mediaType: z.string().min(1),
  sourcePaths: z.array(RelativePathSchema).min(1),
}).strict();
export type BookAsset = z.infer<typeof AssetSchema>;

export type TocItem = {
  label: string;
  target?: { documentId: string; fragmentId?: string | undefined } | undefined;
  children: TocItem[];
};

export const TocItemSchema: z.ZodType<TocItem> = z.lazy(() =>
  z.object({
    label: z.string(),
    target: z.object({
      documentId: z.string().min(1),
      fragmentId: z.string().min(1).optional(),
    }).strict().optional(),
    children: z.array(TocItemSchema),
  }).strict(),
);

export const BookManifestSchema = z.object({
  format: z.literal(AIRNOBE_FORMAT),
  version: z.literal(AIRNOBE_FORMAT_VERSION),
  id: z.string().min(1),
  source: z.object({
    fileName: z.string().min(1).refine((value) => !/[\\/]/.test(value), "Expected a file name without directories"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    packagePath: RelativePathSchema,
    identifier: z.string().min(1).optional(),
    languages: z.array(z.string()),
  }).strict(),
  metadata: z.object({
    title: z.string(),
    authors: z.array(z.string()),
    languages: z.array(LanguageSchema),
  }).strict(),
  coverAssetId: z.string().min(1).optional(),
  readingOrder: z.array(z.object({
    documentId: z.string().min(1),
    path: RelativePathSchema.refine((value) => value.startsWith("documents/"), "Document path must be inside documents/"),
    role: DocumentRoleSchema,
    linear: z.boolean(),
  }).strict()),
  toc: z.array(TocItemSchema),
  assets: z.array(AssetSchema),
  derivation: z.object({
    type: z.literal("furigana"),
    baseBookId: z.string().min(1),
    engine: z.string().min(1),
    engineVersion: z.string().min(1),
    dictionary: z.string().min(1),
  }).strict().optional(),
}).strict();
export type BookManifest = z.infer<typeof BookManifestSchema>;

export const ConversionWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  sourcePath: z.string().min(1).optional(),
  nodeIndex: z.number().int().nonnegative().optional(),
  preview: z.string().optional(),
}).strict();
export type ConversionWarning = z.infer<typeof ConversionWarningSchema>;

export const ConversionReportSchema = z.object({
  status: z.enum(["ok", "ok-with-warnings"]),
  sourceFileName: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  adapter: z.object({
    id: z.string().min(1),
    directions: z.array(z.enum(["zh-jp", "jp-zh"])),
    maximumTranslationVariants: z.number().int().nonnegative(),
  }).strict().optional(),
  metrics: z.object({
    spineDocumentCount: z.number().int().nonnegative(),
    outputDocumentCount: z.number().int().nonnegative(),
    textBlockCount: z.number().int().nonnegative(),
    parallelBlockCount: z.number().int().nonnegative(),
    sourceRubyCount: z.number().int().nonnegative(),
    reusedRubyCount: z.number().int().nonnegative(),
    generatedRubyCount: z.number().int().nonnegative(),
    assetCount: z.number().int().nonnegative(),
    unclassifiedTextCount: z.number().int().nonnegative(),
  }).strict(),
  warnings: z.array(ConversionWarningSchema),
}).strict();
export type ConversionReport = z.infer<typeof ConversionReportSchema>;

export function inlinePlainText(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    switch (node.type) {
      case "text": return node.value;
      case "ruby": return node.segments.map((segment) => segment.base).join("");
      case "emphasis": return inlinePlainText(node.children);
      case "lineBreak": return "\n";
      case "image": return node.alt;
      case "link": return inlinePlainText(node.children);
    }
  }).join("");
}

export function validateBookGraph(
  book: BookManifest,
  documents: BookDocument[],
): string[] {
  const errors: string[] = [];
  const documentIds = new Set(documents.map((document) => document.id));
  if (documentIds.size !== documents.length) errors.push("duplicate document IDs");
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const assetIds = new Set(book.assets.map((asset) => asset.id));
  if (assetIds.size !== book.assets.length) errors.push("duplicate asset IDs");
  if (book.coverAssetId && !assetIds.has(book.coverAssetId)) errors.push(`cover references missing asset ${book.coverAssetId}`);
  const readingDocumentIds = new Set<string>();
  const readingPaths = new Set<string>();
  for (const entry of book.readingOrder) {
    if (!documentIds.has(entry.documentId)) {
      errors.push(`readingOrder references missing document ${entry.documentId}`);
    }
    if (readingDocumentIds.has(entry.documentId)) errors.push(`readingOrder repeats document ${entry.documentId}`);
    if (readingPaths.has(entry.path)) errors.push(`readingOrder repeats path ${entry.path}`);
    readingDocumentIds.add(entry.documentId);
    readingPaths.add(entry.path);
  }
  for (const document of documents) {
    if (!readingDocumentIds.has(document.id)) errors.push(`document is absent from readingOrder ${document.id}`);
    const blockIds = new Set(document.blocks.map((block) => block.id));
    if (blockIds.size !== document.blocks.length) errors.push(`duplicate block IDs in ${document.id}`);
    for (const [fragmentId, blockId] of Object.entries(document.anchors)) {
      if (!fragmentId || !blockIds.has(blockId)) errors.push(`invalid anchor ${document.id}#${fragmentId}`);
    }
  }
  const assetPaths = new Set<string>();
  for (const asset of book.assets) {
    if (assetPaths.has(asset.path)) errors.push(`duplicate asset path ${asset.path}`);
    assetPaths.add(asset.path);
  }
  const checkToc = (items: TocItem[]): void => {
    for (const item of items) {
      if (item.target) {
        const targetDocument = documentById.get(item.target.documentId);
        if (!targetDocument) errors.push(`TOC references missing document ${item.target.documentId}`);
        else if (item.target.fragmentId && !targetDocument.anchors[item.target.fragmentId]) {
          errors.push(`TOC references missing fragment ${item.target.documentId}#${item.target.fragmentId}`);
        }
      }
      checkToc(item.children);
    }
  };
  checkToc(book.toc);
  const checkInline = (nodes: InlineNode[]): void => {
    for (const node of nodes) {
      if (node.type === "image" && !assetIds.has(node.assetId)) {
        errors.push(`inline image references missing asset ${node.assetId}`);
      } else if (node.type === "link") {
        if (node.target.kind === "internal") {
          const targetDocument = documentById.get(node.target.documentId);
          if (!targetDocument) errors.push(`link references missing document ${node.target.documentId}`);
          else if (node.target.fragmentId && !targetDocument.anchors[node.target.fragmentId]) {
            errors.push(`link references missing fragment ${node.target.documentId}#${node.target.fragmentId}`);
          }
        }
        checkInline(node.children);
      } else if (node.type === "emphasis") {
        checkInline(node.children);
      }
    }
  };
  for (const document of documents) {
    for (const block of document.blocks) {
      if ((block.type === "image" || block.type === "divider") && block.assetId && !assetIds.has(block.assetId)) {
        errors.push(`${block.type} references missing asset ${block.assetId}`);
      }
      if (block.type === "text") {
        for (const variant of block.variants) checkInline(variant.content);
      }
    }
  }
  return errors;
}
