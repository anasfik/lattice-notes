export interface AppSettings {
  version: 1;
  confirmDelete: boolean;
  snapshotIntervalMinutes: number;
  snapshotRetentionDays: number;
  excludedPatterns: string[];
  dailyNoteFormat: string;
  spellcheck: boolean;
  theme: 'light' | 'dark' | 'system';
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  confirmDelete: false,
  snapshotIntervalMinutes: 5,
  snapshotRetentionDays: 30,
  excludedPatterns: [],
  dailyNoteFormat: 'YYYY-MM-DD',
  spellcheck: true,
  theme: 'system',
};

/** Validate persisted JSON without allowing malformed settings to affect notes. */
export function normalizeSettings(raw: unknown): AppSettings {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const bounded = (key: 'snapshotIntervalMinutes' | 'snapshotRetentionDays', min: number, max: number) => {
    const n = value[key];
    return typeof n === 'number' && Number.isFinite(n)
      ? Math.min(max, Math.max(min, Math.trunc(n))) : DEFAULT_SETTINGS[key];
  };
  return {
    version: 1,
    confirmDelete: typeof value.confirmDelete === 'boolean' ? value.confirmDelete : DEFAULT_SETTINGS.confirmDelete,
    snapshotIntervalMinutes: bounded('snapshotIntervalMinutes', 0, 60),
    snapshotRetentionDays: bounded('snapshotRetentionDays', 1, 90),
    excludedPatterns: Array.isArray(value.excludedPatterns)
      ? value.excludedPatterns.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    // Civil-date titles remain the supported format until configurable parsing ships.
    dailyNoteFormat: DEFAULT_SETTINGS.dailyNoteFormat,
    spellcheck: typeof value.spellcheck === 'boolean' ? value.spellcheck : DEFAULT_SETTINGS.spellcheck,
    theme: value.theme === 'light' || value.theme === 'dark' || value.theme === 'system'
      ? value.theme : DEFAULT_SETTINGS.theme,
  };
}
