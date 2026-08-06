import type { BookDocument, BookManifest, ConversionReport } from "@airnobe/book-format";
import type { LoadedBook } from "./book-source.js";
import { EMPTY_READING_STATE } from "./reading-state.js";

const document: BookDocument = {
  id: "document-demo",
  sourcePath: "Text/demo.xhtml",
  role: "chapter",
  anchors: { start: "demo-heading" },
  blocks: [
    {
      id: "demo-heading",
      type: "text",
      role: "heading",
      variants: [
        {
          language: "ja-JP",
          origin: "source",
          order: 0,
          content: [{ type: "text", value: "第一章　雨のあと" }],
          sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 0, elementId: "start" },
        },
        {
          language: "zh-CN",
          origin: "translation",
          order: 0,
          content: [{ type: "text", value: "第一章　雨后" }],
          sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 1 },
        },
      ],
    },
    {
      id: "demo-paragraph-1",
      type: "text",
      role: "paragraph",
      variants: [
        {
          language: "ja-JP",
          origin: "source",
          order: 0,
          content: [
            { type: "text", value: "雨が上がると、" },
            { type: "ruby", origin: "source", readingType: "kana", segments: [{ base: "街", reading: "まち" }] },
            { type: "text", value: "は静かになった。" },
          ],
          sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 2 },
        },
        {
          language: "zh-CN",
          origin: "translation",
          order: 0,
          content: [{ type: "text", value: "雨停之后，街道安静了下来。" }],
          sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 3 },
        },
      ],
    },
    {
      id: "demo-paragraph-2",
      type: "text",
      role: "paragraph",
      variants: [
        {
          language: "ja-JP",
          origin: "source",
          order: 0,
          content: [
            { type: "text", value: "彼女は" },
            { type: "ruby", origin: "reused", readingType: "kana", segments: [{ base: "扉", reading: "とびら" }] },
            { type: "text", value: "と" },
            { type: "ruby", origin: "generated", readingType: "kana", segments: [{ base: "窓", reading: "まど" }] },
            { type: "text", value: "を開け、" },
            { type: "ruby", origin: "generated", readingType: "romaji", segments: [{ base: "コンピューター", reading: "konpyūtā" }] },
            { type: "emphasis", style: "sesame", children: [{ type: "text", value: "新しい風" }] },
            { type: "text", value: "を待った。" },
          ],
          sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 4 },
        },
        {
          language: "zh-CN",
          origin: "translation",
          order: 0,
          content: [{ type: "text", value: "她推开窗，等待一阵新的风。" }],
          sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 5 },
        },
      ],
    },
    {
      id: "demo-divider",
      type: "divider",
      sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 6 },
    },
    {
      id: "demo-paragraph-3",
      type: "text",
      role: "paragraph",
      variants: [
        {
          language: "ja-JP",
          origin: "source",
          order: 0,
          content: [{ type: "text", value: "これは表示切り替えを確認するための短い文章です。" }],
          sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 7 },
        },
        {
          language: "zh-CN",
          origin: "translation",
          order: 0,
          content: [{ type: "text", value: "这是一段用于验证显示切换的简短文字。" }],
          sourceRef: { sourcePath: "Text/demo.xhtml", nodeIndex: 8 },
        },
      ],
    },
  ],
};

const book: BookManifest = {
  format: "airnobe-book",
  version: 3,
  id: "book-demo",
  source: {
    fileName: "demo.epub",
    sha256: "0".repeat(64),
    packagePath: "package.opf",
    languages: ["zh-CN", "ja-JP"],
  },
  metadata: {
    title: "Airnobe 阅读演示",
    authors: ["Airnobe"],
    languages: ["zh-CN", "ja-JP"],
  },
  readingOrder: [{ documentId: document.id, path: "documents/0000.json", role: "chapter", linear: true }],
  toc: [{ label: "第一章　雨后", target: { documentId: document.id, fragmentId: "start" }, children: [] }],
  assets: [],
  derivation: {
    type: "furigana",
    baseBookId: "book-demo-base",
    engine: "demo",
    engineVersion: "1",
    dictionary: "demo",
    romanization: {
      engine: "demo",
      engineVersion: "1",
      system: "modified-hepburn",
      longVowels: "macron",
    },
  },
};

const report: ConversionReport = {
  status: "ok",
  sourceFileName: "demo.epub",
  sourceSha256: "0".repeat(64),
  metrics: {
    spineDocumentCount: 1,
    outputDocumentCount: 1,
    textBlockCount: 4,
    parallelBlockCount: 4,
    sourceRubyCount: 1,
    reusedRubyCount: 1,
    generatedRubyCount: 1,
    katakanaRomajiCount: 1,
    assetCount: 0,
    unclassifiedTextCount: 0,
  },
  warnings: [],
};

export function createDemoBook(): LoadedBook {
  return {
    book,
    documents: [document],
    documentById: new Map([[document.id, document]]),
    assetUrlById: new Map(),
    report,
    readingState: structuredClone(EMPTY_READING_STATE),
    sourceLabel: "内置演示",
    dispose() {},
  };
}
