import { describe, expect, it } from 'vitest';

import {
  DRAW_LIMIT,
  PAGE_SIZE,
  buildGraphModel,
  clampCamera,
  fitCamera,
  layoutNodes,
  pageNotes,
  project,
  projectFlat,
  resetCamera,
  selectDrawable,
} from './graphView';
import type { Camera, ViewNode } from './graphView';
import { createEmptyVault, createNote, deleteNote } from './vault';
import type { Vault } from './types';

/** A vault with the given notes, and the id every note got. */
function vaultOf(notes: { name: string; body?: string }[]): {
  vault: Vault;
  ids: Record<string, string>;
} {
  let vault = createEmptyVault();
  const ids: Record<string, string> = {};
  for (const note of notes) {
    const created = createNote(vault, note.name, note.body ?? '');
    vault = created.vault;
    ids[note.name] = created.note.id;
  }
  return { vault, ids };
}

/** A vault with `count` notes that link to each other in a ring. */
function ringVault(count: number): Vault {
  const notes = Array.from({ length: count }, (_, index) => ({
    name: `note-${String(index).padStart(4, '0')}`,
    body: `Next is [[note-${String((index + 1) % count).padStart(4, '0')}]].`,
  }));
  return vaultOf(notes).vault;
}

/** A camera that is out of every range, to test the clamps. */
function wildCamera(): Camera {
  return {
    yaw: Number.NaN,
    pitch: Number.POSITIVE_INFINITY,
    zoom: 1e9,
    targetX: -1e12,
    targetY: Number.NaN,
  };
}

/** The note at a place of the list. */
function at(nodes: ViewNode[], index: number): ViewNode {
  const node = nodes[index];
  if (!node) throw new Error(`no note at the place ${index}`);
  return node;
}

/** The id of a note of the vault. */
function idOf(ids: Record<string, string>, name: string): string {
  const id = ids[name];
  if (!id) throw new Error(`no note named "${name}"`);
  return id;
}

describe('graph model', () => {
  it('resolves the links the way the contextual graph does', () => {
    const { vault, ids } = vaultOf([
      { name: 'Alpha', body: 'See [[Beta]] and [[Beta]] once more.' },
      { name: 'Beta', body: 'Back to [[Alpha]].' },
      { name: 'Gamma', body: 'Points at [[Missing]].' },
    ]);

    const model = buildGraphModel(vault);

    expect(model.nodes.map((node) => node.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(model.edges).toEqual([
      { source: idOf(ids, 'Alpha'), target: idOf(ids, 'Beta') },
      { source: idOf(ids, 'Beta'), target: idOf(ids, 'Alpha') },
    ]);
  });

  it('leaves trashed notes and unresolved targets out', () => {
    const { vault, ids } = vaultOf([
      { name: 'Alpha', body: 'See [[Beta]].' },
      { name: 'Beta', body: 'Nothing here.' },
      { name: 'Gone', body: 'See [[Alpha]].' },
    ]);
    const trashed = deleteNote(vault, idOf(ids, 'Gone'));

    const model = buildGraphModel(trashed.vault);

    expect(model.nodes.map((node) => node.name)).toEqual(['Alpha', 'Beta']);
    expect(model.edges).toEqual([
      { source: idOf(ids, 'Alpha'), target: idOf(ids, 'Beta') },
    ]);
  });

  it('orders the notes by name and gives the same picture every time', () => {
    const { vault } = vaultOf([
      { name: 'Charlie', body: '' },
      { name: 'Alpha', body: '' },
      { name: 'Bravo', body: '' },
    ]);

    const first = buildGraphModel(vault);
    const second = buildGraphModel(vault);

    expect(first.nodes.map((node) => node.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(second).toEqual(first);
  });

  it('survives a vault without notes', () => {
    expect(buildGraphModel(createEmptyVault())).toEqual({ nodes: [], edges: [] });
  });
});

describe('geometry', () => {
  it('places the notes the same way every time', () => {
    const { vault } = vaultOf([
      { name: 'Alpha', body: '' },
      { name: 'Bravo', body: '' },
      { name: 'Charlie', body: '' },
    ]);
    const nodes = buildGraphModel(vault).nodes;

    expect(layoutNodes(nodes)).toEqual(layoutNodes(nodes));
    expect(layoutNodes(nodes)).toHaveLength(3);
  });

  it('keeps the projection finite for an empty, a single and a dense set', () => {
    const viewport = { width: 1000, height: 700 };
    const camera = resetCamera();

    expect(project({ x: 0, y: 0, z: 0 }, camera, viewport)).toBeTruthy();
    expect(layoutNodes([])).toEqual([]);

    const dense = layoutNodes(buildGraphModel(ringVault(400)).nodes);
    for (const point of dense) {
      const projected = project(point, camera, viewport);
      expect(Number.isFinite(projected.x)).toBe(true);
      expect(Number.isFinite(projected.y)).toBe(true);
      expect(Number.isFinite(projected.depth)).toBe(true);
      expect(Number.isFinite(projected.scale)).toBe(true);
    }
  });

  it('clamps the camera to its ranges', () => {
    const clamped = clampCamera({
      yaw: 900,
      pitch: 900,
      zoom: 99,
      targetX: 1e12,
      targetY: -1e12,
    });

    expect(clamped.yaw).toBeLessThanOrEqual(180);
    expect(clamped.pitch).toBeLessThanOrEqual(75);
    expect(clamped.pitch).toBeGreaterThanOrEqual(-75);
    expect(clamped.zoom).toBeLessThanOrEqual(3);
    expect(clamped.zoom).toBeGreaterThanOrEqual(0.35);
    expect(Number.isFinite(clamped.targetX)).toBe(true);
    expect(Number.isFinite(clamped.targetY)).toBe(true);
  });

  it('keeps the projection finite at the clamps and with a broken camera', () => {
    const viewport = { width: 1000, height: 700 };
    const point = { x: 120, y: -80, z: 24 };
    const cameras = [
      wildCamera(),
      { yaw: 0, pitch: 90, zoom: 3, targetX: 0, targetY: 0 },
      { yaw: 0, pitch: -90, zoom: 0.35, targetX: 0, targetY: 0 },
      { yaw: 180, pitch: 75, zoom: 1, targetX: 0, targetY: 0 },
    ];

    for (const camera of cameras) {
      for (const projected of [project(point, camera, viewport), projectFlat(point, camera, viewport)]) {
        expect(Number.isFinite(projected.x)).toBe(true);
        expect(Number.isFinite(projected.y)).toBe(true);
        expect(Number.isFinite(projected.depth)).toBe(true);
      }
    }
  });

  it('frames every note with the fitted camera and resets to a known one', () => {
    const nodes = buildGraphModel(ringVault(60)).nodes;
    const viewport = { width: 1000, height: 700 };

    const fitted = fitCamera(nodes, viewport);
    expect(Number.isFinite(fitted.zoom)).toBe(true);
    expect(fitted.zoom).toBeGreaterThan(0);
    expect(fitted.zoom).toBeLessThanOrEqual(3);

    const reset = resetCamera();
    expect(Number.isFinite(reset.zoom)).toBe(true);
    expect(Number.isFinite(reset.yaw)).toBe(true);
    expect(Number.isFinite(reset.pitch)).toBe(true);
    expect(reset.targetX).toBe(0);
    expect(reset.targetY).toBe(0);
  });

  it('fits an empty vault without breaking', () => {
    const fitted = fitCamera([], { width: 1000, height: 700 });
    expect(Number.isFinite(fitted.zoom)).toBe(true);
  });

  it('keeps dense layouts inside the fitted viewport in both dimensions', () => {
    const viewport = { width: 1000, height: 700 };
    const nodes = Array.from({ length: 1200 }, (_, index) => ({ id: `${index}`, name: `${index}` }));
    const camera = fitCamera(nodes, viewport);
    for (const point of layoutNodes(nodes)) {
      for (const screen of [project(point, camera, viewport), projectFlat(point, camera, viewport)]) {
        expect(screen.x).toBeGreaterThanOrEqual(12);
        expect(screen.x).toBeLessThanOrEqual(viewport.width - 12);
        expect(screen.y).toBeGreaterThanOrEqual(12);
        expect(screen.y).toBeLessThanOrEqual(viewport.height - 12);
      }
    }
  });
});

describe('drawing budget', () => {
  const nodesOf = (count: number): ViewNode[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `id-${index}`,
      name: `note-${String(index).padStart(4, '0')}`,
    }));

  it('draws everything that fits and says what was left out', () => {
    for (const count of [0, 1, 299, 300, 301, 1200]) {
      const nodes = nodesOf(count);
      const edges = nodes.slice(1).map((node, index) => ({
        source: at(nodes, index).id,
        target: node.id,
      }));

      const result = selectDrawable(nodes, edges, null);

      expect(result.total).toBe(count);
      expect(result.drawn).toBe(Math.min(count, DRAW_LIMIT));
      expect(result.omitted).toBe(count - result.drawn);
      expect(result.drawn + result.omitted).toBe(result.total);
      expect(result.nodes).toHaveLength(result.drawn);
    }
  });

  it('always draws the selected note', () => {
    const nodes = nodesOf(1200);
    const selected = at(nodes, 1199).id;

    const result = selectDrawable(nodes, [], selected);

    expect(result.drawn).toBe(DRAW_LIMIT);
    expect(result.nodes.map((node) => node.id)).toContain(selected);
  });

  it('keeps the edges of the drawn notes and leaves the others out', () => {
    const nodes = nodesOf(4);
    const edges = [
      { source: at(nodes, 0).id, target: at(nodes, 1).id },
      { source: at(nodes, 2).id, target: at(nodes, 3).id },
      // An edge of a note that is not in the list belongs to no picture.
      { source: 'gone', target: at(nodes, 2).id },
    ];

    const result = selectDrawable(nodes, edges, at(nodes, 0).id);

    expect(result.edges).toEqual([
      { source: at(nodes, 0).id, target: at(nodes, 1).id },
      { source: at(nodes, 2).id, target: at(nodes, 3).id },
    ]);
  });

  it('gives the same picture every time', () => {
    const nodes = nodesOf(400);
    const result = selectDrawable(nodes, [], null);

    expect(selectDrawable(nodes, [], null)).toEqual(result);
  });
});

describe('note list', () => {
  const nodes: ViewNode[] = Array.from({ length: 120 }, (_, index) => ({
    id: `id-${index}`,
    name: `note-${String(index).padStart(3, '0')}`,
  }));

  it('pages the notes fifty at a time', () => {
    const first = pageNotes(nodes, '', 1);

    expect(first.total).toBe(120);
    expect(first.pages).toBe(3);
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.page).toBe(1);

    const last = pageNotes(nodes, '', 3);
    expect(last.items).toHaveLength(20);
    expect(last.page).toBe(3);
  });

  it('searches the name of the note', () => {
    const result = pageNotes(nodes, 'note-01', 1);

    expect(result.total).toBe(10);
    expect(result.items.every((node) => node.name.includes('note-01'))).toBe(true);
  });

  it('keeps the page inside the range', () => {
    expect(pageNotes(nodes, '', 0).page).toBe(1);
    expect(pageNotes(nodes, '', -4).page).toBe(1);
    expect(pageNotes(nodes, '', 99).page).toBe(3);
    expect(pageNotes(nodes, '', Number.NaN).page).toBe(1);
  });

  it('survives a list without notes', () => {
    const result = pageNotes([], '', 1);

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.pages).toBe(1);
    expect(result.page).toBe(1);
  });
});
