/**
 * The open notes of a vault, as ids.
 *
 * A tab holds the id of a note and never its body, so the tab strip can
 * never keep a second copy of a note. The order of the list is the order of
 * the strip, and the selection stays in the vault document: this module only
 * says which ids are open and which one a close leaves selected.
 */

import type { Vault } from './types';

/**
 * The ids that may be shown as tabs.
 *
 * Ids that are not in the vault and ids of trashed notes are dropped, a
 * repeated id is kept once, and the order of the session is kept. The note
 * that is on the screen always has a tab: when the session does not hold it,
 * it is put in front.
 */
export function sanitizeTabIds(
  openNoteIds: readonly string[],
  vault: Vault,
  activeNoteId: string | null,
): string[] {
  const alive = new Set(
    vault.notes.filter((note) => note.deletedAt === null).map((note) => note.id),
  );

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of openNoteIds) {
    if (!alive.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  if (activeNoteId !== null && alive.has(activeNoteId) && !seen.has(activeNoteId)) {
    ids.unshift(activeNoteId);
  }
  return ids;
}

/**
 * Closes one tab.
 *
 * Closing a tab never deletes a note. The note that is on the screen moves to
 * the tab on its right, or to the one on its left when there is none on the
 * right. When the last tab closes, nothing is selected any more.
 */
export function closeTab(
  openNoteIds: readonly string[],
  activeNoteId: string | null,
  id: string,
): { openNoteIds: string[]; activeNoteId: string | null; focusTabId: string | null } {
  const index = openNoteIds.indexOf(id);
  if (index === -1) {
    return { openNoteIds: [...openNoteIds], activeNoteId, focusTabId: activeNoteId };
  }

  const remaining = openNoteIds.filter((candidate) => candidate !== id);
  // The keyboard goes to the tab that took the closed one's place: its right
  // neighbour, else its left one. Closing a tab that is not on the screen
  // leaves the selection alone but still moves the focus into the strip.
  const focusTabId = remaining[index] ?? remaining[index - 1] ?? activeNoteId;
  if (id !== activeNoteId) return { openNoteIds: remaining, activeNoteId, focusTabId };

  const next = remaining[index] ?? remaining[index - 1] ?? null;
  return { openNoteIds: remaining, activeNoteId: next, focusTabId: next };
}

/**
 * The tab next to the selected one.
 *
 * The order wraps around, so a keyboard can walk through the whole strip.
 * Resolves `null` when there is no tab to move to.
 */
export function stepTab(
  openNoteIds: readonly string[],
  activeNoteId: string | null,
  delta: number,
): string | null {
  if (openNoteIds.length === 0) return null;
  const index = openNoteIds.indexOf(activeNoteId ?? '');
  if (index === -1) return openNoteIds[0] ?? null;
  const next = (index + delta + openNoteIds.length) % openNoteIds.length;
  return openNoteIds[next] ?? null;
}
