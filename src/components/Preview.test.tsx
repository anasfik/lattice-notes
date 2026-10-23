import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Preview from './Preview';
import { parseNote } from '../domain/markdown';
import { buildOutline } from '../domain/outline';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
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

describe('the preview of a note', () => {
  it('every heading carries the id the outline links to', async () => {
    const body = '# Roadmap\n\nSome text.\n\n## Goals\n\n### Now\n';
    await render(<Preview body={body} onWikiLink={() => {}} />);

    const outline = buildOutline(parseNote(body).headings);
    const headings = Array.from(
      container.querySelectorAll<HTMLElement>(
        '.preview__body h2, .preview__body h3, .preview__body h4, .preview__body h5, .preview__body h6',
      ),
    );

    expect(outline).toHaveLength(3);
    expect(headings.map((element) => element.id)).toEqual(outline.map((item) => item.id));
    // The ids are unique, so the outline can link to every heading.
    expect(new Set(headings.map((element) => element.id)).size).toBe(3);
  });

  it('two headings with the same text get different ids', async () => {
    const body = '# Notes\n\nOne.\n\n## Notes\n\nTwo.\n';
    await render(<Preview body={body} onWikiLink={() => {}} />);

    const ids = Array.from(container.querySelectorAll<HTMLElement>('.preview__body h2, .preview__body h3'))
      .map((element) => element.id);

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
