import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import ContextRail from './ContextRail';
import type { LocalGraph } from '../domain/vault';
import type { Note } from '../domain/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function note(name: string, body = ''): Note {
  return {
    id: `id-${name}`,
    name,
    body,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
  };
}

/** A graph with no connections at all. */
function emptyGraph(): LocalGraph {
  return { activeId: '', nodes: [], edges: [], backlinks: [] };
}

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

describe('context rail', () => {
  it('hides the stale backlink count while the graph is behind', async () => {
    await render(
      <ContextRail
        note={note('Solo')}
        graph={emptyGraph()}
        noteNames={new Set(['solo'])}
        graphPending
        onSelect={() => {}}
        onNavigate={() => {}}
        onWikiLink={() => {}}
      />,
    );

    const heading = container.querySelector('nav[aria-label="Backlinks"] h3')?.textContent ?? '';
    expect(heading).toBe('Backlinks');
    expect(heading).not.toContain('(0)');
    expect(container.querySelector('nav[aria-label="Backlinks"]')?.getAttribute('aria-busy')).toBe(
      'true',
    );
  });

  it('shows the backlink count once the graph has settled', async () => {
    await render(
      <ContextRail
        note={note('Solo')}
        graph={emptyGraph()}
        noteNames={new Set(['solo'])}
        onSelect={() => {}}
        onNavigate={() => {}}
        onWikiLink={() => {}}
      />,
    );

    const heading = container.querySelector('nav[aria-label="Backlinks"] h3')?.textContent ?? '';
    expect(heading).toBe('Backlinks (0)');
  });

  it('keeps the empty graph message while the graph is behind', async () => {
    await render(
      <ContextRail
        note={note('Solo')}
        graph={emptyGraph()}
        noteNames={new Set(['solo'])}
        graphPending
        onSelect={() => {}}
        onNavigate={() => {}}
        onWikiLink={() => {}}
      />,
    );

    const empty = container.querySelector('.graph__empty')?.textContent ?? '';
    expect(empty).toContain('No local connections yet');
    expect(empty).not.toContain('Updating links');
  });
});
