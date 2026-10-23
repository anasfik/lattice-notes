/**
 * The navigation history of the session.
 *
 * The history is the trail of the notes the reader walked through. It lives in
 * memory only: it is gone when the tab is reloaded, and the session document
 * of the vault is not changed by it.
 *
 * The trail runs from the oldest entry to the note that is on the screen, so
 * the last entry of `past` is the note the reader is in. Going back moves that
 * entry to the front of `future` and opens the one before it; going forward
 * takes the first entry of `future` back onto the trail.
 *
 * Only the ids of the notes are kept, so a trail never holds a second copy of
 * a note.
 */

export interface HistoryEntry {
  /** The note the entry points at. */
  noteId: string;
  /** The moment the note was opened. */
  at: number;
}

export interface HistoryState {
  /** The trail of the notes, the note on the screen last. */
  past: HistoryEntry[];
  /** The notes that were left behind, the next one first. */
  future: HistoryEntry[];
}

/** How many entries the trail keeps. */
export const HISTORY_LIMIT = 50;

/**
 * Puts a note on the trail.
 *
 * The same note twice in a row is one entry: the reader did not go anywhere.
 * A note that was opened after a step back clears the future, because the
 * trail no longer leads there.
 *
 * The oldest entries go first when the trail grows past its limit.
 */
export function pushHistory(state: HistoryState, noteId: string, at: number): HistoryState {
  const last = state.past[state.past.length - 1];
  if (last && last.noteId === noteId) return state;

  const past = [...state.past, { noteId, at }];
  const kept = past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past;
  return { past: kept, future: [] };
}

/**
 * Goes one note back.
 *
 * The note on the screen moves to the front of the future and the one before
 * it is opened. A trail of one entry has nowhere to go, so the state stays as
 * it is and no note is named.
 */
export function goBack(state: HistoryState): { state: HistoryState; noteId: string | null } {
  if (state.past.length <= 1) return { state, noteId: null };

  const current = state.past[state.past.length - 1]!;
  const past = state.past.slice(0, -1);
  return {
    state: { past, future: [current, ...state.future] },
    noteId: past[past.length - 1]!.noteId,
  };
}

/**
 * Goes one note forward.
 *
 * The first note of the future goes back onto the trail and is opened. An
 * empty future has nowhere to go, so the state stays as it is and no note is
 * named.
 */
export function goForward(state: HistoryState): { state: HistoryState; noteId: string | null } {
  const next = state.future[0];
  if (!next) return { state, noteId: null };

  return {
    state: { past: [...state.past, next], future: state.future.slice(1) },
    noteId: next.noteId,
  };
}
