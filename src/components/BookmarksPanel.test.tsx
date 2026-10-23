import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import BookmarksPanel from './BookmarksPanel';
import type { Bookmark } from '../domain/bookmarks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOOKMARK: Bookmark = {
  id: 'note:note-1',
  kind: 'note',
  target: 'note-1',
  title: 'Roadmap',
  group: 'Notes',
};

let container: HTMLDivElement;
let root: Root;

/** What the panel was asked to do, in the order it was asked. */
const CALLS: string[] = [];

function Harness(props: { bookmarks?: Bookmark[]; activeBookmarked?: boolean }) {
  const [list, setList] = useState<Bookmark[]>(props.bookmarks ?? []);
  const [active, setActive] = useState(props.activeBookmarked ?? false);
  return (
    <BookmarksPanel
      bookmarks={list}
      activeBookmarked={active}
      hasActiveNote
      onToggleActive={() => {
        CALLS.push('toggle');
        setActive((value) => !value);
      }}
      onOpen={(bookmark) => {
        CALLS.push(`open:${bookmark.title}`);
      }}
      onRemove={(bookmark) => {
        CALLS.push(`remove:${bookmark.title}`);
        setList((items) => items.filter((item) => item.id !== bookmark.id));
      }}
    />
  );
}

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
  });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function button(selector: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(selector);
  if (!found) throw new Error(`no button for "${selector}"`);
  return found;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  CALLS.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('the bookmarks panel', () => {
  it('a bookmark can be added and removed with the keyboard', async () => {
    await render(<Harness bookmarks={[BOOKMARK]} />);

    // The control that adds the note of the screen is a button, so the
    // keyboard reaches it.
    const add = button('.bookmarks__add');
    add.focus();
    expect(document.activeElement).toBe(add);
    await click(add);
    expect(CALLS).toContain('toggle');

    // The control that takes a bookmark off is a button as well.
    const remove = button('.bookmarks__remove');
    remove.focus();
    expect(document.activeElement).toBe(remove);
    await click(remove);

    expect(CALLS).toContain('remove:Roadmap');
    expect(container.querySelectorAll('.bookmarks__item')).toHaveLength(0);
  });

  it('an empty bookmark list shows its empty state', async () => {
    await render(<Harness bookmarks={[]} />);

    expect(container.querySelector('.bookmarks__empty')?.textContent).toContain('No bookmarks');
    expect(container.querySelectorAll('.bookmarks__item')).toHaveLength(0);
  });

  it('lists the bookmarks in groups', async () => {
    await render(
      <Harness
        bookmarks={[
          BOOKMARK,
          { id: 'note:note-2', kind: 'note', target: 'note-2', title: 'Atlas', group: 'Work' },
        ]}
      />,
    );

    const groups = Array.from(container.querySelectorAll('.bookmarks__group-name')).map(
      (element) => element.textContent?.trim() ?? '',
    );
    expect(groups).toEqual(['Notes', 'Work']);
  });

  it('names every control that takes a bookmark off', async () => {
    await render(<Harness bookmarks={[BOOKMARK]} />);

    expect(button('.bookmarks__remove').getAttribute('aria-label')).toContain('Roadmap');
  });
});
