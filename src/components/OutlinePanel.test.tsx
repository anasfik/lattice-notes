import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import OutlinePanel from './OutlinePanel';
import type { OutlineItem } from '../domain/outline';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: OutlineItem[] = [
  { level: 1, text: 'Roadmap', id: 'roadmap-0' },
  { level: 2, text: 'Goals', id: 'goals-1' },
];

let container: HTMLDivElement;
let root: Root;

/** The headings the reader jumped to, in the order they were chosen. */
const JUMPED: string[] = [];

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
  JUMPED.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('the outline panel', () => {
  it('lists the headings of the note and jumps to the chosen one', async () => {
    await render(<OutlinePanel items={ITEMS} onJump={(id) => JUMPED.push(id)} />);

    const links = container.querySelectorAll<HTMLButtonElement>('.outline__link');
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toContain('Roadmap');

    links[1]?.focus();
    expect(document.activeElement).toBe(links[1]);
    await click(links[1] as Element);

    expect(JUMPED).toEqual(['goals-1']);
  });

  it('says when the note has no headings', async () => {
    await render(<OutlinePanel items={[]} onJump={(id) => JUMPED.push(id)} />);

    expect(container.querySelector('.outline__empty')?.textContent).toContain('no headings');
    expect(container.querySelectorAll('.outline__link')).toHaveLength(0);
  });
});
