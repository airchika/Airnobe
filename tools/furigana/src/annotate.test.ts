import type { BookDocument, InlineNode } from "@airnobe/book-format";
import { describe, expect, it } from "vitest";
import { annotateDocuments, type TokenizerLike } from "./annotate.js";
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
    expect(stats.generatedRubyCount).toBe(2);
    const content = documents[0]?.blocks[0];
    if (content?.type !== "text") throw new Error("missing text block");
    expect(content.variants[0]?.content).toEqual([
      { type: "ruby", segments: [{ base: "私", reading: "わたし" }], origin: "generated" },
      { type: "text", value: " は" },
      { type: "ruby", segments: [{ base: "食", reading: "た" }], origin: "generated" },
      { type: "text", value: "べる" },
      { type: "text", value: "。" },
    ]);
  });

  it("protects source ruby and reuses only a book-unique reading at token boundaries", () => {
    const tokenizer: TokenizerLike = { tokenize: () => [{ surface_form: "生", reading: "セイ" }] };
    const sourceRuby: InlineNode = { type: "ruby", segments: [{ base: "生", reading: "なま" }], origin: "source" };
    const documents = [documentWith([[sourceRuby], [{ type: "text", value: "生" }]])];
    const stats = annotateDocuments(documents, tokenizer);
    expect(stats.generatedRubyCount).toBe(1);
    const first = documents[0]?.blocks[0];
    const second = documents[0]?.blocks[1];
    if (first?.type !== "text" || second?.type !== "text") throw new Error("missing text block");
    expect(first.variants[0]?.content).toEqual([sourceRuby]);
    expect(second.variants[0]?.content).toEqual([{ type: "ruby", segments: [{ base: "生", reading: "なま" }], origin: "generated" }]);
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
    expect(stats).toEqual({ generatedRubyCount: 0, skippedLowConfidenceCount: 2 });
  });

  it("loads the bundled Kuromoji/IPADIC tokenizer", async () => {
    const tokenizer = await loadTokenizer();
    expect(tokenizer.tokenize("日本語").length).toBeGreaterThan(0);
  }, 20_000);
});
