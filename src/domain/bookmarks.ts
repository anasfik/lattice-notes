/**
 * The bookmarks of a vault.
 *
 * A bookmark points at a note, at a heading of a note or at a search. It
 * belongs to one vault and is stored with that vault, so the bookmarks of two
 * vaults never meet.
 *
 * The id of a bookmark follows from what it points at: the bookmark of a
 * target is the same bookmark in every session, so it can be stored and found
 * again without a second record.
 */

export type BookmarkKind = 'note' | 'heading' | 'search';

export interface Bookmark {
  /** The id of the bookmark, built from its kind and its target. */
  id: string;
  /** What the bookmark points at. */
  kind: BookmarkKind;
  /** The note, the heading or the query the bookmark points at. */
  target: string;
  /** The name the reader sees. */
  title: string;
  /** The group the bookmark is listed under. */
  group: string;
}

/** The group of a bookmark that names no group of its own. */
export const DEFAULT_GROUP = 'Bookmarks';

/**
 * Adds a bookmark, or takes it off when it is already there.
 *
 * A bookmark is the same bookmark when it points at the same thing in the
 * same way, so a note and a heading of that note are two bookmarks.
 */
export function toggleBookmark(list: Bookmark[], candidate: Omit<Bookmark, 'id'>): Bookmark[] {
  const index = list.findIndex(
    (entry) => entry.kind === candidate.kind && entry.target === candidate.target,
  );
  if (index >= 0) return list.filter((_, position) => position !== index);
  return [...list, { ...candidate, id: bookmarkId(candidate.kind, candidate.target) }];
}

/**
 * Groups the bookmarks of a vault.
 *
 * The groups come in the order of their names and the bookmarks of a group in
 * the order of their titles, so the list of the panel never jumps around.
 */
export function groupBookmarks(list: Bookmark[]): Map<string, Bookmark[]> {
  const groups = new Map<string, Bookmark[]>();
  for (const bookmark of list) {
    const group = bookmark.group.trim() || DEFAULT_GROUP;
    const bucket = groups.get(group);
    if (bucket) bucket.push(bookmark);
    else groups.set(group, [bookmark]);
  }

  const sorted = new Map<string, Bookmark[]>();
  for (const group of [...groups.keys()].sort(compareText)) {
    sorted.set(group, groups.get(group)!.sort((a, b) => compareText(a.title, b.title)));
  }
  return sorted;
}

/** The id of the bookmark of a target. */
export function bookmarkId(kind: BookmarkKind, target: string): string {
  return `${kind}:${target}`;
}

/** The order of two names. The letters decide, not the case. */
function compareText(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
