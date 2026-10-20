import { Fragment, type ReactNode } from 'react';

import { parseNote } from '../domain/markdown';
import type { BlockNode, InlineNode } from '../domain/markdown';

export interface PreviewProps {
  body: string;
  onWikiLink(target: string): void;
}

/**
 * Renders parsed Markdown as React nodes only.
 *
 * The parser never produces HTML, so nothing here can execute imported
 * markup. Ordinary links become anchors with the vetted href, wiki links
 * become buttons that ask the app to select a note.
 */
export default function Preview({ body, onWikiLink }: PreviewProps) {
  const parsed = parseNote(body);

  return (
    <section className="preview" aria-labelledby="preview-title">
      <h2 className="preview__title" id="preview-title">
        Preview
      </h2>
      <div className="preview__body">
        {parsed.blocks.map((block, index) => renderBlock(block, index, onWikiLink))}
      </div>
    </section>
  );
}

function renderBlock(block: BlockNode, key: number, onWikiLink: (target: string) => void): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const content = renderInline(block.inline, onWikiLink);
      switch (block.level) {
        case 1:
          return <h2 key={key}>{content}</h2>;
        case 2:
          return <h3 key={key}>{content}</h3>;
        case 3:
          return <h4 key={key}>{content}</h4>;
        case 4:
          return <h5 key={key}>{content}</h5>;
        default:
          return <h6 key={key}>{content}</h6>;
      }
    }
    case 'paragraph':
      return <p key={key}>{renderInline(block.inline, onWikiLink)}</p>;
    case 'quote':
      return <blockquote key={key}>{renderInline(block.inline, onWikiLink)}</blockquote>;
    case 'list':
      return block.ordered ? (
        <ol key={key} role="list">
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item, onWikiLink)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} role="list">
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item, onWikiLink)}</li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre key={key} className="preview__code">
          <code className={block.language ? `language-${block.language}` : undefined}>{block.text}</code>
        </pre>
      );
  }
}

function renderInline(nodes: InlineNode[], onWikiLink: (target: string) => void): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>;
      case 'emphasis':
        return <em key={index}>{renderInline(node.inline, onWikiLink)}</em>;
      case 'strong':
        return <strong key={index}>{renderInline(node.inline, onWikiLink)}</strong>;
      case 'code':
        return <code key={index}>{node.text}</code>;
      case 'wikiLink':
        return (
          <button
            key={index}
            type="button"
            className="preview__wikilink"
            onClick={() => onWikiLink(node.target)}
          >
            {node.alias ?? node.target}
          </button>
        );
      case 'link':
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
            {node.text}
          </a>
        );
      case 'tag':
        return (
          <span key={index} className="preview__tag">
            #{node.text}
          </span>
        );
    }
  });
}
