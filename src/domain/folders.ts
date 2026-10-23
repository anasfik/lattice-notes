/**
 * Virtual folders.
 *
 * A folder is a path in the name of a note, not a folder of a file system:
 * `Projects/Untitled` lives in the folder `Projects`, and nothing else about
 * the vault changes. The folders therefore survive every save, every export
 * and every import without a new record in the storage, and an empty folder
 * cannot exist — a folder is there because a note is in it.
 *
 * Every function here is pure: the index of the notes is derived from the
 * names, and the names are the truth.
 */

import type { Note } from './types';

/** The parts of a note name. */
export interface NotePath {
  /** The folders the note sits in, from the outermost to the innermost. */
  folders: string[];
  /** The name of the note itself. */
  title: string;
}

/** A folder of the index, with the notes that live in it. */
export interface FolderGroup {
  /** The full path of the folder, e.g. `Projects/Archive`. */
  path: string;
  /** The name of the folder itself, e.g. `Archive`. */
  name: string;
  /** The notes that live directly in this folder. */
  notes: Note[];
  /** The folders inside this one. */
  children: FolderGroup[];
}

/** The index of the notes of a vault. */
export interface NoteIndex {
  /** The folders of the vault, in the order of their path. */
  folders: FolderGroup[];
  /** The notes whose name has no folder. */
  loose: Note[];
}

/** The answer of the folder path of a new folder. */
export type FolderPathResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/** The name of the first note of a folder. */
const FIRST_NOTE_NAME = 'Untitled';

/**
 * Splits a note name into its folders and its own title.
 *
 * The name is split on the slash. Empty parts are ignored, so a name that
 * ends in a slash is the name of a note and not a folder.
 */
export function splitNotePath(name: string): NotePath {
  const parts = name.split('/').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return { folders: [], title: name };
  const title = parts[parts.length - 1]!;
  return { folders: parts.slice(0, -1), title };
}

/**
 * Builds the index of the notes.
 *
 * The notes are read by their name only. A note in the trash is not part of
 * the index, and a note without a path keeps its place among the loose notes.
 * Folders of the same path are one folder, whatever the case of the path is,
 * so the index never shows two headings that differ only in their case.
 */
export function buildNoteIndex(notes: readonly Note[]): NoteIndex {
  const roots: FolderGroup[] = [];
  const loose: Note[] = [];

  /** The folders by their lower cased path, so a path is found in one step. */
  const groups = new Map<string, FolderGroup>();

  const groupFor = (folders: string[]): FolderGroup | null => {
    if (folders.length === 0) return null;
    const path = folders.join('/');
    const key = path.toLowerCase();
    const found = groups.get(key);
    if (found) return found;

    const group: FolderGroup = { path, name: folders[folders.length - 1]!, notes: [], children: [] };
    groups.set(key, group);
    const parent = groupFor(folders.slice(0, -1));
    if (parent) parent.children.push(group);
    else roots.push(group);
    return group;
  };

  for (const entry of notes) {
    if (entry.deletedAt !== null) continue;
    const { folders } = splitNotePath(entry.name);
    const group = groupFor(folders);
    if (group) group.notes.push(entry);
    else loose.push(entry);
  }

  const sortGroups = (list: FolderGroup[]): FolderGroup[] => {
    list.sort((a, b) => (a.path.toLowerCase() < b.path.toLowerCase() ? -1 : 1));
    for (const group of list) sortGroups(group.children);
    return list;
  };

  return { folders: sortGroups(roots), loose };
}

/**
 * Checks the path of a new folder.
 *
 * A path is a list of names separated by slashes. It may not be empty, it may
 * not hold an empty part and it may not walk out of the vault with `.` or
 * `..`, because a folder here is only a name.
 */
export function validateFolderPath(raw: string): FolderPathResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Give the folder a name, for example Projects.' };
  }

  const parts = trimmed.split('/');
  const cleaned: string[] = [];
  for (const part of parts) {
    const name = part.trim();
    if (name.length === 0) {
      return { ok: false, reason: 'A folder path has no empty part.' };
    }
    if (name === '.' || name === '..') {
      return { ok: false, reason: 'A folder path cannot hold "." or "..".' };
    }
    cleaned.push(name);
  }

  return { ok: true, path: cleaned.join('/') };
}

/**
 * The name of the first note of a folder.
 *
 * A folder is created by its first note, so the name of that note is the path
 * of the folder and the name of the note.
 */
export function firstNoteName(path: string): string {
  return `${path}/${FIRST_NOTE_NAME}`;
}
