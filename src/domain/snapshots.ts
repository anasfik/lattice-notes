/**
 * The recovery history of a note.
 *
 * A snapshot is the body of a note before it was replaced. It is the undo
 * that the app has for a body that was overwritten by mistake: the reader can
 * put the old text back, and the body that was on the screen when they
 * pressed restore is snapshotted as well, so a restore is reversible too.
 *
 * The helpers here are pure, so the rules of the history can be tested without
 * a storage and without a clock of their own.
 */

/** One saved body of a note. */
export interface Snapshot {
  /** The key of the record in the store. */
  key: string;
  /** The vault the note belongs to. */
  vaultId: string;
  /** The note the body belongs to. */
  noteId: string;
  /** When the body was captured, in milliseconds. */
  at: number;
  /** The body as it was before the change. */
  body: string;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * The ceiling of the kept bodies of one vault, in bytes.
 *
 * The history is a safety net, not an archive. It may never grow until the
 * storage of the browser refuses the notes of the reader, so the bodies of one
 * vault share a budget of eight mebibytes of UTF-8 text. That is far more
 * than a day of writing and small enough to leave room for the notes.
 */
export const MAX_VAULT_SNAPSHOT_BYTES = 8 * 1024 * 1024;

/**
 * The size of a body in bytes, as UTF-8.
 *
 * The storage of a browser counts the bytes it holds, not the characters, so
 * the budget is measured in the same unit. A body of a million characters of
 * CJK text is three megabytes, not one.
 */
export function byteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}

/** One kept body with the size it takes in the storage. */
export interface SizedBody {
  key: string;
  at: number;
  bytes: number;
}

/**
 * The bodies that have to go so a new one fits in the budget.
 *
 * The oldest bodies go first, so the history keeps the bodies a reader is
 * most likely to want. The list is empty when the new body fits as it is, and
 * it holds every body of the vault when the new body is the only one that
 * may stay.
 */
export function planSnapshotEviction(
  bodies: readonly SizedBody[],
  size: number,
  budget: number,
): string[] {
  const doomed: string[] = [];
  let total = bodies.reduce((sum, body) => sum + body.bytes, 0);
  const oldestFirst = [...bodies].sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  for (const body of oldestFirst) {
    if (total + size <= budget) break;
    doomed.push(body.key);
    total -= body.bytes;
  }
  return doomed;
}

/**
 * True when a new snapshot is due.
 *
 * The first capture of a note is always due: `lastAt` of zero means that the
 * note has no snapshot yet. An interval of zero turns the history off, so
 * nothing is ever captured. A clock that moved back never captures, because
 * the difference is negative.
 */
export function shouldCapture(lastAt: number, now: number, intervalMinutes: number): boolean {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return false;
  if (!Number.isFinite(now)) return false;
  const elapsed = now - lastAt;
  if (elapsed < 0) return false;
  return elapsed >= intervalMinutes * MINUTE_MS;
}

/**
 * The moment before which a snapshot is too old to keep.
 *
 * The retention window is counted in days, so the oldest snapshot that is
 * still kept is the one that is exactly one window old.
 */
export function retentionCutoff(now: number, retentionDays: number): number {
  const days = Number.isFinite(retentionDays) ? Math.max(1, Math.trunc(retentionDays)) : 1;
  return now - days * DAY_MS;
}

/**
 * The number of lines that a change added and removed.
 *
 * The count is a difference of the lines of the two bodies, so a line that
 * moved is not counted at all and a line that was typed twice is counted
 * once. It is a number for the reader, not a patch: the snapshot itself keeps
 * the whole body.
 */
export function diffCounts(before: string, after: string): { added: number; removed: number } {
  const oldLines = countLines(before);
  const newLines = countLines(after);
  let added = 0;
  let removed = 0;
  for (const [line, count] of newLines) {
    const old = oldLines.get(line) ?? 0;
    if (count > old) added += count - old;
  }
  for (const [line, count] of oldLines) {
    const newer = newLines.get(line) ?? 0;
    if (count > newer) removed += count - newer;
  }
  return { added, removed };
}

/** How often every line of a body occurs in it. */
function countLines(body: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (typeof body !== 'string' || body.length === 0) return counts;
  for (const line of body.split('\n')) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}
