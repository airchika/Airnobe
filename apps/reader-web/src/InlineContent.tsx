import { Fragment, type ReactNode } from "react";
import type { InlineNode, LinkTarget } from "@airnobe/book-format";

interface InlineContentProps {
  nodes: InlineNode[];
  showAssistedRuby: boolean;
  showKatakanaRomaji: boolean;
  assistedRubyPhase?: RubyVisibilityPhase | undefined;
  katakanaRomajiPhase?: RubyVisibilityPhase | undefined;
  assetUrlById: Map<string, string>;
  onInternalLink(target: Extract<LinkTarget, { kind: "internal" }>): void;
}

export type RubyVisibilityPhase = "hidden" | "expanding" | "entering" | "visible" | "fading" | "collapsing";

export function InlineContent({
  nodes,
  showAssistedRuby,
  showKatakanaRomaji,
  assistedRubyPhase,
  katakanaRomajiPhase,
  assetUrlById,
  onInternalLink,
}: InlineContentProps): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    switch (node.type) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "ruby": {
        const visible = node.readingType === "romaji"
          ? showKatakanaRomaji
          : node.origin === "source" || showAssistedRuby;
        const phase = node.origin === "source"
          ? "visible"
          : node.readingType === "romaji"
            ? katakanaRomajiPhase ?? (showKatakanaRomaji ? "visible" : "hidden")
            : assistedRubyPhase ?? (showAssistedRuby ? "visible" : "hidden");
        return (
          <Fragment key={key}>
            {node.segments.map((segment, segmentIndex) => (
              <ruby
                className={`ruby ruby--${node.origin}${node.readingType === "romaji" ? " ruby--romaji" : ""} ruby--${phase}`}
                data-ruby-origin={node.origin}
                data-ruby-reading-type={node.readingType}
                key={`${key}-${segmentIndex}`}
              >
                {segment.base}<rt aria-hidden={!visible}>{segment.reading}</rt>
              </ruby>
            ))}
          </Fragment>
        );
      }
      case "emphasis": {
        const content = (
          <InlineContent
            nodes={node.children}
            showAssistedRuby={showAssistedRuby}
            showKatakanaRomaji={showKatakanaRomaji}
            assistedRubyPhase={assistedRubyPhase}
            katakanaRomajiPhase={katakanaRomajiPhase}
            assetUrlById={assetUrlById}
            onInternalLink={onInternalLink}
          />
        );
        if (node.style === "strong") return <strong key={key}>{content}</strong>;
        if (node.style === "italic") return <em key={key}>{content}</em>;
        return <span className="emphasis-sesame" key={key}>{content}</span>;
      }
      case "lineBreak":
        return <br key={key} />;
      case "image": {
        const source = assetUrlById.get(node.assetId);
        return source
          ? <img className="inline-gaiji" src={source} alt={node.alt} key={key} />
          : <span className="missing-asset" key={key}>{node.alt || "[外字缺失]"}</span>;
      }
      case "link": {
        const content = (
          <InlineContent
            nodes={node.children}
            showAssistedRuby={showAssistedRuby}
            showKatakanaRomaji={showKatakanaRomaji}
            assistedRubyPhase={assistedRubyPhase}
            katakanaRomajiPhase={katakanaRomajiPhase}
            assetUrlById={assetUrlById}
            onInternalLink={onInternalLink}
          />
        );
        if (node.target.kind === "external") {
          return <a href={node.target.url} target="_blank" rel="noreferrer" key={key}>{content}</a>;
        }
        return (
          <a
            href={`#${node.target.fragmentId ?? node.target.documentId}`}
            onClick={(event) => {
              event.preventDefault();
              onInternalLink(node.target as Extract<LinkTarget, { kind: "internal" }>);
            }}
            key={key}
          >
            {content}
          </a>
        );
      }
    }
  });
}
