/**
 * Local persistence for the vault document.
 *
 * The app keeps one versioned document in IndexedDB. The public API stays
 * small on purpose: `loadVault` resolves null only when storage is readable
 * and genuinely empty, and both functions reject on storage errors so the app
 * can fall back to memory and warn the user instead of losing work.
 */

import { createEmptyVault, createNote } from '../domain/vault';
import type { Note, Vault } from '../domain/types';

const DB_NAME = 'lattice-notes';
const DB_VERSION = 1;
const STORE_NAME = 'vault';
const DOCUMENT_KEY = 'current';
const DOCUMENT_VERSION = 1;

interface VaultDocument {
  version: number;
  vault: Vault;
}

/**
 * Reads the stored vault.
 *
 * Resolves `null` when storage is readable and holds no document, resolves the
 * vault when the document is current, and rejects on any storage or document
 * error.
 */
export async function loadVault(): Promise<Vault | null> {
  const db = await openDatabase();
  try {
    const document = await readDocument(db);
    if (document === undefined || document === null) return null;
    return readVault(document);
  } finally {
    db.close();
  }
}

/** Writes the vault as a versioned document. Rejects when the write fails. */
export async function saveVault(vault: Vault): Promise<void> {
  const db = await openDatabase();
  try {
    await writeDocument(db, { version: DOCUMENT_VERSION, vault });
  } finally {
    db.close();
  }
}

/**
 * The first-run vault. It is bootstrap data rather than domain behaviour, so
 * it lives beside the persistence code that consumes it.
 */
export function createSeedVault(): Vault {
  const welcome = createNote(
    createEmptyVault(),
    'Welcome to Lattice Notes',
    [
      '# Welcome to Lattice Notes',
      '',
      'Everything here is plain Markdown stored in this browser. No account, no server, no copy of your notes elsewhere.',
      '',
      '- Press **New note** or `Ctrl/Cmd+N` to write.',
      '- The editor is on the left, the rendered preview on the right.',
      '- Link two notes with double brackets, for example [[Getting started]].',
      '',
      'Next step: [[Getting started]].',
    ].join('\n'),
  );

  const gettingStarted = createNote(
    welcome.vault,
    'Getting started',
    [
      '# Getting started',
      '',
      '1. Pick a note in the explorer.',
      '2. Write Markdown in the editor.',
      '3. Link to another note with [[Project Atlas]].',
      '',
      'Renaming and deleting are reversible: deleting announces the note and leaves an undo button behind.',
    ].join('\n'),
  );

  const atlas = createNote(
    gettingStarted.vault,
    'Project Atlas',
    [
      '# Project Atlas',
      '',
      'A small working list to try the editor with.',
      '',
      '- Draft the outline',
      '- Review the notes',
      '- Share the result',
      '',
      'See [[Getting started]] for the basics.',
    ].join('\n'),
  );

  return { ...atlas.vault, activeNoteId: welcome.note.id };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = globalThis.indexedDB;
    if (!factory) {
      reject(new Error('This browser did not provide IndexedDB, so the vault cannot be stored locally.'));
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(asError(error, 'The local vault database could not be opened.'));
      return;
    }

    let settled = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      // A connection that arrives after the request was rejected must not leak.
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error('The local vault database could not be opened.'));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error('The local vault database is open in another tab.'));
    };
  });
}

function readDocument(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(DOCUMENT_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The local vault could not be read.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The local vault read was aborted.'));
  });
}

function writeDocument(db: IDBDatabase, document: VaultDocument): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('The local vault could not be written.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The local vault write was aborted.'));
    transaction.objectStore(STORE_NAME).put(document, DOCUMENT_KEY);
  });
}

/** Unwraps and validates the stored document. */
function readVault(document: unknown): Vault {
  if (!isRecord(document)) throw new Error('The stored vault document is unreadable.');
  if (document.version !== DOCUMENT_VERSION) {
    throw new Error(`The stored vault document has an unsupported version (${String(document.version)}).`);
  }
  const vault = document.vault;
  if (!isVault(vault)) throw new Error('The stored vault document is unreadable.');
  return vault;
}

function isVault(value: unknown): value is Vault {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.notes) || !value.notes.every(isNote)) return false;
  return value.activeNoteId === null || typeof value.activeNoteId === 'string';
}

function isNote(value: unknown): value is Note {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    (value.deletedAt === null || typeof value.deletedAt === 'number')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}
