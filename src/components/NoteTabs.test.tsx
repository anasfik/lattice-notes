import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import NoteTabs from './NoteTabs';
import type { Note } from '../domain/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function note(id: string, name: string): Note {
  return {
    id,
    name,
    body: `# ${name}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
  };
}

/** The buttons of the tab strip, in the order of the strip. */
function tabLabels(): string[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.tabs__label')).map(
    (button) => button.textContent?.trim() ?? '',
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

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('note tabs', () => {
  it('shows one button per open note', async () => {
    await render(
      <NoteTabs
        notes={[note('a', 'Alpha'), note('b', 'Beta')]}
        activeNoteId="a"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(tabLabels()).toEqual(['Alpha', 'Beta']);
  });

  it('marks the note that is on the screen', async () => {
    await render(
      <NoteTabs
        notes={[note('a', 'Alpha'), note('b', 'Beta')]}
        activeNoteId="b"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    const labels = container.querySelectorAll<HTMLButtonElement>('.tabs__label');
    expect(labels[0]?.getAttribute('aria-current')).toBeNull();
    expect(labels[1]?.getAttribute('aria-current')).toBe('true');
  });

  it('opens the note of a tab', async () => {
    const opened: string[] = [];
    await render(
      <NoteTabs
        notes={[note('a', 'Alpha'), note('b', 'Beta')]}
        activeNoteId="a"
        onSelect={(id) => opened.push(id)}
        onClose={() => {}}
      />,
    );

    await click(container.querySelectorAll<HTMLButtonElement>('.tabs__label')[1] as Element);

    expect(opened).toEqual(['b']);
  });

  it('has a close control with a name that is not inside the tab', async () => {
    const closed: string[] = [];
    await render(
      <NoteTabs
        notes={[note('a', 'Alpha')]}
        activeNoteId="a"
        onSelect={() => {}}
        onClose={(id) => closed.push(id)}
      />,
    );

    const close = container.querySelector<HTMLButtonElement>('.tabs__close');
    expect(close?.getAttribute('aria-label')).toBe('Close Alpha');
    // The close control is a sibling of the tab, never a child of it.
    expect(close?.closest('.tabs__label')).toBeNull();
    expect(container.querySelector('.tabs__label button')).toBeNull();

    await click(close as Element);

    expect(closed).toEqual(['a']);
  });

  it('puts the keyboard on the tab of a focus request', async () => {
    await render(
      <NoteTabs
        notes={[note('a', 'Alpha'), note('b', 'Beta')]}
        activeNoteId="a"
        onSelect={() => {}}
        onClose={() => {}}
        focusRequest={{ id: 'b', request: 1 }}
      />,
    );

    const labels = container.querySelectorAll<HTMLButtonElement>('.tabs__label');
    expect(document.activeElement).toBe(labels[1]);
  });

  it('shows nothing when no note is open', async () => {
    await render(<NoteTabs notes={[]} activeNoteId={null} onSelect={() => {}} onClose={() => {}} />);

    expect(container.querySelectorAll('.tabs__label')).toHaveLength(0);
  });
});
