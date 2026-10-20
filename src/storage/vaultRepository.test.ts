import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyVault, createNote } from '../domain/vault';
import type { Vault } from '../domain/types';
import { createSeedVault, loadVault, saveVault } from './vaultRepository';

const DB_NAME = 'lattice-notes';
const STORE_NAME = 'vault';
const DOCUMENT_KEY = 'current';

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Opens the raw database so a test can inspect or replace the stored document. */
async function openRawDatabase(version = 1): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('raw open failed'));
  });
}

async function readRawDocument(): Promise<unknown> {
  const db = await openRawDatabase();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(DOCUMENT_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('raw read failed'));
    });
  } finally {
    db.close();
  }
}

async function writeRawDocument(document: unknown): Promise<void> {
  const db = await openRawDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('raw write failed'));
      transaction.objectStore(STORE_NAME).put(document, DOCUMENT_KEY);
    });
  } finally {
    db.close();
  }
}

/** Creates the database at the current version but without the vault store. */
async function createDatabaseWithoutStore(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error ?? new Error('create failed'));
  });
}

/** Raises the database version and drops the store, so later writes fail. */
async function dropStore(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.deleteObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error ?? new Error('upgrade failed'));
  });
}

beforeEach(async () => {
  await deleteDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('vault repository', () => {
  it('resolves null when storage is readable and empty', async () => {
    await expect(loadVault()).resolves.toBeNull();
  });

  it('round-trips a saved vault', async () => {
    const { vault } = createNote(createEmptyVault(), 'Roadmap', '# Roadmap');

    await saveVault(vault);
    const loaded = await loadVault();

    expect(loaded).toEqual(vault);
    expect(loaded?.notes[0]?.name).toBe('Roadmap');
    expect(loaded?.activeNoteId).toBe(vault.activeNoteId);
  });

  it('stores a versioned envelope around the vault', async () => {
    const { vault } = createNote(createEmptyVault(), 'Roadmap');

    await saveVault(vault);
    const document = (await readRawDocument()) as { version: number; vault: Vault };

    expect(document.version).toBe(1);
    expect(document.vault).toEqual(vault);
  });

  it('rejects a document with an unknown version', async () => {
    const { vault } = createNote(createEmptyVault(), 'Roadmap');
    await saveVault(vault);
    await writeRawDocument({ version: 2, vault });

    await expect(loadVault()).rejects.toThrow(/version/i);
  });

  it('rejects a document whose payload is not a vault', async () => {
    await saveVault(createEmptyVault());
    await writeRawDocument({ version: 1, vault: { notes: 'not-an-array', activeNoteId: null } });

    await expect(loadVault()).rejects.toThrow();
  });

  it('rejects when IndexedDB is not available', async () => {
    vi.stubGlobal('indexedDB', undefined);

    await expect(loadVault()).rejects.toThrow();
    await expect(saveVault(createEmptyVault())).rejects.toThrow();
  });

  it('rejects when the vault store cannot be opened for reading', async () => {
    await createDatabaseWithoutStore();

    await expect(loadVault()).rejects.toThrow();
  });

  it('rejects when the write fails', async () => {
    await saveVault(createEmptyVault());
    await dropStore();

    await expect(saveVault(createEmptyVault())).rejects.toThrow();
  });

  it('seeds a small vault with one selected note', () => {
    const seeded = createSeedVault();

    expect(seeded.notes.length).toBeGreaterThan(1);
    expect(seeded.activeNoteId).toBe(seeded.notes[0]?.id);
    expect(seeded.notes.every((note) => note.deletedAt === null)).toBe(true);

    const names = seeded.notes.map((note) => note.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
