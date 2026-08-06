import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InlineNode } from "@airnobe/book-format";
import { InlineContent } from "./InlineContent.js";

const nodes: InlineNode[] = [
  { type: "ruby", origin: "source", readingType: "kana", segments: [{ base: "街", reading: "まち" }] },
  { type: "text", value: "と" },
  { type: "ruby", origin: "reused", readingType: "kana", segments: [{ base: "扉", reading: "とびら" }] },
  { type: "text", value: "と" },
  { type: "ruby", origin: "generated", readingType: "kana", segments: [{ base: "窓", reading: "まど" }] },
  { type: "text", value: "和" },
  { type: "ruby", origin: "generated", readingType: "romaji", segments: [{ base: "ゲーム", reading: "gēmu" }] },
];

describe("InlineContent", () => {
  it("always renders publisher ruby and toggles reused and generated readings together", () => {
    const { rerender } = render(
      <InlineContent nodes={nodes} showAssistedRuby={false} showKatakanaRomaji={false} assetUrlById={new Map()} onInternalLink={() => {}} />,
    );
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.getByText("とびら").parentElement).toHaveClass("ruby--hidden");
    expect(screen.getByText("まど").parentElement).toHaveClass("ruby--hidden");
    expect(screen.getByText("gēmu").parentElement).toHaveClass("ruby--hidden");
    expect(screen.getByText(/窓/)).toBeInTheDocument();

    rerender(<InlineContent nodes={nodes} showAssistedRuby showKatakanaRomaji={false} assetUrlById={new Map()} onInternalLink={() => {}} />);
    expect(screen.getByText("とびら")).toBeInTheDocument();
    expect(screen.getByText("まど")).toBeInTheDocument();
    expect(screen.getByText("gēmu").parentElement).toHaveClass("ruby--hidden");
    expect(document.querySelector('[data-ruby-origin="source"]')).toHaveClass("ruby--source");
    expect(document.querySelector('[data-ruby-origin="reused"]')).toHaveClass("ruby--reused");
    expect(document.querySelector('[data-ruby-origin="generated"]')).toHaveClass("ruby--generated");

    rerender(<InlineContent nodes={nodes} showAssistedRuby={false} showKatakanaRomaji assetUrlById={new Map()} onInternalLink={() => {}} />);
    expect(screen.getByText("とびら").parentElement).toHaveClass("ruby--hidden");
    expect(screen.getByText("まど").parentElement).toHaveClass("ruby--hidden");
    expect(screen.getByText("gēmu")).toBeInTheDocument();
    expect(document.querySelector('[data-ruby-reading-type="romaji"]')).toHaveClass("ruby--romaji");
  });
});
