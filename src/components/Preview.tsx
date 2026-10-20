import { Fragment, type ReactNode } from 'react';

import { parseNote } from '../domain/markdown';
import type { BlockNode, InlineNode } from '../domain/markdown';
import { normalizeNoteName } from '../domain/vault';

export interface PreviewProps {
  body: string;
  onWikiLink(target: string): void;
  /** Lower cased names of the active notes, so a missing target can say so. */
  existingNames?: ReadonlySet<string>;
}

interface RenderContext {
  onWikiLink(target: string): void;
  existingNames?: ReadonlySet<string>;
}

/**
 * Renders parsed Markdown as React nodes only.
 *
 * The parser never produces HTML, so nothing here can execute imported
 * markup. Ordinary links become anchors with the vetted href, wiki links
 * become buttons that ask the app to select a note. A wiki link without a
 * target names the note it would create, so the outcome is never a surprise.
 */
export default function Preview({ body, onWikiLink, existingNames }: PreviewProps) {
  const parsed = parseNote(body);
  const context: RenderContext = { onWikiLink, existingNames };

  return (
    <section className="preview" aria-labelledby="preview-title">
      <h2 className="preview__title" id="preview-title">
        Preview
      </h2>
      <div className="preview__body">
        {parsed.blocks.length === 0 ? (
          <p className="preview__empty">
            Nothing to preview yet. It follows the Markdown you write in the editor.
          </p>
        ) : (
          parsed.blocks.map((block, index) => renderBlock(block, index, context))
        )}
      </div>
    </section>
  );
}

function renderBlock(block: BlockNode, key: number, context: RenderContext): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const content = renderInline(block.inline, context);
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
      return <p key={key}>{renderInline(block.inline, context)}</p>;
    case 'quote':
      return <blockquote key={key}>{renderInline(block.inline, context)}</blockquote>;
    case 'list':
      return block.ordered ? (
        <ol key={key} role="list">
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item, context)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} role="list">
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item, context)}</li>
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

function renderInline(nodes: InlineNode[], context: RenderContext): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>;
      case 'emphasis':
        return <em key={index}>{renderInline(node.inline, context)}</em>;
      case 'strong':
        return <strong key={index}>{renderInline(node.inline, context)}</strong>;
      case 'code':
        return <code key={index}>{node.text}</code>;
      case 'wikiLink': {
        const missing = !context.existingNames?.has(
          normalizeNoteName(node.target).toLowerCase(),
        );
        const label = missing ? createLabel(node.target, node.alias) : (node.alias ?? node.target);
        return (
          <button
            key={index}
            type="button"
            className={missing ? 'preview__wikilink preview__wikilink--missing' : 'preview__wikilink'}
            onClick={() => context.onWikiLink(node.target)}
          >
            {label}
          </button>
        );
      }
      case 'link': {
        // Only a link that leaves the app opens a new tab. A relative target
        // or a fragment stays in this tab, or it would open a second copy of
        // the app.
        const external = isExternal(node.href);
        return (
          <a
            key={index}
            href={node.href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {node.text}
          </a>
        );
      }
      case 'tag':
        return (
          <span key={index} className="preview__tag">
            #{node.text}
          </span>
        );
    }
  });
}

/**
 * True for a link that leaves the app: an absolute web or mail address.
 * Everything else (a relative path, a fragment) stays in the same tab.
 */
function isExternal(href: string): boolean {
  return /^(?:https?:|mailto:)/i.test(href.trim());
}

/**
 * The visible name of a link that would create its target. The alias stays in
 * the name, so the visible text is part of the accessible name.
 */
function createLabel(target: string, alias: string | null): string {
  const name = normalizeNoteName(target);
  return alias ? `Create note ${name} (${alias})` : `Create note ${name}`;
}
