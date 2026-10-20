import { describe, expect, it } from 'vitest';

import {
  activeNotes,
  buildLocalGraph,
  createEmptyVault,
  createNote,
  createNotes,
  deleteNote,
  normalizeNoteName,
  noteNameIndex,
  renameNote,
  restoreNote,
  searchNotes,
  uniqueNoteNameIn,
  updateNoteBody,
} from './vault';
import type { Note, Vault } from './types';

function vaultWith(...names: string[]): Vault {
  return names.reduce((vault, name) => createNote(vault, name).vault, createEmptyVault());
}

function noteNamed(vault: Vault, name: string) {
  const found = vault.notes.find((note) => note.name === name);
  if (!found) throw new Error(`missing note named ${name}`);
  return found;
}

describe('note names', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeNoteName('  Weekly   Review \n ')).toBe('Weekly Review');
  });

  it('falls back to a usable default for blank names', () => {
    const { note } = createNote(createEmptyVault(), '   ');
    expect(note.name).toBe('Untitled');
  });

  it('keeps names unique regardless of case', () => {
    const first = createNote(createEmptyVault(), 'Roadmap');
    const second = createNote(first.vault, 'roadmap');

    expect(second.note.name).toBe('roadmap 2');
    const names = activeNotes(second.vault).map((note) => note.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('reuses the name of a deleted note and suffixes it on restore', () => {
    const created = createNote(createEmptyVault(), 'Roadmap');
    const deleted = deleteNote(created.vault, created.note.id);
    const next = createNote(deleted.vault, 'Roadmap');

    expect(next.note.name).toBe('Roadmap');

    const restored = restoreNote(next.vault, created.note.id);

    expect(restored.note?.name).toBe('Roadmap 2');
    const names = activeNotes(restored.vault).map((note) => note.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(['roadmap', 'roadmap 2']);
  });
});

describe('createNote', () => {
  it('stores the body and timestamps the note', () => {
    const { note } = createNote(createEmptyVault(), 'Inbox', '# hello');

    expect(note.body).toBe('# hello');
    expect(note.deletedAt).toBeNull();
    expect(note.createdAt).toBe(note.updatedAt);
    expect(note.id).toBeTruthy();
  });

  it('gives every note a distinct id', () => {
    const vault = vaultWith('One', 'Two');
    const ids = vault.notes.map((note) => note.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('createNotes', () => {
  /**
   * The naming rule as it was before the batch path existed: the set of taken
   * names is rebuilt from scratch for every single note.
   */
  function oldNoteName(notes: Note[], desired: string): string {
    const base = desired.replace(/\s+/g, ' ').trim() || 'Untitled';
    const taken = new Set(
      notes.filter((entry) => entry.deletedAt === null).map((entry) => entry.name.toLowerCase()),
    );
    if (!taken.has(base.toLowerCase())) return base;
    let suffix = 2;
    while (taken.has(`${base} ${suffix}`.toLowerCase())) suffix += 1;
    return `${base} ${suffix}`;
  }

  const base: Vault = {
    notes: [
      { id: 'id-alpha', name: 'Alpha', body: '', createdAt: 1, updatedAt: 1, deletedAt: null },
      { id: 'id-keeper', name: 'Keeper', body: '', createdAt: 1, updatedAt: 1, deletedAt: null },
      { id: 'id-trashed', name: 'Trashed', body: '', createdAt: 1, updatedAt: 1, deletedAt: 1 },
    ],
    activeNoteId: 'id-alpha',
  };

  const drafts = [
    { name: 'alpha', body: 'a' },
    { name: 'Alpha', body: 'b' },
    { name: 'Alpha 2', body: 'c' },
    { name: '   ', body: 'd' },
    { name: 'Trashed', body: 'e' },
    { name: 'Gamma', body: 'f' },
    { name: 'Keeper', body: 'g' },
  ];

  it('names a batch exactly like the per note path did', () => {
    const expected: string[] = [];
    const grown = [...base.notes];
    for (const draft of drafts) {
      const name = oldNoteName(grown, draft.name);
      expected.push(name);
      grown.push({ id: `new-${expected.length}`, name, body: draft.body, createdAt: 1, updatedAt: 1, deletedAt: null });
    }

    const { notes } = createNotes(base, drafts);

    expect(notes.map((note) => note.name)).toEqual(expected);
    expect(notes.map((note) => note.name)).toEqual([
      'alpha 2',
      'Alpha 3',
      'Alpha 2 2',
      'Untitled',
      'Trashed',
      'Gamma',
      'Keeper 2',
    ]);
  });

  it('keeps the existing notes and adds the batch in one copy', () => {
    const { vault, notes } = createNotes(base, drafts);

    expect(vault.notes).toHaveLength(base.notes.length + drafts.length);
    expect(vault.notes.slice(0, base.notes.length)).toEqual(base.notes);
    expect(vault.notes.slice(base.notes.length)).toEqual(notes);
  });

  it('gives every note a fresh id and no delete stamp', () => {
    const { notes } = createNotes(base, drafts);

    const ids = notes.map((note) => note.id);
    expect(new Set(ids).size).toBe(notes.length);
    expect(ids).not.toContain('id-alpha');
    expect(notes.every((note) => note.deletedAt === null)).toBe(true);
    expect(notes.map((note) => note.body)).toEqual(drafts.map((draft) => draft.body));
  });

  it('keeps the given timestamps and falls back to now for the rest', () => {
    const { notes } = createNotes(base, [
      { name: 'Stamped', body: '', createdAt: 10, updatedAt: 20 },
      { name: 'Unstamped', body: '' },
    ]);

    expect(notes[0]?.createdAt).toBe(10);
    expect(notes[0]?.updatedAt).toBe(20);
    expect(notes[1]?.createdAt).toBeGreaterThan(0);
    expect(notes[1]?.updatedAt).toBe(notes[1]?.createdAt);
  });
});

describe('noteNameIndex and uniqueNoteNameIn', () => {
  it('collects the lowercased names of the active notes only', () => {
    const vault = vaultWith('Alpha');
    const deleted = deleteNote(vault, vault.notes[0]?.id ?? '');

    expect([...noteNameIndex(deleted.vault)]).toEqual([]);
    expect([...noteNameIndex(vault)]).toEqual(['alpha']);
  });

  it('leaves one note out when its id is excluded', () => {
    const vault = vaultWith('Alpha', 'Beta');

    expect([...noteNameIndex(vault, vault.notes[0]?.id)]).toEqual(['beta']);
  });

  it('adds the name it hands out to the taken set', () => {
    const taken = new Set<string>();

    expect(uniqueNoteNameIn(taken, 'Alpha')).toBe('Alpha');
    expect(uniqueNoteNameIn(taken, 'Alpha')).toBe('Alpha 2');
    expect(uniqueNoteNameIn(taken, 'alpha')).toBe('alpha 3');
    expect([...taken]).toEqual(['alpha', 'alpha 2', 'alpha 3']);
  });

  it('falls back to the default name for a blank name', () => {
    expect(uniqueNoteNameIn(new Set<string>(), '   ')).toBe('Untitled');
  });
});

describe('renameNote', () => {
  it('normalizes the new name', () => {
    const vault = vaultWith('Old');
    const renamed = renameNote(vault, vault.notes[0]?.id ?? '', '  New   Name ');

    expect(renamed.note?.name).toBe('New Name');
    expect(activeNotes(renamed.vault)[0]?.name).toBe('New Name');
  });

  it('does not collide with another note', () => {
    const vault = vaultWith('Keep', 'Taken');
    const renamed = renameNote(vault, noteNamed(vault, 'Keep').id, 'taken');

    expect(renamed.note?.name).toBe('taken 2');
  });

  it('keeps its own name available to itself', () => {
    const vault = vaultWith('Alpha');
    const renamed = renameNote(vault, noteNamed(vault, 'Alpha').id, 'Alpha');

    expect(renamed.note?.name).toBe('Alpha');
  });

  it('ignores blank names instead of creating an ambiguous record', () => {
    const vault = vaultWith('Alpha');
    const renamed = renameNote(vault, noteNamed(vault, 'Alpha').id, '   ');

    expect(renamed.note?.name).toBe('Alpha');
    expect(activeNotes(renamed.vault)).toHaveLength(1);
  });

  it('reports an unknown id without touching the vault', () => {
    const vault = vaultWith('Alpha');
    const renamed = renameNote(vault, 'missing', 'Beta');

    expect(renamed.note).toBeNull();
    expect(renamed.vault).toBe(vault);
  });
});

describe('deleteNote and restoreNote', () => {
  it('soft deletes a note and hides it from the active list', () => {
    const created = createNote(createEmptyVault(), 'Alpha', 'keep this body');
    const deleted = deleteNote(created.vault, created.note.id);

    expect(deleted.note?.deletedAt).toBeTypeOf('number');
    expect(activeNotes(deleted.vault)).toHaveLength(0);
    expect(deleted.vault.notes).toHaveLength(1);
    expect(deleted.vault.notes[0]?.body).toBe('keep this body');
  });

  it('moves the selection when the active note is deleted', () => {
    const created = createNote(vaultWith('Alpha'), 'Beta');
    const withSelection = { ...created.vault, activeNoteId: created.note.id };
    const deleted = deleteNote(withSelection, created.note.id);

    expect(deleted.vault.activeNoteId).toBe(noteNamed(withSelection, 'Alpha').id);
  });

  it('restores a deleted note with its body intact', () => {
    const created = createNote(createEmptyVault(), 'Alpha', 'body text');
    const deleted = deleteNote(created.vault, created.note.id);
    const restored = restoreNote(deleted.vault, created.note.id);

    expect(restored.note?.deletedAt).toBeNull();
    expect(restored.note?.body).toBe('body text');
    expect(activeNotes(restored.vault)).toHaveLength(1);
  });

  it('is a no-op for unknown, already deleted, and already active notes', () => {
    const created = createNote(createEmptyVault(), 'Alpha');
    const deleted = deleteNote(created.vault, created.note.id);

    expect(deleteNote(created.vault, 'missing').note).toBeNull();
    expect(deleteNote(deleted.vault, created.note.id).note).toBeNull();
    expect(restoreNote(created.vault, created.note.id).note).toBeNull();
  });
});

describe('updateNoteBody', () => {
  it('replaces the body and bumps the update time', () => {
    const created = createNote(createEmptyVault(), 'Alpha', 'old');
    const updated = updateNoteBody(created.vault, created.note.id, 'new');

    expect(updated.note?.body).toBe('new');
    expect(updated.note?.updatedAt).toBeGreaterThanOrEqual(created.note.updatedAt);
  });

  it('reports an unknown id without touching the vault', () => {
    const vault = vaultWith('Alpha');
    const updated = updateNoteBody(vault, 'missing', 'new');

    expect(updated.note).toBeNull();
    expect(updated.vault).toBe(vault);
  });
});

describe('searchNotes', () => {
  const vault = (() => {
    const created = createNote(createEmptyVault(), 'Roadmap', 'Ship the #launch milestone');
    const second = createNote(created.vault, 'Inbox', 'buy milk');
    return second.vault;
  })();

  it('finds notes by title regardless of case', () => {
    const results = searchNotes(vault, 'ROADMAP');

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('Roadmap');
    expect(results[0]?.matchIn).toBe('title');
  });

  it('finds notes by body text and returns a snippet', () => {
    const results = searchNotes(vault, 'launch');

    expect(results).toHaveLength(1);
    expect(results[0]?.matchIn).toBe('body');
    expect(results[0]?.snippet).toContain('launch');
  });

  it('never matches deleted notes', () => {
    const deleted = deleteNote(vault, noteNamed(vault, 'Roadmap').id);

    expect(searchNotes(deleted.vault, 'Roadmap')).toHaveLength(0);
  });

  it('returns nothing for a blank query or a missing term', () => {
    expect(searchNotes(vault, '   ')).toHaveLength(0);
    expect(searchNotes(vault, 'nothing-matches-this')).toHaveLength(0);
  });
});

describe('buildLocalGraph', () => {
  function graphVault(): Vault {
    const alpha = createNote(createEmptyVault(), 'Alpha', 'links to [[Beta]] and [[Ghost]]');
    const beta = createNote(alpha.vault, 'Beta', 'plain body');
    const gamma = createNote(beta.vault, 'Gamma', 'points back to [[Alpha]]');
    return gamma.vault;
  }

  it('covers the active note, its links, and its backlinks', () => {
    const vault = graphVault();
    const graph = buildLocalGraph(vault, noteNamed(vault, 'Alpha').id);

    expect(graph.nodes.map((node) => node.name).sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(graph.activeId).toBe(noteNamed(vault, 'Alpha').id);
  });

  it('derives edges and backlinks from wiki links', () => {
    const vault = graphVault();
    const alphaId = noteNamed(vault, 'Alpha').id;
    const gammaId = noteNamed(vault, 'Gamma').id;
    const graph = buildLocalGraph(vault, alphaId);

    expect(graph.edges).toContainEqual({ source: alphaId, target: noteNamed(vault, 'Beta').id });
    expect(graph.edges).toContainEqual({ source: gammaId, target: alphaId });
    expect(graph.backlinks).toEqual([gammaId]);
  });

  it('ignores links that point at a missing note', () => {
    const vault = graphVault();
    const graph = buildLocalGraph(vault, noteNamed(vault, 'Alpha').id);

    expect(graph.nodes.map((node) => node.name)).not.toContain('Ghost');
  });

  it('places the active note at the center and keeps layout deterministic', () => {
    const vault = graphVault();
    const alphaId = noteNamed(vault, 'Alpha').id;
    const graph = buildLocalGraph(vault, alphaId);
    const active = graph.nodes.find((node) => node.id === alphaId);

    expect(active?.x).toBe(0);
    expect(active?.y).toBe(0);
    expect(active?.active).toBe(true);
    expect(buildLocalGraph(vault, alphaId)).toEqual(graph);
  });

  it('returns an empty graph for an unknown active note', () => {
    const graph = buildLocalGraph(graphVault(), 'missing');

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.backlinks).toEqual([]);
  });

  it('resolves a link to the active note that holds the name', () => {
    const linking = createNote(createEmptyVault(), 'Links', 'see [[Roadmap]]');
    const roadmap = createNote(linking.vault, 'Roadmap');
    const deleted = deleteNote(roadmap.vault, roadmap.note.id);
    const recreated = createNote(deleted.vault, 'Roadmap');

    expect(recreated.note.name).toBe('Roadmap');

    const graph = buildLocalGraph(recreated.vault, recreated.note.id);

    expect(graph.backlinks).toEqual([linking.note.id]);
    expect(graph.edges).toContainEqual({ source: linking.note.id, target: recreated.note.id });
  });
});
