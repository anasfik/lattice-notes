import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';

describe('settings normalization', () => {
  it('returns independent defaults for unknown input', () => {
    for (const input of [undefined, null, [], 'bad', 7]) {
      const result = normalizeSettings(input);
      expect(result).toEqual(DEFAULT_SETTINGS);
      result.excludedPatterns.push('private');
      expect(DEFAULT_SETTINGS.excludedPatterns).toEqual([]);
    }
  });
  it('keeps known fields and drops unknown ones', () => {
    expect(normalizeSettings({ confirmDelete: true, spellcheck: false, theme: 'dark', extra: 1 }))
      .toEqual({ ...DEFAULT_SETTINGS, confirmDelete: true, spellcheck: false, theme: 'dark' });
  });
  it('clamps finite intervals and retention and rejects invalid types', () => {
    expect(normalizeSettings({ snapshotIntervalMinutes: 100, snapshotRetentionDays: -3 }))
      .toMatchObject({ snapshotIntervalMinutes: 60, snapshotRetentionDays: 1 });
    expect(normalizeSettings({ snapshotIntervalMinutes: -1, snapshotRetentionDays: 100 }))
      .toMatchObject({ snapshotIntervalMinutes: 0, snapshotRetentionDays: 90 });
    expect(normalizeSettings({ snapshotIntervalMinutes: NaN, snapshotRetentionDays: Infinity, confirmDelete: 'false', theme: 'pink' }))
      .toEqual(DEFAULT_SETTINGS);
  });
  it('copies string exclusions and retains only a supported daily format', () => {
    const patterns = ['Private/*', 42, ''];
    expect(normalizeSettings({ excludedPatterns: patterns, dailyNoteFormat: 'arbitrary' }))
      .toMatchObject({ excludedPatterns: ['Private/*'], dailyNoteFormat: 'YYYY-MM-DD' });
    expect(patterns).toEqual(['Private/*', 42, '']);
  });
});
