import { describe, expect, it } from 'vitest';

import { parseNote, toPlainText } from './markdown';
import type { BlockNode, InlineNode } from './markdown';

function inlineNodes(block: BlockNode | undefined): InlineNode[] {
  if (!block) return [];
  if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'quote') return block.inline;
  if (block.kind === 'list') return block.items.flat();
  return [];
}

/** Flattens nested inline nodes so nested content is asserted too. */
function collectInline(nodes: InlineNode[]): InlineNode[] {
  const collected: InlineNode[] = [];
  for (const node of nodes) {
    collected.push(node);
    const nested = (node as { inline?: InlineNode[] }).inline;
    if (nested) collected.push(...collectInline(nested));
  }
  return collected;
}

function allInline(blocks: BlockNode[]): InlineNode[] {
  return blocks.flatMap((block) => collectInline(inlineNodes(block)));
}

describe('parseNote structure', () => {
  it('reads headings with their level and text', () => {
    const parsed = parseNote('# Title\n\n## Section\n\nbody');

    expect(parsed.headings).toEqual([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Section' },
    ]);
  });

  it('keeps fenced code verbatim and never parses it as markdown', () => {
    const parsed = parseNote('```ts\nconst x = 1; // #tag [[Link]]\n```');

    expect(parsed.blocks[0]).toEqual({ kind: 'code', language: 'ts', text: 'const x = 1; // #tag [[Link]]' });
    expect(parsed.tags).toEqual([]);
    expect(parsed.links).toEqual([]);
  });

  it('reads unordered and ordered lists', () => {
    const parsed = parseNote('- one\n- two\n\n1. first\n2. second');

    expect(parsed.blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(parsed.blocks[1]).toMatchObject({ kind: 'list', ordered: true });
    const list = parsed.blocks[1];
    if (list?.kind !== 'list') throw new Error('expected a list block');
    expect(list.items).toHaveLength(2);
  });

  it('reads emphasis and strong emphasis', () => {
    const parsed = parseNote('plain *italic* and **strong** text');
    const kinds = allInline(parsed.blocks).map((node) => node.kind);

    expect(kinds).toContain('emphasis');
    expect(kinds).toContain('strong');
  });

  it('leaves a lone asterisk between spaces as text', () => {
    const parsed = parseNote('2 * 3 * 4');

    expect(allInline(parsed.blocks).every((node) => node.kind === 'text')).toBe(true);
    expect(parsed.plainText).toBe('2 * 3 * 4');
  });

  it('keeps escaped markup as literal text', () => {
    const parsed = parseNote('\\[not a link\\] and \\#not-a-tag');

    expect(parsed.links).toEqual([]);
    expect(parsed.tags).toEqual([]);
    expect(parsed.plainText).toBe('[not a link] and #not-a-tag');
  });
});

describe('parseNote nested inline content', () => {
  it('keeps wiki links and tags inside emphasis and strong', () => {
    const parsed = parseNote('**See [[Roadmap]]** and **#urgent**');

    expect(parsed.links).toEqual([{ target: 'Roadmap', alias: null, heading: null }]);
    expect(parsed.tags).toEqual(['urgent']);
    expect(parsed.plainText).toBe('See Roadmap and urgent');
  });

  it('keeps wiki links and tags inside plain emphasis', () => {
    const parsed = parseNote('*See [[Roadmap]]* and *#urgent*');

    expect(parsed.links).toEqual([{ target: 'Roadmap', alias: null, heading: null }]);
    expect(parsed.tags).toEqual(['urgent']);
    expect(parsed.plainText).toBe('See Roadmap and urgent');
  });
});

describe('parseNote input ceiling', () => {
  it('stops parsing a very long single line instead of freezing', () => {
    const body = '['.repeat(100_000);
    const started = Date.now();
    const parsed = parseNote(body);
    const elapsed = Date.now() - started;

    expect(parsed.blocks).toHaveLength(1);
    const block = parsed.blocks[0];
    if (block?.kind !== 'paragraph') throw new Error('expected a paragraph block');
    expect(block.inline).toHaveLength(1);
    const first = block.inline[0];
    if (first?.kind !== 'text') throw new Error('expected a single text node');
    expect(first.text).toHaveLength(100_000);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('parseNote wiki links', () => {
  it('reads a bare target', () => {
    const parsed = parseNote('See [[Roadmap]] for details');

    expect(parsed.links).toEqual([{ target: 'Roadmap', alias: null, heading: null }]);
  });

  it('keeps empty and separator-only wiki targets as literal text', () => {
    const parsed = parseNote('[[]] and [[|]] and [[#]]');

    expect(parsed.links).toEqual([]);
    expect(parsed.tags).toEqual([]);
    expect(parsed.plainText).toBe('[[]] and [[|]] and [[#]]');
  });

  it('keeps the first alias of a repeated target and heading', () => {
    const parsed = parseNote('[[Roadmap]] then [[Roadmap|The plan]]');

    expect(parsed.links).toEqual([{ target: 'Roadmap', alias: null, heading: null }]);
  });

  it('reads an alias and an optional heading', () => {
    const parsed = parseNote('[[Roadmap|The plan]] and [[Roadmap#Q3]]');

    expect(parsed.links).toEqual([
      { target: 'Roadmap', alias: 'The plan', heading: null },
      { target: 'Roadmap', alias: null, heading: 'Q3' },
    ]);
  });

  it('ignores empty links and links inside code spans', () => {
    const parsed = parseNote('[[]] and `[[Roadmap]]`');

    expect(parsed.links).toEqual([]);
  });
});

describe('parseNote tags', () => {
  it('collects unique lowercase tags', () => {
    const parsed = parseNote('Tagged #work/alpha and #Work and #tag.');

    expect(parsed.tags).toEqual(['work/alpha', 'work', 'tag']);
  });

  it('reads slash, dash and underscore tags', () => {
    const parsed = parseNote('#work/alpha #work-log #work_log');

    expect(parsed.tags).toEqual(['work/alpha', 'work-log', 'work_log']);
  });

  it('does not treat headings, code, words, or urls as tags', () => {
    const parsed = parseNote('# Heading\n\nC# and https://example.com/#frag and `#inline`');

    expect(parsed.tags).toEqual([]);
  });
});

describe('parseNote safety', () => {
  it('keeps hostile html as literal text', () => {
    const parsed = parseNote('<script>alert(1)</script>');
    const allowed = new Set(['text', 'emphasis', 'strong', 'code', 'wikiLink', 'link', 'tag']);

    expect(parsed.plainText).toContain('<script>alert(1)</script>');
    for (const node of allInline(parsed.blocks)) {
      expect(allowed.has(node.kind)).toBe(true);
    }
  });

  it('keeps unsafe link targets as text', () => {
    const parsed = parseNote('click [here](javascript:alert(1))');
    const kinds = allInline(parsed.blocks).map((node) => node.kind);

    expect(kinds).not.toContain('link');
    expect(parsed.plainText).toContain('javascript:alert(1)');
  });

  it('keeps ordinary links with safe targets', () => {
    const parsed = parseNote('read [docs](https://example.com) or [note](./other.md)');
    const links = allInline(parsed.blocks).filter((node) => node.kind === 'link');

    expect(links).toEqual([
      { kind: 'link', text: 'docs', href: 'https://example.com' },
      { kind: 'link', text: 'note', href: './other.md' },
    ]);
  });

  it('keeps a link with whitespace in the target as text', () => {
    const parsed = parseNote('read [docs](https://example.com/a b)');
    const kinds = allInline(parsed.blocks).map((node) => node.kind);

    expect(kinds).not.toContain('link');
    expect(parsed.plainText).toBe('read [docs](https://example.com/a b)');
  });
});

describe('toPlainText', () => {
  it('strips markdown markers but keeps the words', () => {
    expect(toPlainText('# Title\n\nSome *body* with `code` and [[Link]].')).toBe(
      'Title\nSome body with code and Link.',
    );
  });
});

describe('parseNote performance', () => {
  it('parses a megabyte of unmatched brackets without rescanning the tail', () => {
    // 55 paragraphs of 19,000 unmatched "[" — the same corpus the import cap
    // must survive. Each paragraph stays under the 20k inline ceiling, so this
    // measures the scan, not the fallback.
    const paragraph = '['.repeat(19_000);
    const body = Array.from({ length: 55 }, () => paragraph).join('\n\n');
    expect(body.length).toBe(1_045_108);

    const started = Date.now();
    const parsed = parseNote(body);
    const elapsed = Date.now() - started;

    expect(parsed.blocks).toHaveLength(55);
    for (const block of parsed.blocks) {
      if (block.kind !== 'paragraph') throw new Error('expected a paragraph block');
      expect(block.inline).toHaveLength(1);
      const node = block.inline[0];
      if (node?.kind !== 'text') throw new Error('expected a single text node');
      expect(node.text).toBe(paragraph);
    }
    expect(parsed.plainText).toBe(Array.from({ length: 55 }, () => paragraph).join('\n'));
    expect(parsed.links).toEqual([]);
    expect(parsed.tags).toEqual([]);
    expect(elapsed).toBeLessThan(1_500);
  }, 60_000);

  it('dedupes many unique wiki links and tags without a quadratic scan', () => {
    const count = 10_000;
    const entries = Array.from({ length: count }, (_, index) => `[[L${index}]] and #T${index}`);
    const paragraphs: string[] = [];
    for (let index = 0; index < entries.length; index += 50) {
      paragraphs.push(entries.slice(index, index + 50).join(' '));
    }
    // Keys are spread over paragraphs so no inline run reaches the 20k
    // fallback; the measured path is the dedupe, not the ceiling.
    for (const paragraph of paragraphs) expect(paragraph.length).toBeLessThan(20_000);
    const body = paragraphs.join('\n\n');

    const started = Date.now();
    const parsed = parseNote(body);
    const elapsed = Date.now() - started;

    expect(parsed.links.map((link) => link.target)).toEqual(
      Array.from({ length: count }, (_, index) => `L${index}`),
    );
    expect(parsed.tags).toEqual(Array.from({ length: count }, (_, index) => `t${index}`));
    expect(elapsed).toBeLessThan(1_500);
  }, 60_000);
});
