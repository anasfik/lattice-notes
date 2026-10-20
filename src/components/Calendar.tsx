import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { formatLocalDate, monthDays, parseCivilDate } from '../domain/dailyNotes';
import { normalizeNoteName } from '../domain/vault';
import type { Note } from '../domain/types';

export interface CalendarProps {
  /** True when the calendar is on the screen. */
  open: boolean;
  /** The active notes of the open vault, to mark the days that have one. */
  notes: Note[];
  /** Closes the calendar. */
  onClose(): void;
  /** Opens the note of a day. */
  onOpenDate(dateKey: string): void;
  /** Puts the keyboard on the note, after the calendar closed. */
  onFocusContent?(): void;
}

/** The parts of a civil date. */
interface CivilDate {
  year: number;
  month: number;
  day: number;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The week starts on Monday, so the columns follow the ISO order. */
const WEEKDAYS = [
  { full: 'Monday', short: 'Mo' },
  { full: 'Tuesday', short: 'Tu' },
  { full: 'Wednesday', short: 'We' },
  { full: 'Thursday', short: 'Th' },
  { full: 'Friday', short: 'Fr' },
  { full: 'Saturday', short: 'Sa' },
  { full: 'Sunday', short: 'Su' },
];

/**
 * The calendar of the daily notes.
 *
 * The panel is a native dialog, so it lives in the top layer of the page and
 * can never make the page wider than the screen. The grid scrolls inside
 * itself, so the days keep their 44 pixel targets on a narrow screen. The
 * keyboard walks the grid the way a calendar does: the arrows move by a day
 * and by a week, Home and End go to the ends of the week, and PageUp and
 * PageDown change the month.
 */
export default function Calendar({
  open,
  notes,
  onClose,
  onOpenDate,
  onFocusContent,
}: CalendarProps) {
  const baseId = useId();
  const jumpId = `${baseId}-jump`;
  const titleId = `${baseId}-title`;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  /** The element that had the keyboard before the calendar opened. */
  const opener = useRef<HTMLElement | null>(null);
  /** True while the keyboard has to follow the day on the screen. */
  const follow = useRef(false);
  /** True when the calendar closed because a day was opened. */
  const picked = useRef(false);
  const focusContent = useRef(onFocusContent);
  focusContent.current = onFocusContent;

  const [cursor, setCursor] = useState<CivilDate>(() => civilOf(new Date()));
  /** The date the field starts with. */
  const initialKey = useRef(formatLocalDate(new Date()));

  /** The day of today, read from the local clock. */
  const today = formatLocalDate(new Date());
  const cursorKey = keyOf(cursor);

  /** The days that have a note, so the grid can mark them. */
  const noted = useMemo(() => {
    const keys = new Set<string>();
    for (const note of notes) {
      if (note.deletedAt !== null) continue;
      const name = normalizeNoteName(note.name);
      if (!parseCivilDate(name)) continue;
      keys.add(name);
    }
    return keys;
  }, [notes]);

  // The panel opens and closes with the platform of the browser. The keyboard
  // goes back to the element that opened it.
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;

    if (open) {
      if (!element.open) {
        opener.current = document.activeElement as HTMLElement | null;
        element.showModal();
      }
      // The keyboard starts on the day that is on the screen.
      follow.current = true;
      return;
    }

    if (!element.open) return;
    element.close();
    if (picked.current) {
      // The note of the day is on the screen now, so the keyboard goes there.
      picked.current = false;
      focusContent.current?.();
      return;
    }
    const target = opener.current;
    if (target?.isConnected) target.focus();
  }, [open]);

  // The keyboard follows the day that moved.
  useEffect(() => {
    if (!open) return;
    if (!follow.current) return;
    const button = buttons.current.get(cursorKey);
    if (!button) return;
    follow.current = false;
    button.focus();
  }, [cursorKey, open]);

  /** Moves the day and puts the keyboard on it. */
  const move = (next: CivilDate) => {
    follow.current = true;
    setCursor(next);
    // The field follows the day that is on the screen.
    const input = inputRef.current;
    if (input) input.value = keyOf(next);
  };

  /** Opens the note of a day. */
  const pick = (key: string) => {
    picked.current = true;
    onOpenDate(key);
  };

  /** The weeks of the month of the cursor, with the empty days of the edges. */
  const weeks = useMemo(() => weeksOf(cursor), [cursor]);

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLTableElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset.day === undefined) return;

    let next: CivilDate | null = null;
    if (event.key === 'ArrowLeft') next = addDays(cursor, -1);
    else if (event.key === 'ArrowRight') next = addDays(cursor, 1);
    else if (event.key === 'ArrowUp') next = addDays(cursor, -7);
    else if (event.key === 'ArrowDown') next = addDays(cursor, 7);
    else if (event.key === 'Home') next = addDays(cursor, -weekday(cursor));
    else if (event.key === 'End') next = addDays(cursor, 6 - weekday(cursor));
    else if (event.key === 'PageUp') next = addMonths(cursor, -1);
    else if (event.key === 'PageDown') next = addMonths(cursor, 1);
    else if (event.key === 'Enter') {
      event.preventDefault();
      pick(cursorKey);
      return;
    } else return;

    event.preventDefault();
    move(next);
  };

  return (
    <dialog
      ref={dialogRef}
      className="calendar"
      aria-labelledby={titleId}
      // A platform-initiated cancel (the browser closes the dialog itself)
      // must still tell the app, or the toolbar button keeps a stale open
      // state and can no longer reopen the calendar.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // The platform would close the dialog as well; one path closes it.
        event.preventDefault();
        onClose();
      }}
    >
      <div className="calendar__panel">
        <div className="calendar__head">
          <button
            type="button"
            className="calendar__nav"
            aria-label="Previous month"
            onClick={() => move(addMonths(cursor, -1))}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <h2 className="calendar__month" id={titleId}>
            {MONTHS[cursor.month - 1]} {cursor.year}
          </h2>
          <button
            type="button"
            className="calendar__nav"
            aria-label="Next month"
            onClick={() => move(addMonths(cursor, 1))}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>

        <div className="calendar__jump">
          <label className="calendar__jump-label" htmlFor={jumpId}>
            Jump to a date
          </label>
          <input
            id={jumpId}
            ref={inputRef}
            className="calendar__jump-input"
            type="date"
            defaultValue={initialKey.current}
            onChange={(event) => {
              // The field is not controlled: a reader types a date segment by
              // segment, and a controlled field would wipe every step.
              const parsed = parseCivilDate(event.target.value);
              if (!parsed) return;
              // The keyboard stays in the field, so the date can be typed.
              setCursor(parsed);
            }}
          />
        </div>

        <div className="calendar__grid-wrap">
          <table className="calendar__grid" onKeyDown={onGridKeyDown}>
            <caption className="visually-hidden">
              The days of {MONTHS[cursor.month - 1]} {cursor.year}
            </caption>
            <thead>
              <tr>
                {WEEKDAYS.map((day) => (
                  <th key={day.full} scope="col" className="calendar__weekday">
                    <span className="visually-hidden">{day.full}</span>
                    <span aria-hidden="true">{day.short}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, index) => (
                <tr key={index}>
                  {week.map((day, cell) => (
                    <td key={cell} className="calendar__cell">
                      {day === null ? null : (
                        <button
                          type="button"
                          className="calendar__day"
                          data-day={keyOf(day)}
                          tabIndex={keyOf(day) === cursorKey ? 0 : -1}
                          aria-current={keyOf(day) === today ? 'date' : undefined}
                          aria-label={`${day.day} ${MONTHS[day.month - 1]} ${day.year}${
                            noted.has(keyOf(day)) ? ', has a note' : ''
                          }`}
                          ref={(element) => {
                            if (element) buttons.current.set(keyOf(day), element);
                            else buttons.current.delete(keyOf(day));
                          }}
                          onClick={() => pick(keyOf(day))}
                        >
                          <span className="calendar__day-number">{day.day}</span>
                          {noted.has(keyOf(day)) ? (
                            <span className="calendar__dot" aria-hidden="true">
                              •
                            </span>
                          ) : null}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="calendar__legend">A dot marks a day that has a note.</p>

        <div className="calendar__foot">
          <button
            type="button"
            className="calendar__today"
            onClick={() => move(civilOf(new Date()))}
          >
            Today
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** The parts of a civil date of an instant, from the local clock. */
function civilOf(date: Date): CivilDate {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** The key of a civil date. */
function keyOf(date: CivilDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(
    date.day,
  ).padStart(2, '0')}`;
}

/** A local date, with the noon hour so a day never jumps over a DST change. */
function localDate(year: number, month: number, day: number): Date {
  const date = new Date(year, month - 1, day, 12);
  // The two digit years of the platform are in the twentieth century.
  if (year >= 0 && year < 100) date.setFullYear(year);
  return date;
}

/** A civil date a number of days away. */
function addDays(date: CivilDate, days: number): CivilDate {
  const moved = localDate(date.year, date.month, date.day + days);
  return civilOf(moved);
}

/** A civil date a number of months away, on a day the month really has. */
function addMonths(date: CivilDate, months: number): CivilDate {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  return { year, month, day: Math.min(date.day, monthDays(year, month)) };
}

/** The days from Monday to the day of a date. */
function weekday(date: CivilDate): number {
  return (localDate(date.year, date.month, date.day).getDay() + 6) % 7;
}

/**
 * The weeks of a month.
 *
 * The days of the month come first, and the empty days of the edges fill the
 * week, so every row has seven cells and the grid keeps its shape.
 */
function weeksOf(cursor: CivilDate): (CivilDate | null)[][] {
  const days = monthDays(cursor.year, cursor.month);
  const leading = weekday({ year: cursor.year, month: cursor.month, day: 1 });
  const cells: (CivilDate | null)[] = [];
  for (let index = 0; index < leading; index += 1) cells.push(null);
  for (let day = 1; day <= days; day += 1) {
    cells.push({ year: cursor.year, month: cursor.month, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (CivilDate | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}
