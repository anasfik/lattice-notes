/**
 * The daily notes of a vault: the civil date of a day and the note it names.
 *
 * Everything here is pure. A civil date is the date a person reads on a
 * calendar, so it is read from the local clock of the machine and never from
 * UTC: a day starts when the reader says it starts.
 */

import { activeNotes, createNote, normalizeNoteName } from './vault';
import type { Note, Vault } from './types';

/** The parts of a civil date. The month counts from one, like a calendar. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** A civil date in the shape of a date input: `YYYY-MM-DD`. */
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The civil date of an instant, from the local clock.
 *
 * The local fields are the ones a person reads on a calendar, so the day
 * never jumps because of the time zone of the machine.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Reads a civil date, or null when the text is not one.
 *
 * The shape is strict: four digits, a dash, two digits, a dash, two digits.
 * A month that is not there, a day the month does not have and a leap day of
 * a common year are all refused, so the result is always a real day.
 */
export function parseCivilDate(value: string): CivilDate | null {
  const match = CIVIL_DATE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > monthDays(year, month)) return null;

  return { year, month, day };
}

/**
 * The days of a month, the month counting from one.
 *
 * The last day of a month is the day before the first of the next one, which
 * the platform knows for every month, leap years included.
 */
export function monthDays(year: number, month: number): number {
  const date = new Date(year, month, 0);
  // The two digit years of the platform are in the twentieth century, so a
  // year before 100 is set again.
  if (year >= 0 && year < 100) date.setFullYear(year);
  return date.getDate();
}

/**
 * The note of a day.
 *
 * A day has one note: the note whose title is the date is opened again, so
 * the second daily note of a day is the first one. A trashed note of that
 * day is not restored, because a note in the trash is not on the screen; the
 * day gets a new note instead, under the name the trashed one released.
 */
export function openDailyNote(vault: Vault, dateKey: string): { vault: Vault; note: Note } {
  if (!parseCivilDate(dateKey)) {
    throw new Error(`not a civil date: ${dateKey}`);
  }

  const wanted = normalizeNoteName(dateKey).toLowerCase();
  const existing = activeNotes(vault).find(
    (note) => normalizeNoteName(note.name).toLowerCase() === wanted,
  );

  if (existing) {
    return { vault: { ...vault, activeNoteId: existing.id }, note: existing };
  }

  const { vault: next, note } = createNote(vault, dateKey, `# ${dateKey}\n\n`);
  return { vault: { ...next, activeNoteId: note.id }, note };
}

/** A number with at least two digits. */
function pad(value: number, size: number): string {
  return String(value).padStart(size, '0');
}
