import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Graph from './Graph';
import type { GraphNode, LocalGraph } from '../domain/vault';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function graphNode(
  id: string,
  name: string,
  x: number,
  y: number,
  degree: number,
  active = false,
): GraphNode {
  return { id, name, x, y, degree, active };
}

/** A small graph: one active note with two neighbours. */
function fixture(): LocalGraph {
  return {
    activeId: 'a',
    nodes: [
      graphNode('a', 'Alpha', 0, 0, 2, true),
      graphNode('b', 'Beta', 0, -120, 1),
      graphNode('c', 'Gamma', 104, 60, 1),
    ],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
    ],
    backlinks: ['c'],
  };
}

async function render(element: React.ReactElement, target: HTMLElement = container): Promise<Root> {
  const localRoot = createRoot(target);
  await act(async () => {
    localRoot.render(element);
  });
  return localRoot;
}

function nodes(): SVGGElement[] {
  return Array.from(container.querySelectorAll<SVGGElement>('g[role="button"]'));
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function pressKey(element: Element, key: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => {
    element.dispatchEvent(event);
  });
  return event;
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

describe('local graph', () => {
  it('renders the active note and its neighbours as labelled nodes', async () => {
    await render(<Graph graph={fixture()} onSelect={() => {}} onNavigate={() => {}} />);

    expect(nodes()).toHaveLength(3);
    expect(container.querySelectorAll('.graph__edge')).toHaveLength(2);
    expect(container.querySelector('.graph__node-label')?.textContent).toBe('Alpha');
    expect(nodes()[0]?.getAttribute('aria-current')).toBe('true');
    expect(nodes()[1]?.getAttribute('aria-current')).toBeNull();
    expect(nodes()[1]?.getAttribute('aria-label')).toBe('Beta, 1 connection');
  });

  it('opens a neighbour on a click', async () => {
    const onSelect = vi.fn();
    await render(<Graph graph={fixture()} onSelect={onSelect} onNavigate={() => {}} />);

    await click(nodes()[1] as Element);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('opens a neighbour with the keyboard and swallows the space scroll', async () => {
    const onSelect = vi.fn();
    await render(<Graph graph={fixture()} onSelect={onSelect} onNavigate={() => {}} />);

    const enter = await pressKey(nodes()[1] as Element, 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledWith('b');

    const space = await pressKey(nodes()[2] as Element, ' ');
    expect(space.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('keeps every node in the tab order of the domain', async () => {
    await render(<Graph graph={fixture()} onSelect={() => {}} onNavigate={() => {}} />);

    const tabIndexes = nodes().map((node) => node.getAttribute('tabindex'));
    expect(tabIndexes).toEqual(['0', '0', '0']);
    expect(nodes().map((node) => node.getAttribute('aria-label'))).toEqual([
      'Alpha, 2 connections, current note',
      'Beta, 1 connection',
      'Gamma, 1 connection',
    ]);
  });

  it('pulses the active node only', async () => {
    await render(<Graph graph={fixture()} onSelect={() => {}} onNavigate={() => {}} />);

    expect(nodes()[0]?.querySelector('.graph__pulse')).not.toBeNull();
    expect(nodes()[1]?.querySelector('.graph__pulse')).toBeNull();
    expect(nodes()[2]?.querySelector('.graph__pulse')).toBeNull();
  });

  it('shows an empty state instead of an empty picture', async () => {
    await render(
      <Graph
        graph={{ activeId: '', nodes: [], edges: [], backlinks: [] }}
        onSelect={() => {}}
        onNavigate={() => {}}
      />,
    );

    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.graph__empty')?.textContent).toContain('No local connections yet');
  });

  it('shows the empty state for a note without connections', async () => {
    await render(
      <Graph
        graph={{ activeId: 'a', nodes: [graphNode('a', 'Alpha', 0, 0, 0, true)], edges: [], backlinks: [] }}
        onSelect={() => {}}
        onNavigate={() => {}}
      />,
    );

    expect(container.querySelector('.graph__empty')?.textContent).toContain('No local connections yet');
  });

  it('keeps a long title readable by truncating it late', async () => {
    const name = 'A note title that is longer than the label';
    await render(
      <Graph
        graph={{ activeId: 'a', nodes: [graphNode('a', name, 0, 0, 0, true)], edges: [], backlinks: [] }}
        onSelect={() => {}}
        onNavigate={() => {}}
      />,
    );

    const label = container.querySelector('.graph__node-label')?.textContent ?? '';
    expect(label).toHaveLength(18);
    expect(label.endsWith('…')).toBe(true);
  });

  it('caps the picture at 48 nodes and keeps the backlinks', async () => {
    const neighbours = Array.from({ length: 100 }, (_, index) =>
      graphNode(`n${index}`, `Note ${index}`, 0, 0, 1),
    );
    const graph: LocalGraph = {
      activeId: 'a',
      nodes: [graphNode('a', 'Alpha', 0, 0, 3, true), ...neighbours],
      edges: [],
      backlinks: ['n0', 'n1', 'n2'],
    };

    await render(<Graph graph={graph} onSelect={() => {}} onNavigate={() => {}} />);

    expect(nodes().length).toBeLessThanOrEqual(48);
    const labels = nodes().map((node) => node.getAttribute('aria-label'));
    expect(labels).toContain('Note 0, 1 connection');
    expect(labels).toContain('Note 1, 1 connection');
    expect(labels).toContain('Note 2, 1 connection');
    expect(container.querySelector('.graph__note')?.textContent).toContain('101');
  });

  it('renders an unsafe note name as inert text', async () => {
    const graph: LocalGraph = {
      activeId: 'a',
      nodes: [
        graphNode('a', 'Alpha', 0, 0, 1, true),
        graphNode('b', '<script>alert(1)</script>', 0, -120, 1),
      ],
      edges: [{ source: 'a', target: 'b' }],
      backlinks: [],
    };

    await render(<Graph graph={graph} onSelect={() => {}} onNavigate={() => {}} />);

    expect(container.querySelector('script')).toBeNull();
    expect(nodes()[1]?.getAttribute('aria-label')).toContain('<script>alert(1)</script>');
  });

  it('draws the same picture for the same graph', async () => {
    const first = document.createElement('div');
    document.body.appendChild(first);
    const second = document.createElement('div');
    document.body.appendChild(second);

    await render(<Graph graph={fixture()} onSelect={() => {}} onNavigate={() => {}} />, first);
    await render(<Graph graph={fixture()} onSelect={() => {}} onNavigate={() => {}} />, second);

    const shape = (target: HTMLElement) =>
      Array.from(target.querySelectorAll<SVGCircleElement>('.graph__node-dot')).map((dot) => [
        dot.getAttribute('cx'),
        dot.getAttribute('cy'),
      ]);
    const labels = (target: HTMLElement) =>
      Array.from(target.querySelectorAll('.graph__node-label')).map((label) => label.textContent);

    expect(shape(first)).toEqual(shape(second));
    expect(labels(first)).toEqual(labels(second));

    first.remove();
    second.remove();
  });

  it('keeps the list role on the neighbour list', async () => {
    await render(<Graph graph={fixture()} onSelect={() => {}} onNavigate={() => {}} />);

    expect(container.querySelector('ul.graph__list')?.getAttribute('role')).toBe('list');
  });

  it('offers the neighbours as a touch sized list of buttons', async () => {
    const onSelect = vi.fn();
    const onNavigate = vi.fn();
    await render(<Graph graph={fixture()} onSelect={onSelect} onNavigate={onNavigate} />);

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.graph__list button'));
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toContain('Beta');

    await click(buttons[1] as Element);

    // The list button is destroyed by the re-render, so it navigates.
    expect(onNavigate).toHaveBeenCalledWith('c');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
