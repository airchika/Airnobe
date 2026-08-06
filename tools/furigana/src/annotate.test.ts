import type { BookDocument, InlineNode } from "@airnobe/book-format";
import { describe, expect, it } from "vitest";
import { annotateDocuments, katakanaToRomaji, type TokenizerLike } from "./annotate.js";
import { loadTokenizer } from "./derive.js";

function documentWith(contents: InlineNode[][]): BookDocument {
  return {
    id: "document-test",
    sourcePath: "Text/test.xhtml",
    role: "chapter",
    anchors: {},
    blocks: contents.map((content, index) => ({
      id: `block-${index}`,
      type: "text" as const,
      role: "paragraph" as const,
      variants: [{
        language: "ja-JP" as const,
        origin: "source" as const,
        order: 0,
        content,
        sourceRef: { sourcePath: "Text/test.xhtml", nodeIndex: index },
      }],
    })),
  };
}

describe("furigana AST annotation", () => {
  it("tokenizes the whole block, preserves spaces and punctuation, and splits okurigana", () => {
    let received = "";
    const tokenizer: TokenizerLike = {
      tokenize(text) {
        received = text;
        return [
          { surface_form: "私", reading: "ワタシ" },
          { surface_form: "は", reading: "ハ" },
          { surface_form: "食べる", reading: "タベル" },
          { surface_form: "。", reading: "。" },
        ];
      },
    };
    const documents = [documentWith([[{ type: "text", value: "私 は食べる。" }]])];
    const stats = annotateDocuments(documents, tokenizer);
    expect(received).toBe("私 は食べる。");
    expect(stats).toEqual({ reusedRubyCount: 0, generatedRubyCount: 2, katakanaRomajiCount: 0, skippedLowConfidenceCount: 0 });
    const content = documents[0]?.blocks[0];
    if (content?.type !== "text") throw new Error("missing text block");
    expect(content.variants[0]?.content).toEqual([
      { type: "ruby", segments: [{ base: "私", reading: "わたし" }], origin: "generated", readingType: "kana" },
      { type: "text", value: " は" },
      { type: "ruby", segments: [{ base: "食", reading: "た" }], origin: "generated", readingType: "kana" },
      { type: "text", value: "べる" },
      { type: "text", value: "。" },
    ]);
  });

  it("protects source ruby and marks a book-unique reused reading separately", () => {
    const tokenizer: TokenizerLike = { tokenize: () => [{ surface_form: "生", reading: "セイ" }] };
    const sourceRuby: InlineNode = { type: "ruby", segments: [{ base: "生", reading: "なま" }], origin: "source", readingType: "kana" };
    const documents = [documentWith([[sourceRuby], [{ type: "text", value: "生" }]])];
    const stats = annotateDocuments(documents, tokenizer);
    expect(stats).toEqual({ reusedRubyCount: 1, generatedRubyCount: 0, katakanaRomajiCount: 0, skippedLowConfidenceCount: 0 });
    const first = documents[0]?.blocks[0];
    const second = documents[0]?.blocks[1];
    if (first?.type !== "text" || second?.type !== "text") throw new Error("missing text block");
    expect(first.variants[0]?.content).toEqual([sourceRuby]);
    expect(second.variants[0]?.content).toEqual([{ type: "ruby", segments: [{ base: "生", reading: "なま" }], origin: "reused", readingType: "kana" }]);
  });

  it("preserves spacer blocks without annotating them", () => {
    const document = documentWith([[{ type: "text", value: "日本" }]]);
    document.blocks.unshift({
      id: "spacer-0",
      type: "spacer",
      sourceRef: { sourcePath: "Text/test.xhtml", nodeIndex: 0 },
    });
    const spacer = structuredClone(document.blocks[0]);
    annotateDocuments([document], { tokenize: () => [{ surface_form: "日本", reading: "ニホン" }] });
    expect(document.blocks[0]).toEqual(spacer);
  });

  it("reuses a complete multi-segment source base across whole token boundaries", () => {
    const tokenizer: TokenizerLike = {
      tokenize: (text) => text === "異世界"
        ? [{ surface_form: "異", reading: "イ" }, { surface_form: "世界", reading: "セカイ" }]
        : [{ surface_form: text }],
    };
    const sourceRuby: InlineNode = {
      type: "ruby",
      segments: [{ base: "異", reading: "い" }, { base: "世界", reading: "せかい" }],
      origin: "source",
      readingType: "kana",
    };
    const documents = [documentWith([[sourceRuby], [{ type: "text", value: "異世界" }]])];
    const stats = annotateDocuments(documents, tokenizer);
    expect(stats.reusedRubyCount).toBe(1);
    const second = documents[0]?.blocks[1];
    if (second?.type !== "text") throw new Error("missing text block");
    expect(second.variants[0]?.content).toEqual([{
      type: "ruby",
      segments: [{ base: "異世界", reading: "いせかい" }],
      origin: "reused",
      readingType: "kana",
    }]);
  });

  it("does not reuse a source base embedded inside a larger tokenizer token", () => {
    const tokenizer: TokenizerLike = {
      tokenize: (text) => text === "生物"
        ? [{ surface_form: "生物", reading: "セイブツ" }]
        : [{ surface_form: text }],
    };
    const sourceRuby: InlineNode = { type: "ruby", segments: [{ base: "生", reading: "なま" }], origin: "source", readingType: "kana" };
    const documents = [documentWith([[sourceRuby], [{ type: "text", value: "生物" }]])];
    const stats = annotateDocuments(documents, tokenizer);
    expect(stats).toEqual({ reusedRubyCount: 0, generatedRubyCount: 1, katakanaRomajiCount: 0, skippedLowConfidenceCount: 0 });
    const second = documents[0]?.blocks[1];
    if (second?.type !== "text") throw new Error("missing text block");
    expect(second.variants[0]?.content).toEqual([{
      type: "ruby",
      segments: [{ base: "生物", reading: "せいぶつ" }],
      origin: "generated",
      readingType: "kana",
    }]);
  });

  it("does not reuse a source base with conflicting publisher readings", () => {
    const tokenizer: TokenizerLike = { tokenize: () => [{ surface_form: "生", reading: "セイ" }] };
    const documents = [documentWith([
      [{ type: "ruby", segments: [{ base: "生", reading: "なま" }], origin: "source", readingType: "kana" }],
      [{ type: "ruby", segments: [{ base: "生", reading: "せい" }], origin: "source", readingType: "kana" }],
      [{ type: "text", value: "生" }],
    ])];
    const stats = annotateDocuments(documents, tokenizer);
    expect(stats).toEqual({ reusedRubyCount: 0, generatedRubyCount: 1, katakanaRomajiCount: 0, skippedLowConfidenceCount: 0 });
    const third = documents[0]?.blocks[2];
    if (third?.type !== "text") throw new Error("missing text block");
    expect(third.variants[0]?.content[0]).toMatchObject({ type: "ruby", origin: "generated" });
  });

  it("keeps unknown words and person names unchanged", () => {
    const tokenizer: TokenizerLike = {
      tokenize: () => [
        { surface_form: "造語", reading: "ゾウゴ", word_type: "UNKNOWN" },
        { surface_form: "山田", reading: "ヤマダ", pos_detail_2: "人名" },
      ],
    };
    const documents = [documentWith([[{ type: "text", value: "造語山田" }]])];
    const stats = annotateDocuments(documents, tokenizer);
    expect(stats).toEqual({ reusedRubyCount: 0, generatedRubyCount: 0, katakanaRomajiCount: 0, skippedLowConfidenceCount: 2 });
  });

  it("adds modified-Hepburn romaji only to katakana tokens", () => {
    const tokenizer: TokenizerLike = {
      tokenize: () => [
        { surface_form: "コンピューター", reading: "コンピューター" },
        { surface_form: "と", reading: "ト" },
        { surface_form: "ゲーム", reading: "ゲーム" },
        { surface_form: "地獄", reading: "ジゴク" },
      ],
    };
    const documents = [documentWith([[{ type: "text", value: "コンピューターとゲーム地獄" }]])];
    const stats = annotateDocuments(documents, tokenizer);
    expect(stats).toEqual({ reusedRubyCount: 0, generatedRubyCount: 1, katakanaRomajiCount: 2, skippedLowConfidenceCount: 0 });
    const block = documents[0]?.blocks[0];
    if (block?.type !== "text") throw new Error("missing text block");
    expect(block.variants[0]?.content).toEqual([
      { type: "ruby", segments: [{ base: "コンピューター", reading: "konpyūtā" }], origin: "generated", readingType: "romaji" },
      { type: "text", value: "と" },
      { type: "ruby", segments: [{ base: "ゲーム", reading: "gēmu" }], origin: "generated", readingType: "romaji" },
      { type: "ruby", segments: [{ base: "地獄", reading: "じごく" }], origin: "generated", readingType: "kana" },
    ]);
  });

  it("uses macrons for katakana long marks and preserves modified-Hepburn clusters", () => {
    expect(katakanaToRomaji("ファイナル")).toBe("fainaru");
    expect(katakanaToRomaji("コンピューター")).toBe("konpyūtā");
    expect(katakanaToRomaji("マッチ")).toBe("matchi");
  });

  it("keeps a standalone small tsu when it has no independent romanization", () => {
    const documents = [documentWith([[{ type: "text", value: "ッ" }]])];
    const stats = annotateDocuments(documents, { tokenize: () => [{ surface_form: "ッ", reading: "ッ" }] });
    expect(stats).toEqual({ reusedRubyCount: 0, generatedRubyCount: 0, katakanaRomajiCount: 0, skippedLowConfidenceCount: 0 });
    const block = documents[0]?.blocks[0];
    if (block?.type !== "text") throw new Error("missing text block");
    expect(block.variants[0]?.content).toEqual([{ type: "text", value: "ッ" }]);
  });

  it("loads the bundled Kuromoji/IPADIC tokenizer", async () => {
    const tokenizer = await loadTokenizer();
    expect(tokenizer.tokenize("日本語").length).toBeGreaterThan(0);
  }, 20_000);
});
