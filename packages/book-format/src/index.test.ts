import { describe, expect, it } from "vitest";
import { inlinePlainText, InlineNodeSchema } from "./index.js";

describe("book format", () => {
  it("derives plain text from structured ruby without storing duplicate HTML", () => {
    const nodes = InlineNodeSchema.array().parse([
      { type: "text", value: "今日は" },
      {
        type: "ruby",
        origin: "source",
        segments: [{ base: "学校", reading: "がっこう" }],
      },
      { type: "lineBreak" },
      { type: "emphasis", style: "sesame", children: [{ type: "text", value: "です" }] },
    ]);
    expect(inlinePlainText(nodes)).toBe("今日は学校\nです");
  });
});
