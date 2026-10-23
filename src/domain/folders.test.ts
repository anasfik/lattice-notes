import { describe, expect, it } from 'vitest';

import {
  buildNoteIndex,
  firstNoteName,
  splitNotePath,
  validateFolderPath,
} from './folders';
import type { Note } from './types';

/** A note with the fields the index reads. */
function note(name: string, id = name): Note {
  return {
    id,
    name,
    body: '',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}

describe('the path of a note name', () => {
  it('splits a name into its folders and its own title', () => {
    expect(splitNotePath('Projects/Untitled')).toEqual({
      folders: ['Projects'],
      title: 'Untitled',
    });
    expect(splitNotePath('Untitled')).toEqual({ folders: [], title: 'Untitled' });
    expect(splitNotePath('A/B/C')).toEqual({ folders: ['A', 'B'], title: 'C' });
  });

  it('keeps a name without a path as a title of its own', () => {
    expect(splitNotePath('2026-10-21')).toEqual({ folders: [], title: '2026-10-21' });
  });

  it('does not fall over an empty part of a path', () => {
    expect(splitNotePath('Projects/')).toEqual({ folders: [], title: 'Projects' });
    expect(splitNotePath('A//B')).toEqual({ folders: ['A'], title: 'B' });
  });
});

describe('the index of the notes', () => {
  it('groups the notes into the folders of their names', () => {
    const index = buildNoteIndex([
      note('Alpha'),
      note('Projects/One'),
      note('Projects/Two'),
      note('Projects/Archive/Old'),
    ]);

    expect(index.loose.map((entry) => entry.name)).toEqual(['Alpha']);
    expect(index.folders).toHaveLength(1);

    const projects = index.folders[0]!;
    expect(projects.path).toBe('Projects');
    expect(projects.name).toBe('Projects');
    expect(projects.notes.map((entry) => entry.name)).toEqual(['Projects/One', 'Projects/Two']);

    expect(projects.children).toHaveLength(1);
    expect(projects.children[0]!.path).toBe('Projects/Archive');
    expect(projects.children[0]!.name).toBe('Archive');
    expect(projects.children[0]!.notes.map((entry) => entry.name)).toEqual(['Projects/Archive/Old']);
  });

  it('has no folder for a note whose name has no path', () => {
    const index = buildNoteIndex([note('Alpha'), note('Beta')]);

    expect(index.folders).toEqual([]);
    expect(index.loose.map((entry) => entry.name)).toEqual(['Alpha', 'Beta']);
  });

  it('puts a folder in the same group whatever the case of its name is', () => {
    const index = buildNoteIndex([note('Projects/One'), note('projects/Two')]);

    expect(index.folders).toHaveLength(1);
    expect(index.folders[0]!.notes).toHaveLength(2);
  });

  it('keeps the folders in a stable order', () => {
    const index = buildNoteIndex([note('Zulu/One'), note('Alpha/Two'), note('Alpha/Beta/Three')]);

    expect(index.folders.map((folder) => folder.path)).toEqual(['Alpha', 'Zulu']);
    expect(index.folders[0]!.children.map((folder) => folder.path)).toEqual(['Alpha/Beta']);
  });

  it('leaves a note in the trash out of the index', () => {
    const index = buildNoteIndex([{ ...note('Gone'), deletedAt: 12 }]);

    expect(index.folders).toEqual([]);
    expect(index.loose).toEqual([]);
  });

  it('never invents a folder for a note', () => {
    const index = buildNoteIndex([note('Alpha')]);

    expect(index.folders).toEqual([]);
  });
});

describe('the path of a new folder', () => {
  it('accepts a plain name and a nested path', () => {
    expect(validateFolderPath('Projects')).toEqual({ ok: true, path: 'Projects' });
    expect(validateFolderPath('Projects/Archive')).toEqual({
      ok: true,
      path: 'Projects/Archive',
    });
  });

  it('trims the name of the folder', () => {
    expect(validateFolderPath('  Projects  ')).toEqual({ ok: true, path: 'Projects' });
  });

  it('refuses an empty name', () => {
    const result = validateFolderPath('   ');

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('name');
  });

  it('refuses a path with an empty part', () => {
    for (const path of ['Projects/', '/Projects', 'A//B']) {
      const result = validateFolderPath(path);
      expect(result.ok, `${path} was accepted`).toBe(false);
      expect(result.ok ? '' : result.reason).toContain('empty');
    }
  });

  it('refuses a path that walks out of the vault', () => {
    for (const path of ['A/./B', 'A/../B', '..']) {
      const result = validateFolderPath(path);
      expect(result.ok, `${path} was accepted`).toBe(false);
      expect(result.ok ? '' : result.reason).toContain('.');
    }
  });
});

describe('the first note of a folder', () => {
  it('carries the path of the folder and the name of the note', () => {
    expect(firstNoteName('Projects')).toBe('Projects/Untitled');
    expect(firstNoteName('Projects/Archive')).toBe('Projects/Archive/Untitled');
  });
});
