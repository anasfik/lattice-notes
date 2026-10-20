import { describe, expect, it } from 'vitest';

import { createEmptyVault, createNote, deleteNote } from './vault';
import type { Vault } from './types';
import { closeTab, sanitizeTabIds, stepTab } from './tabs';

/** A vault with three notes and the first one selected. */
function threeNotes(): { vault: Vault; ids: string[] } {
  const first = createNote(createEmptyVault(), 'Alpha', '# Alpha');
  const second = createNote(first.vault, 'Beta', '# Beta');
  const third = createNote(second.vault, 'Gamma', '# Gamma');
  return {
    vault: { ...third.vault, activeNoteId: first.note.id },
    ids: [first.note.id, second.note.id, third.note.id],
  };
}

describe('tab ids', () => {
  it('keeps the order of the session and drops the duplicates', () => {
    const { vault, ids } = threeNotes();

    expect(sanitizeTabIds([ids[2]!, ids[0]!, ids[2]!, ids[1]!], vault, vault.activeNoteId)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);
  });

  it('drops ids that are not in the vault', () => {
    const { vault, ids } = threeNotes();

    expect(sanitizeTabIds(['not-a-note', ids[0]!], vault, vault.activeNoteId)).toEqual([ids[0]]);
  });

  it('drops the tab of a trashed note', () => {
    const { vault, ids } = threeNotes();
    const trashed = deleteNote(vault, ids[1]!);

    expect(sanitizeTabIds(ids, trashed.vault, trashed.vault.activeNoteId)).toEqual([ids[0], ids[2]]);
  });

  it('puts the active note in front when the session does not hold it', () => {
    const { vault, ids } = threeNotes();

    expect(sanitizeTabIds([ids[1]!, ids[2]!], vault, vault.activeNoteId)).toEqual([
      ids[0],
      ids[1],
      ids[2],
    ]);
  });

  it('selects nothing when no note is active', () => {
    const { vault, ids } = threeNotes();

    expect(sanitizeTabIds([ids[1]!], { ...vault, activeNoteId: null }, null)).toEqual([ids[1]]);
  });
});

describe('closing a tab', () => {
  it('removes the tab and keeps the note', () => {
    const { vault, ids } = threeNotes();

    const result = closeTab([ids[0]!, ids[1]!], vault.activeNoteId, ids[0]!);

    expect(result.openNoteIds).toEqual([ids[1]]);
    expect(result.activeNoteId).toBe(ids[1]);
  });

  it('takes the right neighbour when the active tab closes', () => {
    const { vault, ids } = threeNotes();

    const result = closeTab(ids, vault.activeNoteId, ids[0]!);

    expect(result.openNoteIds).toEqual([ids[1], ids[2]]);
    expect(result.activeNoteId).toBe(ids[1]);
  });

  it('takes the left neighbour when the active tab is the last one', () => {
    const { vault, ids } = threeNotes();
    const last = { ...vault, activeNoteId: ids[2]! };

    const result = closeTab(ids, last.activeNoteId, ids[2]!);

    expect(result.openNoteIds).toEqual([ids[0], ids[1]]);
    expect(result.activeNoteId).toBe(ids[1]);
  });

  it('selects nothing when the last tab closes', () => {
    const { vault, ids } = threeNotes();

    const result = closeTab([ids[0]!], vault.activeNoteId, ids[0]!);

    expect(result.openNoteIds).toEqual([]);
    expect(result.activeNoteId).toBeNull();
  });

  it('keeps the selection when another tab closes', () => {
    const { vault, ids } = threeNotes();

    const result = closeTab(ids, vault.activeNoteId, ids[2]!);

    expect(result.openNoteIds).toEqual([ids[0], ids[1]]);
    expect(result.activeNoteId).toBe(vault.activeNoteId);
  });

  it('focuses the tab that takes the place of another one', () => {
    const { vault, ids } = threeNotes();

    // Closing the left neighbour of the active tab leaves the active note
    // selected; the keyboard belongs on the tab that slid into its place.
    expect(closeTab(ids, vault.activeNoteId, ids[0]!).focusTabId).toBe(ids[1]);
    expect(closeTab(ids, vault.activeNoteId, ids[1]!).focusTabId).toBe(ids[2]);
    expect(closeTab(ids, vault.activeNoteId, ids[2]!).focusTabId).toBe(ids[1]);
  });

  it('does nothing for a tab that is not open', () => {
    const { vault, ids } = threeNotes();

    const result = closeTab(ids, vault.activeNoteId, 'not-open');

    expect(result.openNoteIds).toEqual(ids);
    expect(result.activeNoteId).toBe(vault.activeNoteId);
    expect(result.focusTabId).toBe(vault.activeNoteId);
  });
});

describe('stepping through the tabs', () => {
  it('moves to the next and the previous tab', () => {
    const { vault, ids } = threeNotes();

    expect(stepTab(ids, vault.activeNoteId, 1)).toBe(ids[1]);
    expect(stepTab(ids, vault.activeNoteId, -1)).toBe(ids[2]);
  });

  it('selects nothing when there is no tab', () => {
    expect(stepTab([], null, 1)).toBeNull();
  });
});
