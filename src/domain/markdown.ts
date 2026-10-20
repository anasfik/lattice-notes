/**
 * Markdown parsing for Lattice Notes.
 *
 * Imported Markdown is untrusted data, so the parser never produces HTML.
 * It returns structured blocks and inline nodes that the UI renders as React
 * nodes, and any raw markup in the source is kept as literal text.
 */

export interface WikiLink {
  target: string;
  alias: string | null;
  heading: string | null;
}

export interface HeadingInfo {
  level: number;
  text: string;
}

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'emphasis'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'wikiLink'; target: string; alias: string | null; heading: string | null }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'tag'; text: string };

export type BlockNode =
  | { kind: 'heading'; level: number; inline: InlineNode[] }
  | { kind: 'paragraph'; inline: InlineNode[] }
  | { kind: 'quote'; inline: InlineNode[] }
  | { kind: 'list'; ordered: boolean; items: InlineNode[][] }
  | { kind: 'code'; language: string | null; text: string };

export interface ParsedNote {
  blocks: BlockNode[];
  headings: HeadingInfo[];
  /** Unique outgoing wiki links, in order of first appearance. */
  links: WikiLink[];
  /** Unique lowercase tags, in order of first appearance. */
  tags: string[];
  /** Readable text without markdown markers. */
  plainText: string;
}

const FENCE = /^(?:```|~~~)\s*([A-Za-z0-9+#-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED_ITEM = /^\s*[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const ORDINARY_LINK = /^\[([^\]]*)\]\(([^)\s]*)\)/;
const TAG = /^#([A-Za-z][A-Za-z0-9_\/-]*)/;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>~|]/;

export function parseNote(body: string): ParsedNote {
  const blocks = parseBlocks(body);
  const headings: HeadingInfo[] = [];
  const links: WikiLink[] = [];
  const tags: string[] = [];

  for (const block of blocks) {
    if (block.kind === 'heading') headings.push({ level: block.level, text: inlineText(block.inline) });
    for (const node of inlineNodesOf(block)) {
      if (node.kind === 'wikiLink') {
        const known = links.some((link) => link.target === node.target && link.heading === node.heading);
        if (!known) links.push({ target: node.target, alias: node.alias, heading: node.heading });
      }
      if (node.kind === 'tag') {
        const tag = node.text.toLowerCase();
        if (!tags.includes(tag)) tags.push(tag);
      }
    }
  }

  return { blocks, headings, links, tags, plainText: blocksToText(blocks) };
}

/** Markdown source reduced to readable text, used for search snippets. */
export function toPlainText(body: string): string {
  return blocksToText(parseBlocks(body));
}

function parseBlocks(body: string): BlockNode[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({
        kind: 'list',
        ordered: list.ordered,
        items: list.items.map((item) => parseInline(item)),
      });
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length > 0) {
      blocks.push({ kind: 'quote', inline: parseInline(quote.join(' ')) });
      quote = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    const fence = FENCE.exec(line);
    if (fence) {
      flushAll();
      const marker = line.trimStart().slice(0, 3);
      const language = fence[1] ? fence[1] : null;
      const code: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (current.trimStart().startsWith(marker)) break;
        code.push(current);
        index += 1;
      }
      blocks.push({ kind: 'code', language, text: code.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      const text = (heading[2] ?? '').replace(/\s+#+\s*$/, '').trim();
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, inline: parseInline(text) });
      continue;
    }

    const unordered = UNORDERED_ITEM.exec(line);
    const ordered = ORDERED_ITEM.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const orderedItem = Boolean(ordered);
      if (!list || list.ordered !== orderedItem) {
        flushList();
        list = { ordered: orderedItem, items: [] };
      }
      list.items.push((unordered?.[1] ?? ordered?.[1] ?? '').trim());
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1] ?? '');
      continue;
    }

    if (line.trim() === '') {
      flushAll();
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  flushAll();
  return blocks;
}

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = '';
  let index = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };

  while (index < text.length) {
    const char = text[index] ?? '';

    if (char === '\\' && ESCAPABLE.test(text[index + 1] ?? '')) {
      buffer += text[index + 1] ?? '';
      index += 2;
      continue;
    }

    if (char === '`') {
      const end = text.indexOf('`', index + 1);
      if (end !== -1) {
        flush();
        nodes.push({ kind: 'code', text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (char === '[' && text[index + 1] === '[') {
      const end = text.indexOf(']]', index + 2);
      const link = end === -1 ? null : parseWikiLink(text.slice(index + 2, end));
      if (link) {
        flush();
        nodes.push({ kind: 'wikiLink', ...link });
        index = end + 2;
        continue;
      }
    }

    if (char === '[') {
      const match = ORDINARY_LINK.exec(text.slice(index));
      if (match && isSafeHref(match[2] ?? '')) {
        flush();
        nodes.push({ kind: 'link', text: match[1] ?? '', href: match[2] ?? '' });
        index += match[0].length;
        continue;
      }
    }

    if (char === '#' && startsTag(text, index)) {
      const match = TAG.exec(text.slice(index));
      const tag = (match?.[1] ?? '').replace(/[-/]+$/, '');
      if (tag) {
        flush();
        nodes.push({ kind: 'tag', text: tag });
        index += (match?.[0].length ?? 0);
        continue;
      }
    }

    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2);
      const content = end === -1 ? '' : text.slice(index + 2, end);
      if (end !== -1 && isInlineContent(content)) {
        flush();
        nodes.push({ kind: 'strong', text: content });
        index = end + 2;
        continue;
      }
    }

    if (char === '*' || char === '_') {
      const previous = index === 0 ? '' : text[index - 1] ?? '';
      const next = text[index + 1] ?? '';
      const bounded = char === '*' || (!/\w/.test(previous) && !/\w/.test(next));
      if (bounded) {
        const end = text.indexOf(char, index + 1);
        const content = end === -1 ? '' : text.slice(index + 1, end);
        if (end > index + 1 && isInlineContent(content)) {
          flush();
          nodes.push({ kind: 'emphasis', text: content });
          index = end + 1;
          continue;
        }
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}

function parseWikiLink(inner: string): WikiLink | null {
  const raw = inner.trim();
  if (!raw) return null;

  const pipe = raw.indexOf('|');
  const targetPart = (pipe === -1 ? raw : raw.slice(0, pipe)).trim();
  const alias = pipe === -1 ? null : raw.slice(pipe + 1).trim() || null;
  const hash = targetPart.indexOf('#');
  const target = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim();
  const heading = hash === -1 ? null : targetPart.slice(hash + 1).trim() || null;

  if (!target) return null;
  return { target, alias, heading };
}

function startsTag(text: string, index: number): boolean {
  const previous = index === 0 ? '' : text[index - 1] ?? '';
  return previous === '' || /\s/.test(previous);
}

/** Markdown emphasis only wraps content that does not start or end with a space. */
function isInlineContent(content: string): boolean {
  return content.length > 0 && !/^\s/.test(content) && !/\s$/.test(content);
}

/** Only http, https, mailto and relative targets may become links. */
function isSafeHref(href: string): boolean {
  const cleaned = href.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return /^(?:https?|mailto):/i.test(cleaned);
  return true;
}

function inlineNodesOf(block: BlockNode): InlineNode[] {
  if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'quote') return block.inline;
  if (block.kind === 'list') return block.items.flat();
  return [];
}

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
        case 'emphasis':
        case 'strong':
        case 'code':
          return node.text;
        case 'tag':
          return node.text;
        case 'wikiLink':
          return node.alias ?? node.target;
        case 'link':
          return node.text;
      }
    })
    .join('');
}

function blocksToText(blocks: BlockNode[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
        case 'quote':
          return inlineText(block.inline);
        case 'list':
          return block.items.map((item) => inlineText(item)).join('\n');
        case 'code':
          return block.text;
      }
    })
    .filter((text) => text.length > 0)
    .join('\n');
}
