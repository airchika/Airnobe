import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InlineNode } from "@airnobe/book-format";
import { InlineContent } from "./InlineContent.js";

const nodes: InlineNode[] = [
  { type: "ruby", origin: "source", segments: [{ base: "街", reading: "まち" }] },
  { type: "text", value: "と" },
  { type: "ruby", origin: "reused", segments: [{ base: "扉", reading: "とびら" }] },
  { type: "text", value: "と" },
  { type: "ruby", origin: "generated", segments: [{ base: "窓", reading: "まど" }] },
];

describe("InlineContent", () => {
  it("always renders publisher ruby and toggles reused and generated readings together", () => {
    const { rerender } = render(
      <InlineContent nodes={nodes} showAssistedRuby={false} assetUrlById={new Map()} onInternalLink={() => {}} />,
    );
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.queryByText("とびら")).not.toBeInTheDocument();
    expect(screen.queryByText("まど")).not.toBeInTheDocument();
    expect(screen.getByText(/窓/)).toBeInTheDocument();

    rerender(<InlineContent nodes={nodes} showAssistedRuby assetUrlById={new Map()} onInternalLink={() => {}} />);
    expect(screen.getByText("とびら")).toBeInTheDocument();
    expect(screen.getByText("まど")).toBeInTheDocument();
    expect(document.querySelector('[data-ruby-origin="source"]')).toHaveClass("ruby--source");
    expect(document.querySelector('[data-ruby-origin="reused"]')).toHaveClass("ruby--reused");
    expect(document.querySelector('[data-ruby-origin="generated"]')).toHaveClass("ruby--generated");
  });
});
