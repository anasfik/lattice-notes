import { describe, expect, it } from 'vitest';

import { formatLocalDate, monthDays, openDailyNote, parseCivilDate } from './dailyNotes';
import { createEmptyVault, createNote, deleteNote } from './vault';

/** Runs a check with a fixed time zone and puts the old one back. */
function inTimeZone(zone: string, check: () => void): void {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    check();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe('the local civil date', () => {
  it('formats the local fields, not the UTC ones', () => {
    inTimeZone('America/Los_Angeles', () => {
      // 20 October 2026, 20:00 in Los Angeles is already the 21st in UTC.
      const date = new Date(2026, 9, 20, 20, 0);
      expect(date.toISOString().slice(0, 10)).toBe('2026-10-21');
      expect(formatLocalDate(date)).toBe('2026-10-20');
    });
  });

  it('formats the same day the same way east of UTC', () => {
    inTimeZone('Asia/Tokyo', () => {
      // 20 October 2026, 00:05 in Tokyo is still the 19th in UTC.
      const date = new Date(2026, 9, 20, 0, 5);
      expect(date.toISOString().slice(0, 10)).toBe('2026-10-19');
      expect(formatLocalDate(date)).toBe('2026-10-20');
    });
  });

  it('keeps the day of the local midnight and the end of the day', () => {
    expect(formatLocalDate(new Date(2026, 9, 20, 0, 0))).toBe('2026-10-20');
    expect(formatLocalDate(new Date(2026, 9, 20, 23, 59, 59))).toBe('2026-10-20');
  });

  it('keeps the day over a leap day and over the year border', () => {
    expect(formatLocalDate(new Date(2024, 1, 29, 12, 0))).toBe('2024-02-29');
    expect(formatLocalDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
    expect(formatLocalDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});

describe('the strict civil date', () => {
  it('reads a padded civil date', () => {
    expect(parseCivilDate('2026-10-20')).toEqual({ year: 2026, month: 10, day: 20 });
    expect(parseCivilDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('rejects a day that the month does not have', () => {
    expect(parseCivilDate('2026-02-30')).toBeNull();
    expect(parseCivilDate('2025-02-29')).toBeNull();
    expect(parseCivilDate('2026-04-31')).toBeNull();
  });

  it('rejects a month that is not there', () => {
    expect(parseCivilDate('2026-13-01')).toBeNull();
    expect(parseCivilDate('2026-00-10')).toBeNull();
  });

  it('rejects a day that is not there', () => {
    expect(parseCivilDate('2026-10-00')).toBeNull();
    expect(parseCivilDate('2026-10-32')).toBeNull();
  });

  it('rejects a date that is not padded or that carries extra text', () => {
    expect(parseCivilDate('2026-1-1')).toBeNull();
    expect(parseCivilDate('2026-10-20T00:00')).toBeNull();
    expect(parseCivilDate(' 2026-10-20')).toBeNull();
    expect(parseCivilDate('2026-10-20 ')).toBeNull();
    expect(parseCivilDate('')).toBeNull();
  });
});

describe('the days of a month', () => {
  it('counts the days of a month', () => {
    expect(monthDays(2024, 2)).toBe(29);
    expect(monthDays(2025, 2)).toBe(28);
    expect(monthDays(2026, 1)).toBe(31);
    expect(monthDays(2026, 4)).toBe(30);
    expect(monthDays(2026, 12)).toBe(31);
  });
});

describe('the daily note of a day', () => {
  it('refuses a key that is not a civil date', () => {
    expect(() => openDailyNote(createEmptyVault(), '2026-02-30')).toThrow();
    expect(() => openDailyNote(createEmptyVault(), 'not a date')).toThrow();
  });

  it('creates the note of the day once', () => {
    const first = openDailyNote(createEmptyVault(), '2026-10-20');

    expect(first.note.name).toBe('2026-10-20');
    expect(first.note.body).toBe('# 2026-10-20\n\n');
    expect(first.vault.activeNoteId).toBe(first.note.id);

    const second = openDailyNote(first.vault, '2026-10-20');

    expect(second.vault.notes).toHaveLength(1);
    expect(second.note.id).toBe(first.note.id);
    expect(second.note.body).toBe('# 2026-10-20\n\n');
    expect(second.vault.activeNoteId).toBe(first.note.id);
  });

  it('opens the note that is already there', () => {
    const { vault } = createNote(createEmptyVault(), '2026-10-20', 'written already');

    const opened = openDailyNote(vault, '2026-10-20');

    expect(opened.vault.notes).toHaveLength(1);
    expect(opened.note.body).toBe('written already');
    expect(opened.vault.activeNoteId).toBe(opened.note.id);
  });

  it('opens a note whose title only looks like the date', () => {
    const created = createNote(createEmptyVault(), '  2026-10-20  ');

    const opened = openDailyNote(created.vault, '2026-10-20');

    expect(opened.vault.notes).toHaveLength(1);
    expect(opened.note.id).toBe(created.note.id);
  });

  it('does not open a note whose name only starts with the date', () => {
    const created = createNote(createEmptyVault(), '2026-10-20 notes');

    const opened = openDailyNote(created.vault, '2026-10-20');

    expect(opened.vault.notes).toHaveLength(2);
    expect(opened.note.name).toBe('2026-10-20');
    expect(opened.note.id).not.toBe(created.note.id);
  });

  it('does not restore a trashed daily note but writes a new one', () => {
    const { vault: withNote, note } = createNote(createEmptyVault(), '2026-10-20', 'old text');
    const { vault: trashed } = deleteNote(withNote, note.id);

    const opened = openDailyNote(trashed, '2026-10-20');

    expect(opened.note.id).not.toBe(note.id);
    expect(opened.note.deletedAt).toBeNull();
    expect(opened.note.name).toBe('2026-10-20');
    expect(opened.note.body).toBe('# 2026-10-20\n\n');
    // The trashed note stays in the vault, so it can still be restored.
    expect(opened.vault.notes.filter((entry) => entry.deletedAt !== null)).toHaveLength(1);
  });
});
