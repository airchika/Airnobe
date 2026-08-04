import { Fragment, type ReactNode } from "react";
import type { InlineNode, LinkTarget } from "@airnobe/book-format";

interface InlineContentProps {
  nodes: InlineNode[];
  showGeneratedRuby: boolean;
  assetUrlById: Map<string, string>;
  onInternalLink(target: Extract<LinkTarget, { kind: "internal" }>): void;
}

export function InlineContent({
  nodes,
  showGeneratedRuby,
  assetUrlById,
  onInternalLink,
}: InlineContentProps): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    switch (node.type) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "ruby": {
        if (node.origin === "generated" && !showGeneratedRuby) {
          return <Fragment key={key}>{node.segments.map((segment) => segment.base).join("")}</Fragment>;
        }
        return (
          <Fragment key={key}>
            {node.segments.map((segment, segmentIndex) => (
              <ruby className={`ruby ruby--${node.origin}`} data-ruby-origin={node.origin} key={`${key}-${segmentIndex}`}>
                {segment.base}<rt>{segment.reading}</rt>
              </ruby>
            ))}
          </Fragment>
        );
      }
      case "emphasis": {
        const content = (
          <InlineContent
            nodes={node.children}
            showGeneratedRuby={showGeneratedRuby}
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
            showGeneratedRuby={showGeneratedRuby}
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
