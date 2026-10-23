import { describe, expect, it } from 'vitest';

import { HISTORY_LIMIT, goBack, goForward, pushHistory } from './history';
import type { HistoryState } from './history';

const EMPTY: HistoryState = { past: [], future: [] };

describe('the navigation history', () => {
  it('pushing the same note twice does not duplicate the entry', () => {
    const once = pushHistory(EMPTY, 'note-1', 1);
    const twice = pushHistory(once, 'note-1', 2);

    expect(twice.past).toHaveLength(1);
    expect(twice.past[0]?.noteId).toBe('note-1');
  });

  it('going back moves the entry to the future', () => {
    const state = pushHistory(pushHistory(EMPTY, 'note-1', 1), 'note-2', 2);

    const result = goBack(state);

    expect(result.noteId).toBe('note-1');
    expect(result.state.past.map((entry) => entry.noteId)).toEqual(['note-1']);
    expect(result.state.future.map((entry) => entry.noteId)).toEqual(['note-2']);
  });

  it('going forward restores it', () => {
    const state = pushHistory(pushHistory(EMPTY, 'note-1', 1), 'note-2', 2);
    const back = goBack(state);

    const result = goForward(back.state);

    expect(result.noteId).toBe('note-2');
    expect(result.state.past.map((entry) => entry.noteId)).toEqual(['note-1', 'note-2']);
    expect(result.state.future).toEqual([]);
  });

  it('the stack is capped at 50 entries', () => {
    let state = EMPTY;
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) {
      state = pushHistory(state, `note-${index}`, index);
    }

    expect(HISTORY_LIMIT).toBe(50);
    expect(state.past).toHaveLength(HISTORY_LIMIT);
    expect(state.past[state.past.length - 1]?.noteId).toBe(`note-${HISTORY_LIMIT + 9}`);
  });

  it('opening a note from the switcher clears the future', () => {
    const state = pushHistory(pushHistory(EMPTY, 'note-1', 1), 'note-2', 2);
    const back = goBack(state);

    const next = pushHistory(back.state, 'note-3', 3);

    expect(next.future).toEqual([]);
    expect(next.past.map((entry) => entry.noteId)).toEqual(['note-1', 'note-3']);
  });

  it('says there is nowhere to go when the stack is empty', () => {
    expect(goBack(EMPTY)).toEqual({ state: EMPTY, noteId: null });
    expect(goForward(EMPTY)).toEqual({ state: EMPTY, noteId: null });
  });
});
