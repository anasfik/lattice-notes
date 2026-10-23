import { describe, expect, it } from 'vitest';

import { diffCounts, retentionCutoff, shouldCapture } from './snapshots';

const MINUTE = 60_000;
const DAY = 86_400_000;

describe('snapshot capture', () => {
  it('captures only after the interval elapsed', () => {
    const now = 10 * MINUTE;

    expect(shouldCapture(0, now, 5)).toBe(true);
    expect(shouldCapture(now - 5 * MINUTE, now, 5)).toBe(true);
    expect(shouldCapture(now - 4 * MINUTE, now, 5)).toBe(false);
    expect(shouldCapture(now, now, 5)).toBe(false);
  });

  it('never captures when the interval is turned off', () => {
    expect(shouldCapture(0, 10 * MINUTE, 0)).toBe(false);
  });

  it('keeps the clock of the reader when it moves back', () => {
    const now = 10 * MINUTE;

    expect(shouldCapture(now + MINUTE, now, 5)).toBe(false);
  });
});

describe('snapshot retention', () => {
  it('prunes snapshots older than the retention window', () => {
    const now = 100 * DAY;

    expect(retentionCutoff(now, 30)).toBe(now - 30 * DAY);
    expect(retentionCutoff(now, 1)).toBe(now - DAY);
  });
});

describe('snapshot diff', () => {
  it('counts added and removed lines', () => {
    expect(diffCounts('a\nb', 'a\nb')).toEqual({ added: 0, removed: 0 });
    expect(diffCounts('a\nb', 'a\nb\nc')).toEqual({ added: 1, removed: 0 });
    expect(diffCounts('a\nb\nc', 'a\nb')).toEqual({ added: 0, removed: 1 });
    expect(diffCounts('a\nb', 'a\nc')).toEqual({ added: 1, removed: 1 });
  });

  it('counts a line that moved as one removal and one addition', () => {
    expect(diffCounts('a\nb\nc', 'c\nb\na')).toEqual({ added: 0, removed: 0 });
    expect(diffCounts('a\na', 'a')).toEqual({ added: 0, removed: 1 });
  });

  it('treats an empty body as no lines', () => {
    expect(diffCounts('', '')).toEqual({ added: 0, removed: 0 });
    expect(diffCounts('', 'a')).toEqual({ added: 1, removed: 0 });
  });
});
