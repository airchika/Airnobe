import { describe, expect, it } from "vitest";
import { inlinePlainText, InlineNodeSchema } from "./index.js";

describe("book format", () => {
  it("derives plain text from structured ruby without storing duplicate HTML", () => {
    const nodes = InlineNodeSchema.array().parse([
      { type: "text", value: "今日は" },
      {
        type: "ruby",
        origin: "source",
        readingType: "kana",
        segments: [{ base: "学校", reading: "がっこう" }],
      },
      { type: "lineBreak" },
      { type: "emphasis", style: "sesame", children: [{ type: "text", value: "です" }] },
    ]);
    expect(inlinePlainText(nodes)).toBe("今日は学校\nです");
  });

  it("accepts publisher, reused, and dictionary-generated ruby origins", () => {
    const origins = ["source", "reused", "generated"] as const;
    for (const origin of origins) {
      expect(InlineNodeSchema.parse({
        type: "ruby",
        origin,
        readingType: "kana",
        segments: [{ base: "本", reading: "ほん" }],
      })).toMatchObject({ origin });
    }
  });

  it("distinguishes kana readings from katakana romaji", () => {
    expect(InlineNodeSchema.parse({
      type: "ruby",
      origin: "generated",
      readingType: "romaji",
      segments: [{ base: "コンピューター", reading: "konpyūtā" }],
    })).toMatchObject({ readingType: "romaji" });
  });
});
