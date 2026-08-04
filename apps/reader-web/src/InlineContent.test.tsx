import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InlineNode } from "@airnobe/book-format";
import { InlineContent } from "./InlineContent.js";

const nodes: InlineNode[] = [
  { type: "ruby", origin: "source", segments: [{ base: "街", reading: "まち" }] },
  { type: "text", value: "と" },
  { type: "ruby", origin: "generated", segments: [{ base: "窓", reading: "まど" }] },
];

describe("InlineContent", () => {
  it("always renders publisher ruby and can hide generated readings", () => {
    const { rerender } = render(
      <InlineContent nodes={nodes} showGeneratedRuby={false} assetUrlById={new Map()} onInternalLink={() => {}} />,
    );
    expect(screen.getByText("まち")).toBeInTheDocument();
    expect(screen.queryByText("まど")).not.toBeInTheDocument();
    expect(screen.getByText(/窓/)).toBeInTheDocument();

    rerender(<InlineContent nodes={nodes} showGeneratedRuby assetUrlById={new Map()} onInternalLink={() => {}} />);
    expect(screen.getByText("まど")).toBeInTheDocument();
  });
});
