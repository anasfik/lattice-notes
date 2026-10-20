/**
 * Import and export of the vault document.
 *
 * The transfer format is plain JSON so that it stays readable without this
 * app. Every function here is pure: no file system, no browser APIs, and no
 * mutation of the vault it is given.
 */

import { activeNotes, createNotes } from './vault';
import type { NoteDraft } from './vault';
import type { Vault } from './types';

/** Largest Markdown file that is imported as a single note (1 MiB). */
export const MAX_IMPORT_FILE_BYTES = 1_048_576;
/** Largest number of files imported in one batch. */
export const MAX_IMPORT_FILES = 500;
/** Largest JSON envelope that is accepted (50 MiB). */
export const MAX_ENVELOPE_BYTES = 52_428_800;
/**
 * Largest number of notes one envelope may carry (20 000).
 *
 * A minimal note entry is about 30 bytes, so the byte ceiling alone lets a
 * crafted envelope hold more than 100 000 notes. One import would then render
 * every one of them in the explorer.
 */
export const MAX_ENVELOPE_NOTES = 20_000;

export type SkipReason =
  | 'unsupported-type'
  | 'too-large'
  | 'batch-limit'
  | 'unreadable-content';

export interface ImportSkip {
  name: string;
  reason: SkipReason;
}

export interface ImportReport {
  imported: number;
  skipped: ImportSkip[];
}

export interface ImportResult {
  vault: Vault;
  report: ImportReport;
}

interface ParsedNote {
  name: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

/** Serializes the active notes of a vault into the exchange envelope. */
export function serializeVault(vault: Vault): string {
  const notes = activeNotes(vault)
    .map((note) => ({
      name: note.name,
      body: note.body,
      createdAt: toIso(note.createdAt),
      updatedAt: toIso(note.updatedAt),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return JSON.stringify({ app: 'lattice-notes', formatVersion: 1, notes }, null, 2);
}

/**
 * Reads an envelope into a fresh vault. Throws when the envelope itself is
 * unusable, and when any note entry is not a valid note.
 */
export function deserializeVault(json: string): Vault {
  const parsed = parseEnvelope(json);
  if (parsed.invalid.length > 0) {
    if (parsed.invalid.some((entry) => entry.reason === 'batch-limit')) {
      throw new Error(`The envelope holds more than ${MAX_ENVELOPE_NOTES} notes.`);
    }
    throw new Error('The envelope contains a note that is not readable.');
  }
  return buildVault(parsed.notes);
}

/** Merges an envelope into a vault without overwriting an existing note. */
export function importEnvelope(vault: Vault, json: string): ImportResult {
  const parsed = parseEnvelope(json);
  const created = createNotes(vault, parsed.notes);

  return {
    vault: withSelection(created.vault),
    report: { imported: created.notes.length, skipped: parsed.invalid },
  };
}

/** Merges Markdown files into a vault as one note per file. */
export function importMarkdownFiles(
  vault: Vault,
  files: ReadonlyArray<{ name: string; text: string }>,
): ImportResult {
  const skipped: ImportSkip[] = [];
  const drafts: NoteDraft[] = [];
  const now = Date.now();

  files.forEach((file, index) => {
    if (index >= MAX_IMPORT_FILES) {
      skipped.push({ name: file.name, reason: 'batch-limit' });
      return;
    }
    if (new TextEncoder().encode(file.text).length > MAX_IMPORT_FILE_BYTES) {
      skipped.push({ name: file.name, reason: 'too-large' });
      return;
    }
    if (file.text.trim() === '') {
      skipped.push({ name: file.name, reason: 'unreadable-content' });
      return;
    }
    drafts.push({ name: file.name, body: file.text, createdAt: now, updatedAt: now });
  });

  const created = createNotes(vault, drafts);

  return {
    vault: withSelection(created.vault),
    report: { imported: created.notes.length, skipped },
  };
}

/**
 * The one parser behind both entry points. Envelope level problems throw;
 * note entries that are not valid notes are collected for the report.
 */
function parseEnvelope(json: string): { notes: ParsedNote[]; invalid: ImportSkip[] } {
  if (exceedsEnvelopeLimit(json)) throw new Error('The envelope is too large to import.');

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('The envelope is not valid JSON.');
  }

  if (!isRecord(value)) throw new Error('The envelope must be a JSON object.');
  if (value.app !== 'lattice-notes') throw new Error('The envelope is not a Lattice Notes export.');
  if (value.formatVersion !== 1) {
    throw new Error(`The envelope format version is not supported (${String(value.formatVersion)}).`);
  }
  if (!Array.isArray(value.notes)) throw new Error('The envelope has no notes array.');

  const now = Date.now();
  const notes: ParsedNote[] = [];
  const invalid: ImportSkip[] = [];

  value.notes.forEach((entry: unknown, index: number) => {
    if (notes.length >= MAX_ENVELOPE_NOTES) {
      // Past the note ceiling the entry is reported, not imported. The import
      // of the notes inside the ceiling still succeeds.
      invalid.push({ name: entryName(entry, index), reason: 'batch-limit' });
      return;
    }
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.body !== 'string') {
      invalid.push({ name: entryName(entry, index), reason: 'unreadable-content' });
      return;
    }
    notes.push({
      name: entry.name,
      body: entry.body,
      createdAt: toTimestamp(entry.createdAt, now),
      updatedAt: toTimestamp(entry.updatedAt, now),
    });
  });

  return { notes, invalid };
}

/** Keeps the current selection when it still exists, otherwise selects the first note. */
function withSelection(vault: Vault): Vault {
  const kept =
    vault.activeNoteId !== null &&
    vault.notes.some((note) => note.id === vault.activeNoteId && note.deletedAt === null);
  if (kept) return vault;

  return { ...vault, activeNoteId: activeNotes(vault)[0]?.id ?? null };
}

function buildVault(notes: ParsedNote[]): Vault {
  return withSelection(createNotes({ notes: [], activeNoteId: null }, notes).vault);
}

function exceedsEnvelopeLimit(json: string): boolean {
  if (json.length > MAX_ENVELOPE_BYTES) return true;
  return new TextEncoder().encode(json).length > MAX_ENVELOPE_BYTES;
}

function toIso(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function entryName(entry: unknown, index: number): string {
  if (isRecord(entry) && typeof entry.name === 'string') return entry.name;
  return `Note ${index + 1}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
