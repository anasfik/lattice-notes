import { describe, expect, it } from 'vitest';

import { groupBookmarks, toggleBookmark } from './bookmarks';
import type { Bookmark } from './bookmarks';

const NOTE = { kind: 'note', target: 'note-1', title: 'Roadmap', group: 'Notes' } as const;

describe('the bookmarks of a vault', () => {
  it('toggling adds and then removes the bookmark', () => {
    const added = toggleBookmark([], NOTE);

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      kind: 'note',
      target: 'note-1',
      title: 'Roadmap',
      group: 'Notes',
    });
    // The id of a bookmark follows from what it points at, so the same
    // bookmark keeps its id in every session.
    expect(toggleBookmark([], NOTE)[0]?.id).toBe(added[0]?.id);

    const removed = toggleBookmark(added, NOTE);

    expect(removed).toEqual([]);
  });

  it('two headings of the same note are different bookmarks', () => {
    const first = toggleBookmark([], {
      kind: 'heading',
      target: 'note-1#intro',
      title: 'Intro',
      group: 'Notes',
    });
    const second = toggleBookmark(first, {
      kind: 'heading',
      target: 'note-1#outro',
      title: 'Outro',
      group: 'Notes',
    });

    expect(second).toHaveLength(2);
    expect(second[0]?.id).not.toBe(second[1]?.id);
  });

  it('grouping sorts by group then title', () => {
    const list: Bookmark[] = [
      { id: 'b', kind: 'note', target: 'note-2', title: 'Beta', group: 'Work' },
      { id: 'a', kind: 'note', target: 'note-1', title: 'Alpha', group: 'Work' },
      { id: 'c', kind: 'note', target: 'note-3', title: 'Gamma', group: 'Archive' },
    ];

    const groups = groupBookmarks(list);

    expect([...groups.keys()]).toEqual(['Archive', 'Work']);
    expect(groups.get('Work')?.map((entry) => entry.title)).toEqual(['Alpha', 'Beta']);
  });
});
