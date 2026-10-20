import { describe, expect, it } from 'vitest';

import {
  MAX_ENVELOPE_BYTES,
  MAX_ENVELOPE_NOTES,
  MAX_IMPORT_FILES,
  MAX_IMPORT_FILE_BYTES,
  deserializeVault,
  importEnvelope,
  importMarkdownFiles,
  serializeVault,
} from './transfer';
import type { Note, Vault } from './types';

const CREATED = 1_700_000_000_000;
const CREATED_ISO = new Date(CREATED).toISOString();

/**
 * Wall clock budget for merging a 5000 note envelope. The quadratic
 * implementation needed several seconds for the same merge; the linear one
 * needs a few milliseconds. The bound sits far above the linear cost and far
 * below the quadratic cost.
 */
const MERGE_TIME_BUDGET_MS = 500;

function note(name: string, body: string, overrides: Partial<Note> = {}): Note {
  return {
    id: `id-${name}`,
    name,
    body,
    createdAt: CREATED,
    updatedAt: CREATED,
    deletedAt: null,
    ...overrides,
  };
}

function vaultOf(...notes: Note[]): Vault {
  return { notes, activeNoteId: notes[0]?.id ?? null };
}

function envelope(notes: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ app: 'lattice-notes', formatVersion: 1, notes, ...extra });
}

describe('serializeVault', () => {
  it('emits the exact envelope shape with active notes only, sorted by name', () => {
    const vault = vaultOf(
      note('Beta', '# beta'),
      note('Alpha', '# alpha'),
      note('Trashed', 'gone', { deletedAt: CREATED }),
    );

    const json = serializeVault(vault);

    expect(json).toBe(
      JSON.stringify(
        {
          app: 'lattice-notes',
          formatVersion: 1,
          notes: [
            { name: 'Alpha', body: '# alpha', createdAt: CREATED_ISO, updatedAt: CREATED_ISO },
            { name: 'Beta', body: '# beta', createdAt: CREATED_ISO, updatedAt: CREATED_ISO },
          ],
        },
        null,
        2,
      ),
    );
    expect(json.endsWith('\n')).toBe(false);
  });
});

describe('deserializeVault', () => {
  it('round-trips a vault byte-identically through serialize and deserialize', () => {
    const exported = serializeVault(vaultOf(note('Alpha', '# alpha'), note('Beta', '# beta')));

    const reimported = serializeVault(deserializeVault(exported));

    expect(reimported).toBe(exported);
  });

  it('gives every imported note a fresh id and selects the first one', () => {
    const vault = deserializeVault(
      envelope([
        { name: 'Alpha', body: '# alpha' },
        { name: 'Beta', body: '# beta' },
      ]),
    );

    const ids = vault.notes.map((entry) => entry.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids).not.toContain('id-Alpha');
    expect(vault.activeNoteId).toBe(vault.notes[0]?.id);
  });

  it('throws for text that is not valid JSON', () => {
    expect(() => deserializeVault('not json at all')).toThrow(/JSON/i);
  });

  it('throws for JSON that is not an object', () => {
    expect(() => deserializeVault('[]')).toThrow(/object/i);
  });

  it('throws for another application', () => {
    expect(() => deserializeVault(JSON.stringify({ app: 'other-app', formatVersion: 1, notes: [] }))).toThrow(
      /Lattice Notes/i,
    );
  });

  it('throws for an unsupported format version', () => {
    expect(() => deserializeVault(JSON.stringify({ app: 'lattice-notes', formatVersion: 2, notes: [] }))).toThrow(
      /version/i,
    );
  });

  it('throws when the notes array is missing', () => {
    expect(() => deserializeVault(JSON.stringify({ app: 'lattice-notes', formatVersion: 1 }))).toThrow(/notes/i);
  });

  it('throws for a note with a non-string name', () => {
    expect(() => deserializeVault(envelope([{ name: 7, body: 'x' }]))).toThrow(/readable/i);
  });

  it('throws for a note with a non-string body', () => {
    expect(() => deserializeVault(envelope([{ name: 'Alpha', body: null }]))).toThrow(/readable/i);
  });

  it('tolerates unknown keys and a missing timestamp', () => {
    const vault = deserializeVault(
      envelope([{ name: 'Alpha', body: '# alpha', unknown: 'ignored' }], { unknown: 'ignored' }),
    );

    expect(vault.notes).toHaveLength(1);
    expect(vault.notes[0]?.name).toBe('Alpha');
    expect(vault.notes[0]?.body).toBe('# alpha');
    expect(vault.notes[0]?.createdAt).toBeTypeOf('number');
    expect(vault.notes[0]?.createdAt).toBeGreaterThan(0);
  });

  it('accepts an empty notes array', () => {
    const vault = deserializeVault(envelope([]));

    expect(vault.notes).toEqual([]);
    expect(vault.activeNoteId).toBeNull();
  });

  it('rejects an envelope larger than the envelope ceiling', () => {
    expect(() => deserializeVault('x'.repeat(MAX_ENVELOPE_BYTES + 1))).toThrow(/large/i);
  });
});

describe('importEnvelope', () => {
  it('merges into a populated vault without overwriting the existing note', () => {
    const existing = vaultOf(note('Alpha', 'original body'));

    const result = importEnvelope(
      existing,
      envelope([{ name: 'Alpha', body: 'incoming body', createdAt: CREATED_ISO, updatedAt: CREATED_ISO }]),
    );

    expect(result.report.imported).toBe(1);
    expect(result.report.skipped).toEqual([]);
    expect(result.vault.notes).toHaveLength(2);
    expect(result.vault.notes[0]?.body).toBe('original body');
    expect(result.vault.notes[1]?.name).toBe('Alpha 2');
    expect(result.vault.notes[1]?.body).toBe('incoming body');
    expect(result.vault.notes[1]?.createdAt).toBe(CREATED);
    expect(result.vault.activeNoteId).toBe('id-Alpha');
  });

  it('propagates the parse error for an invalid envelope', () => {
    expect(() => importEnvelope(vaultOf(note('Alpha', 'x')), '{"app":"other-app"}')).toThrow(/Lattice Notes/i);
  });

  it('reports a note entry that is not a valid note instead of failing the whole import', () => {
    const result = importEnvelope(
      vaultOf(),
      envelope([{ name: 'Alpha', body: '# alpha' }, { name: 7, body: '# broken' }]),
    );

    expect(result.report.imported).toBe(1);
    expect(result.report.skipped).toEqual([{ name: 'Note 2', reason: 'unreadable-content' }]);
    expect(result.vault.notes).toHaveLength(1);
  });

  it('imports the notes inside the note ceiling and reports the rest as over the batch limit', () => {
    const entries = Array.from({ length: MAX_ENVELOPE_NOTES + 1 }, (_, index) => ({
      name: `Note ${index}`,
      body: '# body',
    }));

    const result = importEnvelope(vaultOf(), envelope(entries));

    expect(result.report.imported).toBe(MAX_ENVELOPE_NOTES);
    expect(result.report.skipped).toEqual([
      { name: `Note ${MAX_ENVELOPE_NOTES}`, reason: 'batch-limit' },
    ]);
    expect(result.vault.notes).toHaveLength(MAX_ENVELOPE_NOTES);
  });

  it('imports an envelope larger than the Markdown file limit and keeps the large note', () => {
    const body = 'x'.repeat(MAX_IMPORT_FILE_BYTES + 1);

    const result = importEnvelope(vaultOf(), envelope([{ name: 'Big', body }]));

    expect(result.report.imported).toBe(1);
    expect(result.report.skipped).toEqual([]);
    expect(result.vault.notes[0]?.body.length).toBe(body.length);
  });
});

describe('importMarkdownFiles', () => {
  it('imports files, skips an oversized file, and skips files past the batch limit', () => {
    const fillers = Array.from({ length: MAX_IMPORT_FILES - 3 }, (_, index) => ({
      name: `Filler ${index}.md`,
      text: 'filler',
    }));
    const files = [
      { name: 'Alpha.md', text: '# alpha' },
      { name: 'Beta.md', text: '# beta' },
      { name: 'Huge.md', text: 'x'.repeat(MAX_IMPORT_FILE_BYTES + 1) },
      ...fillers,
      { name: 'Late.md', text: 'late' },
    ];

    const result = importMarkdownFiles(vaultOf(), files);

    expect(result.report.imported).toBe(2 + fillers.length);
    expect(result.report.skipped).toEqual([
      { name: 'Huge.md', reason: 'too-large' },
      { name: 'Late.md', reason: 'batch-limit' },
    ]);
    expect(result.vault.notes).toHaveLength(result.report.imported);
    const names = result.vault.notes.map((entry) => entry.name);
    expect(names).toContain('Alpha.md');
    expect(names).not.toContain('Huge.md');
    expect(names).not.toContain('Late.md');
  });

  it('skips a file whose text is empty', () => {
    const result = importMarkdownFiles(vaultOf(), [{ name: 'Blank.md', text: '   \n ' }]);

    expect(result.report.imported).toBe(0);
    expect(result.report.skipped).toEqual([{ name: 'Blank.md', reason: 'unreadable-content' }]);
  });

  it('never mutates the vault it is given', () => {
    const vault = vaultOf(note('Alpha', 'original'));
    const snapshot = JSON.stringify(vault);

    const result = importMarkdownFiles(vault, [{ name: 'Beta.md', text: '# beta' }]);

    expect(JSON.stringify(vault)).toBe(snapshot);
    expect(result.vault).not.toBe(vault);
  });

  it('preserves the existing notes and the existing selection', () => {
    const vault = vaultOf(note('Alpha', 'original'));

    const result = importMarkdownFiles(vault, [{ name: 'Beta.md', text: '# beta' }]);

    expect(result.vault.notes[0]?.name).toBe('Alpha');
    expect(result.vault.notes[0]?.body).toBe('original');
    expect(result.vault.notes).toHaveLength(2);
    expect(result.vault.activeNoteId).toBe('id-Alpha');
  });

  it('gives a colliding file name the existing suffix', () => {
    const vault = vaultOf(note('Alpha.md', 'original'));

    const result = importMarkdownFiles(vault, [{ name: 'Alpha.md', text: '# incoming' }]);

    expect(result.vault.notes[0]?.body).toBe('original');
    expect(result.vault.notes[1]?.name).toBe('Alpha.md 2');
  });
});

describe('import performance', () => {
  it('merges a 5000 note envelope inside the time budget', () => {
    const notes = Array.from({ length: 5000 }, (_, index) => ({
      name: index % 1000 === 0 ? 'Shared' : `Note ${index}`,
      body: `# body ${index}`,
    }));

    const started = performance.now();
    const result = importEnvelope(vaultOf(note('Existing', 'body')), envelope(notes));
    const elapsed = performance.now() - started;

    expect(result.report.imported).toBe(5000);
    expect(result.vault.notes).toHaveLength(5001);
    expect(elapsed).toBeLessThan(MERGE_TIME_BUDGET_MS);
  });
});

describe('selection after an import', () => {
  it('selects the imported note when the vault holds only trashed notes', () => {
    const vault: Vault = { notes: [note('Trashed', 'gone', { deletedAt: CREATED })], activeNoteId: null };

    const result = importMarkdownFiles(vault, [{ name: 'Fresh.md', text: '# fresh' }]);

    const imported = result.vault.notes.find((entry) => entry.name === 'Fresh.md');
    expect(result.vault.activeNoteId).toBe(imported?.id);
    expect(result.vault.activeNoteId).not.toBe('id-Trashed');
  });

  it('never selects a trashed note, not even the one that was selected', () => {
    const vault = vaultOf(note('Trashed', 'gone', { deletedAt: CREATED }));

    const result = importMarkdownFiles(vault, [{ name: 'Fresh.md', text: '# fresh' }]);

    const active = result.vault.notes.find((entry) => entry.id === result.vault.activeNoteId);
    expect(active?.deletedAt).toBeNull();
    expect(active?.name).toBe('Fresh.md');
  });
});

describe('import naming parity', () => {
  /**
   * The naming rule as it was before the batch path existed: the set of taken
   * names is rebuilt from scratch for every single note.
   */
  function oldNoteName(notes: Note[], desired: string): string {
    const base = desired.replace(/\s+/g, ' ').trim() || 'Untitled';
    const taken = new Set(
      notes.filter((entry) => entry.deletedAt === null).map((entry) => entry.name.toLowerCase()),
    );
    if (!taken.has(base.toLowerCase())) return base;
    let suffix = 2;
    while (taken.has(`${base} ${suffix}`.toLowerCase())) suffix += 1;
    return `${base} ${suffix}`;
  }

  it('names the imported notes exactly like the per note path did', () => {
    const existing = vaultOf(
      note('Alpha', 'original'),
      note('Keeper', 'keep'),
      note('Trashed', 'gone', { deletedAt: CREATED }),
    );
    const incoming = ['alpha', 'Alpha', 'Alpha 2', '   ', 'Trashed', 'Gamma', 'Keeper'];

    const expected: string[] = [];
    const grown = [...existing.notes];
    for (const desired of incoming) {
      const name = oldNoteName(grown, desired);
      expected.push(name);
      grown.push({ ...note(name, 'body'), deletedAt: null });
    }

    const result = importEnvelope(
      existing,
      envelope(incoming.map((name) => ({ name, body: 'body' }))),
    );

    expect(result.vault.notes.slice(existing.notes.length).map((entry) => entry.name)).toEqual(expected);
  });
});
