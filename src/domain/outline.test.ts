import { describe, expect, it } from 'vitest';

import { buildOutline, headingId } from './outline';

describe('the outline of a note', () => {
  it('the outline lists headings in document order', () => {
    const outline = buildOutline([
      { level: 1, text: 'Roadmap' },
      { level: 2, text: 'Goals' },
      { level: 3, text: 'Now' },
    ]);

    expect(outline.map((item) => item.text)).toEqual(['Roadmap', 'Goals', 'Now']);
    expect(outline.map((item) => item.level)).toEqual([1, 2, 3]);
    expect(outline[0]?.id).toBe(headingId('Roadmap', 0));
  });

  it('two headings with the same text get different ids', () => {
    const outline = buildOutline([
      { level: 2, text: 'Notes' },
      { level: 2, text: 'Notes' },
    ]);

    expect(outline[0]?.id).not.toBe(outline[1]?.id);
    expect(headingId('Notes', 0)).toBe(headingId('Notes', 0));
    expect(headingId('Notes', 0)).not.toBe(headingId('Notes', 1));
  });
});
