import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Calendar from './Calendar';
import { formatLocalDate } from '../domain/dailyNotes';
import type { Note } from '../domain/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom ships the dialog element without the modal behaviour, so the harness
// stands in for the platform: the open state, the focus moved into the
// dialog, and the focus restored to the element that had it before.
const dialogProto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
if (typeof dialogProto.showModal !== 'function') {
  const restore = new WeakMap<object, HTMLElement | null>();
  dialogProto.showModal = function showModal(this: HTMLDialogElement) {
    restore.set(this, document.activeElement as HTMLElement | null);
    this.setAttribute('open', '');
    this.querySelector<HTMLElement>('input, button')?.focus();
  };
  dialogProto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
    restore.get(this)?.focus();
  };
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

let container: HTMLDivElement;
let root: Root;
const OPENED: string[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  OPENED.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

/** The parts of a civil date key. */
function parts(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-');
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/** A civil date key. */
function keyOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The key of a day a number of days away. */
function addDays(key: string, days: number): string {
  const { year, month, day } = parts(key);
  const date = new Date(year, month - 1, day + days, 12);
  return keyOf(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** The key of the Monday of the week of a day. */
function mondayOf(key: string): string {
  const { year, month, day } = parts(key);
  const date = new Date(year, month - 1, day, 12);
  return addDays(key, -((date.getDay() + 6) % 7));
}

/** A note with a name. */
function note(name: string): Note {
  return {
    id: `id-${name}`,
    name,
    body: '',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  };
}

interface HarnessProps {
  notes?: Note[];
  /** True when the screen of the reader is narrow. */
  compact?: boolean;
}

/** The calendar with the button that opens it, as the app shows it. */
function Harness({ notes = [], compact = false }: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open the calendar
      </button>
      <Calendar
        open={open}
        notes={notes}
        compact={compact}
        onClose={() => setOpen(false)}
        onOpenDate={(key) => OPENED.push(key)}
      />
    </>
  );
}

async function renderCalendar(notes: Note[] = [], compact = false): Promise<void> {
  await act(async () => {
    root.render(<Harness notes={notes} compact={compact} />);
  });
  // The trigger has the keyboard before the calendar opens, so the calendar
  // knows where the keyboard has to go back to.
  trigger().focus();
  await click(trigger());
}

function trigger(): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>('button');
  if (!found) throw new Error('no trigger');
  return found;
}

function dialog(): HTMLDialogElement {
  const found = container.querySelector<HTMLDialogElement>('dialog.calendar');
  if (!found) throw new Error('no calendar');
  return found;
}

function dayButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.calendar__day'));
}

function dayButton(key: string): HTMLButtonElement {
  const found = dayButtons().find((button) => button.dataset.day === key);
  if (!found) throw new Error(`no day button for ${key}`);
  return found;
}

/** The day that has the keyboard. */
function focusedDay(): string {
  const active = document.activeElement as HTMLElement | null;
  return active?.dataset?.day ?? '';
}

function heading(): string {
  const found = container.querySelector('.calendar__month');
  return found?.textContent?.trim() ?? '';
}

function dateInput(): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('.calendar__jump-input');
  if (!found) throw new Error('no date input');
  return found;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function press(key: string): Promise<void> {
  const target = document.activeElement ?? container;
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

async function type(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the calendar', () => {
  it('marks today with the current date', async () => {
    await renderCalendar();

    const today = formatLocalDate(new Date());
    const current = container.querySelector('[aria-current="date"]');
    expect(current).not.toBeNull();
    expect((current as HTMLElement).dataset.day).toBe(today);
  });

  it('shows the month of today with a readable heading', async () => {
    await renderCalendar();

    const today = parts(formatLocalDate(new Date()));
    expect(heading()).toBe(`${MONTHS[today.month - 1]} ${today.year}`);
  });

  it('names every day with its full date', async () => {
    await renderCalendar();

    const today = parts(formatLocalDate(new Date()));
    const button = dayButton(keyOf(today.year, today.month, today.day));
    expect(button.getAttribute('aria-label')).toBe(
      `${today.day} ${MONTHS[today.month - 1]} ${today.year}`,
    );
  });

  it('marks a day that has a note with a dot and with words', async () => {
    const today = formatLocalDate(new Date());
    await renderCalendar([note(today)]);

    const button = dayButton(today);
    expect(button.getAttribute('aria-label')).toContain('has a note');
    const dot = button.querySelector('.calendar__dot');
    expect(dot?.textContent?.trim()).not.toBe('');
  });

  it('does not mark a day without a note', async () => {
    const today = formatLocalDate(new Date());
    await renderCalendar([note('2026-01-01')]);

    expect(dayButton(today).getAttribute('aria-label')).not.toContain('has a note');
    expect(dayButton(today).querySelector('.calendar__dot')).toBeNull();
  });

  it('does not mark a day of a note in the trash', async () => {
    const today = formatLocalDate(new Date());
    await renderCalendar([{ ...note(today), deletedAt: 1 }]);

    expect(dayButton(today).getAttribute('aria-label')).not.toContain('has a note');
  });

  it('moves the day with the arrow keys', async () => {
    await renderCalendar();
    const today = formatLocalDate(new Date());

    await press('ArrowRight');
    expect(focusedDay()).toBe(addDays(today, 1));

    await press('ArrowDown');
    expect(focusedDay()).toBe(addDays(today, 8));

    await press('ArrowLeft');
    expect(focusedDay()).toBe(addDays(today, 7));

    await press('ArrowUp');
    expect(focusedDay()).toBe(addDays(today, 0));
  });

  it('goes to the ends of the week with Home and End', async () => {
    await renderCalendar();
    const today = formatLocalDate(new Date());

    await press('Home');
    expect(focusedDay()).toBe(mondayOf(today));

    await press('End');
    expect(focusedDay()).toBe(addDays(mondayOf(today), 6));
  });

  it('changes the month with PageUp and PageDown and keeps a real day', async () => {
    await renderCalendar();
    await type(dateInput(), '2026-01-31');
    dayButton('2026-01-31').focus();

    await press('PageDown');
    expect(focusedDay()).toBe('2026-02-28');

    await press('PageUp');
    expect(focusedDay()).toBe('2026-01-28');
  });

  it('changes the month with the buttons and keeps a real day', async () => {
    await renderCalendar();
    const today = parts(formatLocalDate(new Date()));
    const before = heading();

    await click(buttonByLabel('Next month'));
    expect(heading()).not.toBe(before);
    expect(heading()).toBe(nextMonthHeading(today));

    await click(buttonByLabel('Previous month'));
    expect(heading()).toBe(before);
  });

  it('jumps to a date with the date input', async () => {
    await renderCalendar();

    await type(dateInput(), '2026-03-09');

    expect(heading()).toBe('March 2026');
    // The day on the screen is the one that is typed, and it is the day the
    // keyboard walks to when it comes back to the grid.
    const current = container.querySelector('.calendar__day[tabindex="0"]');
    expect((current as HTMLElement)?.dataset.day).toBe('2026-03-09');
  });

  it('does not take the text of the date field back', async () => {
    await renderCalendar();
    const today = formatLocalDate(new Date());

    // A reader types a date segment by segment. The browser reports an empty
    // value until the date is complete, and the app must not put the old
    // date back into the field.
    await type(dateInput(), '2026-1');

    expect(dateInput().value).not.toBe(today);
  });

  it('opens the note of a day through the handler of the app', async () => {
    await renderCalendar();
    const today = formatLocalDate(new Date());

    await click(dayButton(today));

    expect(OPENED).toEqual([today]);
  });

  it('closes with Escape and gives the keyboard back to the opener', async () => {
    await renderCalendar();

    await press('Escape');

    expect(dialog().hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  it('keeps the page free of a horizontal overflow', async () => {    await renderCalendar();

    // The calendar is a dialog, so it lives in the top layer of the page and
    // can never make the page wider than the screen.
    expect(dialog().tagName).toBe('DIALOG');

    // The grid scrolls inside itself, so the 44 pixel days stay big enough.
    const wrap = container.querySelector('.calendar__grid-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap?.contains(container.querySelector('.calendar__grid'))).toBe(true);

    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const scrollRule = css.slice(css.indexOf('.calendar__grid-wrap'));
    expect(scrollRule.slice(0, 300)).toContain('overflow-x: auto');

    const dialogRule = css.slice(css.indexOf('.calendar {'));
    expect(dialogRule.slice(0, 300)).toContain('calc(100vw -');
  });

  it('fits the whole week on a narrow screen', async () => {
    await renderCalendar([], true);

    // The panel knows that the screen is narrow, so it takes the whole width
    // of the screen and the week fits in it.
    expect(dialog().className).toContain('calendar--compact');
    expect(container.querySelectorAll('.calendar__weekday')).toHaveLength(7);

    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const compact = css.slice(css.indexOf('.calendar--compact'));
    expect(compact.slice(0, 400)).toContain('100vw');

    // The days keep their 44 pixel targets, so the week is never shrunk
    // under a finger.
    const day = css.slice(css.indexOf('.calendar__day {'));
    expect(day.slice(0, 300)).toContain('min-width: var(--touch-target)');
  });
});

/** The button of the calendar with an accessible name. */
function buttonByLabel(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`no button named "${label}"`);
  return found;
}

/** The heading of the month after the given one. */
function nextMonthHeading(today: { year: number; month: number }): string {
  const month = today.month === 12 ? 1 : today.month + 1;
  const year = today.month === 12 ? today.year + 1 : today.year;
  return `${MONTHS[month - 1]} ${year}`;
}
