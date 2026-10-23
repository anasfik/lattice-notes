import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyVault, createNote, purgeNote } from '../domain/vault';
import type { Vault } from '../domain/types';
import {
  archiveStoredVault,
  createSeedVault,
  createStoredVault,
  deleteSnapshot,
  listSnapshots,
  loadBookmarks,
  loadCatalog,
  loadSettings,
  loadVault,
  loadVaultSession,
  openStoredVault,
  purgeStoredNote,
  pruneSnapshots,
  readSnapshot,
  reclaimSnapshotSpace,
  renameStoredVault,
  restoreStoredVault,
  saveBookmarks,
  saveSettings,
  saveVault,
  writeSnapshot,
} from './vaultRepository';
import type { VaultCatalog, VaultMetadata } from './vaultRepository';
import { DEFAULT_SETTINGS } from '../domain/settings';
import type { Bookmark } from '../domain/bookmarks';

const DB_NAME = 'lattice-notes';
const STORE_NAME = 'vault';
const SETTINGS_STORE = 'settings';
const SNAPSHOT_STORE = 'snapshots';
const BOOKMARK_STORE = 'bookmarks';
const DOCUMENT_KEY = 'current';
const CATALOG_KEY = 'catalog';
/** The version of the database the product writes today. */
const DB_VERSION = 3;

/** A bookmark of the note of a vault. */
const BOOKMARK: Bookmark = {
  id: 'note:note-1',
  kind: 'note',
  target: 'note-1',
  title: 'Roadmap',
  group: 'Notes',
};

/** A bookmark of another vault. */
const OTHER_BOOKMARK: Bookmark = {
  id: 'note:note-2',
  kind: 'note',
  target: 'note-2',
  title: 'Atlas',
  group: 'Notes',
};

/** Rejects with a timeout instead of hanging when a promise never settles. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The promise did not settle within ${ms}ms.`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Wraps `db.transaction` so a test can interfere with the transaction the
 * repository creates. Returns a function that restores the original method.
 */
function spyOnTransaction(onTransaction: (transaction: IDBTransaction) => void): () => void {
  const original = IDBDatabase.prototype.transaction;
  const spy = vi.spyOn(IDBDatabase.prototype, 'transaction');
  spy.mockImplementation(function (this: IDBDatabase, ...args: unknown[]) {
    const transaction = (original as unknown as (...rest: unknown[]) => IDBTransaction).apply(this, args);
    onTransaction(transaction);
    return transaction;
  } as unknown as IDBDatabase['transaction']);
  return () => spy.mockRestore();
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Opens the raw database so a test can inspect or replace stored records. */
async function openRawDatabase(version = DB_VERSION): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('raw open failed'));
  });
}

/**
 * Builds a database of the previous version, the way the old product wrote it.
 *
 * The database is opened at version 1 and never touched again, so the next
 * open of the product is the migration from version 1 to version 2.
 */
async function createVersion1Database(document: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('raw open failed'));
  });
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

/**
 * Builds a database of the version before the bookmarks, the way wave 1 wrote
 * it: the stores of the settings and of the snapshots are already there.
 */
async function createVersion2Database(document: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const store = request.result;
      if (!store.objectStoreNames.contains(STORE_NAME)) store.createObjectStore(STORE_NAME);
      if (!store.objectStoreNames.contains(SETTINGS_STORE)) store.createObjectStore(SETTINGS_STORE);
      if (!store.objectStoreNames.contains(SNAPSHOT_STORE)) store.createObjectStore(SNAPSHOT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('raw open failed'));
  });
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

/**
 * The names of the stores of the database, so a test can see the upgrade.
 *
 * The database is opened without a version, so reading the names never
 * triggers the upgrade itself.
 */
async function storeNames(): Promise<string[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('raw open failed'));
  });
  try {
    return Array.from(db.objectStoreNames).sort();
  } finally {
    db.close();
  }
}

/** Reads one raw store record so a test can inspect what was written. */
async function readRawValue(key: string): Promise<unknown> {
  const db = await openRawDatabase();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('raw read failed'));
    });
  } finally {
    db.close();
  }
}

/** Writes one raw store record so a test can plant corrupt or legacy data. */
async function writeRawValue(key: string, value: unknown): Promise<void> {
  const db = await openRawDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('raw write failed'));
      transaction.objectStore(STORE_NAME).put(value, key);
    });
  } finally {
    db.close();
  }
}

/** Every key currently stored, so a test can prove nothing was written. */
async function listRawKeys(): Promise<string[]> {
  const db = await openRawDatabase();
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error ?? new Error('raw key read failed'));
    });
  } finally {
    db.close();
  }
}

/** Reads the raw settings record, without the check of the product. */
async function readRawSettings(): Promise<unknown> {
  const db = await openRawDatabase();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(SETTINGS_STORE, 'readonly').objectStore(SETTINGS_STORE).get('settings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('raw read failed'));
    });
  } finally {
    db.close();
  }
}

/** Writes a raw settings record, including a broken one. */
async function writeRawSettings(value: unknown): Promise<void> {
  const db = await openRawDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SETTINGS_STORE, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('raw write failed'));
      transaction.objectStore(SETTINGS_STORE).put(value, 'settings');
    });
  } finally {
    db.close();
  }
}

/** Writes a raw bookmark record, including a broken one. */
async function writeRawBookmark(key: string, value: unknown): Promise<void> {
  const db = await openRawDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(BOOKMARK_STORE, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('raw write failed'));
      transaction.objectStore(BOOKMARK_STORE).put(value, key);
    });
  } finally {
    db.close();
  }
}

/** A catalog entry that is valid in every respect. */
function catalogEntry(id: string, overrides: Partial<VaultMetadata> = {}): VaultMetadata {
  return { id, name: `Vault ${id}`, createdAt: 1, archivedAt: null, ...overrides };
}

/** The id of a catalog entry, found by its display name. */
function idOf(catalog: VaultCatalog, name: string): string {
  const entry = catalog.vaults.find((vault) => vault.name === name);
  if (!entry) throw new Error(`The catalog has no vault named ${name}.`);
  return entry.id;
}

/** Creates the database at the current version but without the vault store. */
async function createDatabaseWithoutStore(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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
    const request = indexedDB.open(DB_NAME, DB_VERSION + 1);
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
    const document = (await readRawValue(DOCUMENT_KEY)) as { version: number; vault: Vault };

    expect(document.version).toBe(1);
    expect(document.vault).toEqual(vault);
  });

  it('rejects a document with an unknown version', async () => {
    const { vault } = createNote(createEmptyVault(), 'Roadmap');
    await saveVault(vault);
    await writeRawValue(DOCUMENT_KEY, { version: 2, vault });

    await expect(loadVault()).rejects.toThrow(/version/i);
  });

  it('rejects a document whose payload is not a vault', async () => {
    await saveVault(createEmptyVault());
    await writeRawValue(DOCUMENT_KEY, { version: 1, vault: { notes: 'not-an-array', activeNoteId: null } });

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

  it('rejects when the database cannot be opened for writing', async () => {
    await saveVault(createEmptyVault());
    await dropStore();

    await expect(saveVault(createEmptyVault())).rejects.toThrow();
  });

  it('rejects when the write transaction is aborted', async () => {
    const restore = spyOnTransaction((transaction) => {
      if (transaction.mode !== 'readwrite') return;
      const store = transaction.objectStore(STORE_NAME);
      // No request is queued, so the abort is not shadowed by the error event
      // of a request that is still pending.
      store.put = (() => ({ onsuccess: null, onerror: null })) as unknown as IDBObjectStore['put'];
      queueMicrotask(() => transaction.abort());
    });

    try {
      await expect(saveVault(createEmptyVault())).rejects.toThrow(/abort/i);
    } finally {
      restore();
    }
  });

  it('keeps the last saved vault when two saves overlap', async () => {
    const first = createNote(createEmptyVault(), 'First').vault;
    const second = createNote(createEmptyVault(), 'Second').vault;

    await Promise.all([saveVault(first), saveVault(second)]);

    const loaded = await loadVault();
    expect(loaded?.notes[0]?.name).toBe('Second');
  });

  it('seeds a small vault with one selected note', () => {
    const seeded = createSeedVault();

    expect(seeded.notes.length).toBeGreaterThan(1);
    expect(seeded.activeNoteId).toBe(seeded.notes[0]?.id);
    expect(seeded.notes.every((note) => note.deletedAt === null)).toBe(true);

    const names = seeded.notes.map((note) => note.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  // Kept last: while the read never settles, the connection stays open and
  // would block the database deletion that the next test needs.
  it('rejects when the read transaction is aborted', async () => {
    const restore = spyOnTransaction((transaction) => {
      if (transaction.mode !== 'readonly') return;
      const store = transaction.objectStore(STORE_NAME);
      store.get = (() => ({ onsuccess: null, onerror: null })) as unknown as IDBObjectStore['get'];
      queueMicrotask(() => transaction.abort());
    });

    try {
      await expect(withTimeout(loadVault(), 1000)).rejects.toThrow(/abort/i);
    } finally {
      restore();
    }
  });

  it('closes a connection that arrives after a blocked open', async () => {
    const close = vi.fn();
    const fakeRequest: Record<string, unknown> = { result: { close }, error: null };
    vi.stubGlobal('indexedDB', { open: () => fakeRequest } as unknown as IDBFactory);

    const pending = loadVault();
    (fakeRequest.onblocked as () => void)();
    await expect(pending).rejects.toThrow(/another tab/i);

    (fakeRequest.onsuccess as () => void)();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('vault catalog', () => {
  it('resolves null when neither a catalog nor a legacy document exist', async () => {
    await expect(loadCatalog()).resolves.toBeNull();
    await expect(listRawKeys()).resolves.toEqual([]);
  });

  it('adds one catalog entry for a legacy document without touching the legacy record', async () => {
    const { vault, note } = createNote(createEmptyVault(), 'Legacy note', '# Legacy');
    await saveVault(vault);
    const before = await readRawValue(DOCUMENT_KEY);

    const catalog = await loadCatalog();

    expect(catalog).toEqual({
      version: 1,
      activeVaultId: 'current',
      vaults: [{ id: 'current', name: 'My vault', createdAt: expect.any(Number), archivedAt: null }],
    });
    expect(await readRawValue(DOCUMENT_KEY)).toEqual(before);

    const stored = await loadVault();
    expect(stored?.notes[0]?.id).toBe(note.id);
    expect(stored?.notes[0]?.createdAt).toBe(note.createdAt);
    expect(stored?.notes[0]?.body).toBe('# Legacy');
    expect(stored?.activeNoteId).toBe(vault.activeNoteId);
    expect(await loadCatalog()).toEqual(catalog);
  });

  it('returns an existing catalog verbatim even when a legacy document also exists', async () => {
    const existing: VaultCatalog = {
      version: 1,
      activeVaultId: 'other',
      vaults: [{ id: 'other', name: 'Other', createdAt: 42, archivedAt: null }],
    };
    await writeRawValue(CATALOG_KEY, existing);
    await saveVault(createEmptyVault());
    const before = await readRawValue(DOCUMENT_KEY);

    const catalog = await loadCatalog();

    expect(catalog).toEqual(existing);
    expect(await readRawValue(CATALOG_KEY)).toEqual(existing);
    expect(await readRawValue(DOCUMENT_KEY)).toEqual(before);
  });

  it('rejects a corrupt legacy document without writing a catalog', async () => {
    await writeRawValue(DOCUMENT_KEY, { version: 2, vault: createEmptyVault() });
    const before = await readRawValue(DOCUMENT_KEY);

    await expect(loadCatalog()).rejects.toThrow(/version/i);

    expect(await readRawValue(CATALOG_KEY)).toBeUndefined();
    expect(await readRawValue(DOCUMENT_KEY)).toEqual(before);
  });

  it('rejects a corrupt catalog without overwriting it', async () => {
    const corrupt = { version: 2, activeVaultId: 'current', vaults: [] };
    await writeRawValue(CATALOG_KEY, corrupt);

    await expect(loadCatalog()).rejects.toThrow(/version/i);

    expect(await readRawValue(CATALOG_KEY)).toEqual(corrupt);
  });

  it.each([
    [
      'a duplicate id',
      { version: 1, activeVaultId: 'a', vaults: [catalogEntry('a'), catalogEntry('a')] },
    ],
    [
      'an invalid id',
      { version: 1, activeVaultId: 'a', vaults: [catalogEntry('a'), catalogEntry('bad id')] },
    ],
    [
      'an unnormalized name',
      { version: 1, activeVaultId: 'a', vaults: [catalogEntry('a', { name: '  My  vault ' })] },
    ],
    [
      'a nonfinite timestamp',
      {
        version: 1,
        activeVaultId: 'a',
        vaults: [catalogEntry('a', { createdAt: Number.POSITIVE_INFINITY })],
      },
    ],
    [
      'no active member',
      { version: 1, activeVaultId: 'b', vaults: [catalogEntry('a')] },
    ],
    [
      'an archived active member',
      { version: 1, activeVaultId: 'a', vaults: [catalogEntry('a', { archivedAt: 5 })] },
    ],
  ])('rejects a catalog with %s', async (_label, corrupt) => {
    await writeRawValue(CATALOG_KEY, corrupt);

    await expect(loadCatalog()).rejects.toThrow(/catalog/i);

    expect(await readRawValue(CATALOG_KEY)).toEqual(corrupt);
  });
});

describe('stored vaults', () => {
  it('creates a vault with a document, a catalog entry and an active selection', async () => {
    const { vault } = createNote(createEmptyVault(), 'First', '# First');

    const created = await createStoredVault('Work', vault);

    expect(created.vault).toEqual(vault);
    expect(created.catalog.vaults).toHaveLength(1);
    const entry = created.catalog.vaults[0];
    expect(entry?.name).toBe('Work');
    expect(entry?.archivedAt).toBeNull();
    expect(entry?.id).not.toBe('current');
    expect(created.catalog.activeVaultId).toBe(entry?.id);
    expect(await readRawValue(`vault:${entry?.id}`)).toEqual({ version: 1, vault });
    expect(await loadVault(entry?.id ?? '')).toEqual(vault);
    await expect(loadVault('unknown-vault')).resolves.toBeNull();
  });

  it('normalizes the display name and rejects a blank one', async () => {
    const created = await createStoredVault('  My   vault  ', createEmptyVault());
    expect(created.catalog.vaults[0]?.name).toBe('My vault');

    await expect(createStoredVault('   ', createEmptyVault())).rejects.toThrow(/name/i);

    expect(await listRawKeys()).toEqual([CATALOG_KEY, `vault:${created.catalog.vaults[0]?.id}`]);
  });

  it('keeps the contents of two vaults apart', async () => {
    const a = createNote(createEmptyVault(), 'A note', '# A').vault;
    const b = createNote(createEmptyVault(), 'B note', '# B').vault;

    const first = await createStoredVault('A', a);
    const second = await createStoredVault('B', b);
    const idA = idOf(first.catalog, 'A');
    const idB = idOf(second.catalog, 'B');

    expect(await loadVault(idA)).toEqual(a);
    expect(await loadVault(idB)).toEqual(b);
    expect((await loadVault(idA))?.notes[0]?.name).toBe('A note');
    expect((await loadVault(idB))?.notes[0]?.name).toBe('B note');
  });

  it('writes a no-argument save to the legacy document while another vault is selected', async () => {
    const legacy = createNote(createEmptyVault(), 'Legacy', '# Legacy').vault;
    const other = createNote(createEmptyVault(), 'Other', '# Other').vault;
    await saveVault(legacy);
    const created = await createStoredVault('Other', other);
    const idOther = idOf(created.catalog, 'Other');

    await saveVault({ ...legacy, activeNoteId: null });

    expect(await loadVault()).toEqual({ ...legacy, activeNoteId: null });
    expect(await loadVault(idOther)).toEqual(other);
    expect((await loadCatalog())?.activeVaultId).toBe(idOther);
  });

  it('leaves no document and no catalog when the creation transaction is aborted', async () => {
    let aborted = false;
    const restore = spyOnTransaction((transaction) => {
      if (transaction.mode !== 'readwrite') return;
      const store = transaction.objectStore(STORE_NAME);
      const originalPut = store.put.bind(store);
      store.put = ((value: unknown, key: string) => {
        const request = originalPut(value, key);
        if (!aborted) {
          aborted = true;
          queueMicrotask(() => transaction.abort());
        }
        return request;
      }) as unknown as IDBObjectStore['put'];
    });

    try {
      await expect(createStoredVault('Doomed', createEmptyVault())).rejects.toThrow(/abort/i);
    } finally {
      restore();
    }

    expect(await listRawKeys()).toEqual([]);
  });

  it('does not change the selection when the target is missing or corrupt', async () => {
    const a = createNote(createEmptyVault(), 'A').vault;
    const b = createNote(createEmptyVault(), 'B').vault;
    const first = await createStoredVault('A', a);
    const second = await createStoredVault('B', b);
    const idA = idOf(first.catalog, 'A');
    const activeId = second.catalog.activeVaultId;

    await expect(openStoredVault('missing-vault')).rejects.toThrow(/does not exist/i);
    expect((await loadCatalog())?.activeVaultId).toBe(activeId);

    await writeRawValue(`vault:${idA}`, { version: 9, vault: a });
    await expect(openStoredVault(idA)).rejects.toThrow(/version/i);
    expect((await loadCatalog())?.activeVaultId).toBe(activeId);
  });

  it('opens a vault and persists the selection', async () => {
    const a = createNote(createEmptyVault(), 'A', '# A').vault;
    const b = createNote(createEmptyVault(), 'B', '# B').vault;
    const first = await createStoredVault('A', a);
    await createStoredVault('B', b);
    const idA = idOf(first.catalog, 'A');

    const opened = await openStoredVault(idA);

    expect(opened.vault).toEqual(a);
    expect(opened.catalog.activeVaultId).toBe(idA);
    expect((await loadCatalog())?.activeVaultId).toBe(idA);
  });

  it('refuses to archive the active vault and gives a reason', async () => {
    const created = await createStoredVault('A', createEmptyVault());
    const id = created.catalog.activeVaultId;

    await expect(archiveStoredVault(id)).rejects.toThrow(/active/i);

    expect((await loadCatalog())?.vaults[0]?.archivedAt).toBeNull();
  });

  it('archives and restores a vault without touching note bodies', async () => {
    const a = createNote(createEmptyVault(), 'A', '# A body').vault;
    const b = createNote(createEmptyVault(), 'B', '# B body').vault;
    await createStoredVault('A', a);
    const created = await createStoredVault('B', b);
    const idA = idOf(created.catalog, 'A');

    const archived = await archiveStoredVault(idA);

    expect(archived.vaults.find((vault) => vault.id === idA)?.archivedAt).toEqual(expect.any(Number));
    expect(archived.activeVaultId).toBe(created.catalog.activeVaultId);
    expect((await loadVault(idA))?.notes[0]?.body).toBe('# A body');
    await expect(openStoredVault(idA)).rejects.toThrow(/archived/i);

    const restored = await restoreStoredVault(idA);

    expect(restored.vaults.find((vault) => vault.id === idA)?.archivedAt).toBeNull();
    expect((await loadVault(idA))?.notes[0]?.body).toBe('# A body');

    const archivedAgain = await archiveStoredVault(idA);
    expect(archivedAgain.vaults.find((vault) => vault.id === idA)?.archivedAt).toEqual(expect.any(Number));
  });

  it('renames a vault without touching note bodies', async () => {
    const created = await createStoredVault('Old name', createNote(createEmptyVault(), 'A', '# A body').vault);
    const id = created.catalog.activeVaultId;

    const renamed = await renameStoredVault(id, '  New   name  ');

    expect(renamed.vaults[0]?.name).toBe('New name');
    expect((await loadVault(id))?.notes[0]?.body).toBe('# A body');
    await expect(renameStoredVault(id, '   ')).rejects.toThrow(/name/i);
  });

  it('keeps both vaults when two creations overlap', async () => {
    const a = createNote(createEmptyVault(), 'A note', '# A').vault;
    const b = createNote(createEmptyVault(), 'B note', '# B').vault;

    const [first, second] = await Promise.all([createStoredVault('A', a), createStoredVault('B', b)]);
    const catalog = await loadCatalog();

    expect(catalog?.vaults.map((vault) => vault.name).sort()).toEqual(['A', 'B']);
    expect([first.catalog.activeVaultId, second.catalog.activeVaultId]).toContain(catalog?.activeVaultId);
    expect(await loadVault(idOf(catalog as VaultCatalog, 'A'))).toEqual(a);
    expect(await loadVault(idOf(catalog as VaultCatalog, 'B'))).toEqual(b);
  });

  it('keeps unrelated entries when two renames overlap', async () => {
    await createStoredVault('A', createEmptyVault());
    await createStoredVault('B', createEmptyVault());
    const created = await createStoredVault('C', createEmptyVault());
    const idA = idOf(created.catalog, 'A');
    const idB = idOf(created.catalog, 'B');

    await Promise.all([renameStoredVault(idA, 'A2'), renameStoredVault(idB, 'B2')]);

    const catalog = await loadCatalog();
    expect(catalog?.vaults.map((vault) => vault.name).sort()).toEqual(['A2', 'B2', 'C']);
  });

  it('keeps the legacy vault as a catalog member when a new vault is created', async () => {
    const { vault, note } = createNote(createEmptyVault(), 'Legacy note', '# Legacy');
    await saveVault(vault);
    const before = await readRawValue(DOCUMENT_KEY);

    const created = await createStoredVault('Work', createEmptyVault());

    expect(created.catalog.vaults.map((entry) => entry.id)).toContain('current');
    expect(created.catalog.vaults.find((entry) => entry.id === 'current')?.name).toBe('My vault');
    expect(created.catalog.activeVaultId).not.toBe('current');
    expect(await readRawValue(DOCUMENT_KEY)).toEqual(before);
    const legacy = await loadVault();
    expect(legacy?.notes[0]?.id).toBe(note.id);
    expect(legacy?.notes[0]?.body).toBe('# Legacy');
  });

  it('opens the legacy vault after the catalog migration', async () => {
    const { vault, note } = createNote(createEmptyVault(), 'Legacy note', '# Legacy');
    await saveVault(vault);

    const catalog = await loadCatalog();
    expect(catalog?.activeVaultId).toBe('current');

    const opened = await openStoredVault('current');

    expect(opened.vault.notes[0]?.id).toBe(note.id);
    expect(opened.vault.notes[0]?.body).toBe('# Legacy');
    expect(opened.catalog.activeVaultId).toBe('current');
    expect(opened.catalog.vaults).toHaveLength(1);
  });

  it('refuses to create a vault while the legacy document is unreadable', async () => {
    await writeRawValue(DOCUMENT_KEY, { version: 2, vault: createEmptyVault() });
    const before = await readRawValue(DOCUMENT_KEY);

    await expect(createStoredVault('Work', createEmptyVault())).rejects.toThrow(/version/i);

    expect(await readRawValue(CATALOG_KEY)).toBeUndefined();
    expect(await readRawValue(DOCUMENT_KEY)).toEqual(before);
  });

  it('rejects ids that cannot address a store key', async () => {
    await expect(openStoredVault('')).rejects.toThrow(/id/i);
    await expect(openStoredVault('bad id')).rejects.toThrow(/id/i);
    await expect(openStoredVault('vault:injected')).rejects.toThrow(/id/i);
    await expect(renameStoredVault('', 'name')).rejects.toThrow(/id/i);
    await expect(saveVault(createEmptyVault(), 'bad:id')).rejects.toThrow(/id/i);
    await expect(loadVault('bad:id')).rejects.toThrow(/id/i);
  });
});

describe('vault tab sessions', () => {
  const SESSION_KEY = 'session:current';

  it('resolves null when the vault has no session', async () => {
    await expect(loadVaultSession('current')).resolves.toBeNull();
  });

  it('round-trips a session with the vault it belongs to', async () => {
    const { vault, note } = createNote(createEmptyVault(), 'Roadmap');

    await saveVault(vault, 'current', { version: 1, openNoteIds: [note.id] });

    await expect(loadVaultSession('current')).resolves.toEqual({
      version: 1,
      openNoteIds: [note.id],
    });
    // The content of the vault is written in the same write.
    expect((await loadVault('current'))?.notes[0]?.name).toBe('Roadmap');
  });

  it('keeps the session of one vault apart from the session of another', async () => {
    const { vault: first, note: firstNote } = createNote(createEmptyVault(), 'First');
    const created = await createStoredVault('Second', createEmptyVault());
    const second = created.catalog.activeVaultId;

    await saveVault(first, 'current', { version: 1, openNoteIds: [firstNote.id] });
    await saveVault(createEmptyVault(), second, { version: 1, openNoteIds: ['other-id'] });

    await expect(loadVaultSession('current')).resolves.toEqual({
      version: 1,
      openNoteIds: [firstNote.id],
    });
    await expect(loadVaultSession(second)).resolves.toEqual({
      version: 1,
      openNoteIds: ['other-id'],
    });
  });

  it('rejects a session that is not a versioned list of ids', async () => {
    await writeRawValue(SESSION_KEY, { version: 1, openNoteIds: [7] });
    await expect(loadVaultSession('current')).rejects.toThrow(/session/i);

    await writeRawValue(SESSION_KEY, { version: 2, openNoteIds: [] });
    await expect(loadVaultSession('current')).rejects.toThrow(/session/i);

    await writeRawValue(SESSION_KEY, { version: 1, openNoteIds: 'not-a-list' });
    await expect(loadVaultSession('current')).rejects.toThrow(/session/i);

    await writeRawValue(SESSION_KEY, 'not-an-object');
    await expect(loadVaultSession('current')).rejects.toThrow(/session/i);
  });

  it('rejects an id that cannot address a session key', async () => {
    await expect(loadVaultSession('')).rejects.toThrow(/id/i);
    await expect(loadVaultSession('bad id')).rejects.toThrow(/id/i);
    await expect(loadVaultSession('vault:injected')).rejects.toThrow(/id/i);
  });

  it('writes neither the vault nor the session when the write transaction is aborted', async () => {
    const restore = spyOnTransaction((transaction) => {
      if (transaction.mode !== 'readwrite') return;
      const store = transaction.objectStore(STORE_NAME);
      // No request is queued, so the abort is not shadowed by the error event
      // of a request that is still pending.
      store.put = (() => ({ onsuccess: null, onerror: null })) as unknown as IDBObjectStore['put'];
      queueMicrotask(() => transaction.abort());
    });

    try {
      await expect(
        saveVault(createEmptyVault(), 'current', { version: 1, openNoteIds: ['a'] }),
      ).rejects.toThrow(/abort/i);
    } finally {
      restore();
    }

    expect(await listRawKeys()).toEqual([]);
  });

  it('rejects a malformed session without writing the vault', async () => {
    await expect(
      saveVault(createEmptyVault(), 'current', { version: 2, openNoteIds: [] } as never),
    ).rejects.toThrow(/session/i);

    expect(await listRawKeys()).toEqual([]);
  });

  it('keeps the content only save unchanged', async () => {
    const { vault } = createNote(createEmptyVault(), 'Roadmap');

    await saveVault(vault);

    expect(await readRawValue(DOCUMENT_KEY)).toEqual({ version: 1, vault });
    expect(await listRawKeys()).toEqual([DOCUMENT_KEY]);
    await expect(loadVaultSession('current')).resolves.toBeNull();
  });
});

describe('the settings', () => {
  it('returns the defaults when nothing was stored', async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the settings across a reopen', async () => {
    const settings = { ...DEFAULT_SETTINGS, confirmDelete: true, snapshotIntervalMinutes: 10 };

    await saveSettings(settings);

    await expect(loadSettings()).resolves.toEqual(settings);
  });

  it('stores the settings in their normalized form', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, snapshotIntervalMinutes: 900, theme: 'pink' } as never);

    expect(await readRawSettings()).toMatchObject({
      snapshotIntervalMinutes: 60,
      theme: DEFAULT_SETTINGS.theme,
    });
  });

  it('falls back to the defaults for a broken record and leaves the vault alone', async () => {
    const { vault } = createNote(createEmptyVault(), 'Roadmap');
    await saveVault(vault);
    const before = await readRawValue(DOCUMENT_KEY);
    await writeRawSettings('not-an-object');

    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);

    expect(await readRawValue(DOCUMENT_KEY)).toEqual(before);
  });

  it('does not write anything when the settings are read', async () => {
    await saveVault(createEmptyVault());

    await loadSettings();

    expect(await listRawKeys()).toEqual([DOCUMENT_KEY]);
  });
});

describe('the snapshots of a note', () => {
  it('lists, reads and deletes a snapshot', async () => {
    await writeSnapshot('current', 'note-1', 'the old body');

    const list = await listSnapshots('current', 'note-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.body).toBe('the old body');
    expect(list[0]?.vaultId).toBe('current');
    expect(list[0]?.noteId).toBe('note-1');

    const read = await readSnapshot(list[0]?.key ?? '');
    expect(read?.body).toBe('the old body');

    await deleteSnapshot(list[0]?.key ?? '');

    await expect(listSnapshots('current', 'note-1')).resolves.toEqual([]);
    await expect(readSnapshot(list[0]?.key ?? '')).resolves.toBeNull();
  });

  it('keeps the snapshots of one note apart from the snapshots of another', async () => {
    await writeSnapshot('current', 'note-1', 'one');
    await writeSnapshot('current', 'note-2', 'two');

    const list = await listSnapshots('current', 'note-1');

    expect(list).toHaveLength(1);
    expect(list[0]?.body).toBe('one');
  });

  it('keeps the snapshots of one vault apart from the snapshots of another', async () => {
    await writeSnapshot('current', 'note-1', 'legacy body');
    await writeSnapshot('other-vault', 'note-1', 'other body');

    const list = await listSnapshots('other-vault', 'note-1');

    expect(list).toHaveLength(1);
    expect(list[0]?.body).toBe('other body');
  });

  it('lists the newest snapshot first', async () => {
    await writeSnapshot('current', 'note-1', 'first');
    await writeSnapshot('current', 'note-1', 'second');

    const list = await listSnapshots('current', 'note-1');

    expect(list.map((snapshot) => snapshot.body)).toEqual(['second', 'first']);
  });

  it('prunes the snapshots that are older than the cutoff', async () => {
    await writeSnapshot('current', 'note-1', 'old body');
    await writeSnapshot('current', 'note-2', 'other body');

    const pruned = await pruneSnapshots('current', Date.now() + 1000);

    expect(pruned).toBe(2);
    await expect(listSnapshots('current', 'note-1')).resolves.toEqual([]);
    await expect(listSnapshots('current', 'note-2')).resolves.toEqual([]);
  });

  it('keeps the snapshots that are inside the window and those of another vault', async () => {
    await writeSnapshot('current', 'note-1', 'kept body');
    await writeSnapshot('other-vault', 'note-1', 'other body');

    const pruned = await pruneSnapshots('current', 0);

    expect(pruned).toBe(0);
    await expect(listSnapshots('current', 'note-1')).resolves.toHaveLength(1);
    await expect(listSnapshots('other-vault', 'note-1')).resolves.toHaveLength(1);
  });

  it('refuses a snapshot that does not belong to a vault and a note', async () => {
    await expect(writeSnapshot('', 'note-1', 'body')).rejects.toThrow(/id/i);
    await expect(writeSnapshot('bad id', 'note-1', 'body')).rejects.toThrow(/id/i);
    await expect(writeSnapshot('current', '', 'body')).rejects.toThrow(/note id/i);
    await expect(listSnapshots('current', '')).rejects.toThrow(/note id/i);
    await expect(readSnapshot('')).rejects.toThrow(/key/i);
    await expect(deleteSnapshot('')).rejects.toThrow(/key/i);
  });
});

describe('the migration to version 2', () => {
  it('upgrades a version 1 database and keeps the vault document', async () => {
    const { vault, note } = createNote(createEmptyVault(), 'Legacy note', '# Legacy');
    await createVersion1Database({ version: 1, vault });
    expect(await storeNames()).toEqual([STORE_NAME]);

    const loaded = await loadVault();

    expect(loaded?.notes[0]?.id).toBe(note.id);
    expect(loaded?.notes[0]?.body).toBe('# Legacy');
    // The old record is not rewritten, it only gains the new stores.
    expect(await readRawValue(DOCUMENT_KEY)).toEqual({ version: 1, vault });
    expect(await storeNames()).toEqual([
      BOOKMARK_STORE,
      SETTINGS_STORE,
      SNAPSHOT_STORE,
      STORE_NAME,
    ]);
  });

  it('keeps the catalog of a version 1 database after the upgrade', async () => {
    const { vault } = createNote(createEmptyVault(), 'Legacy note');
    await createVersion1Database({ version: 1, vault });

    const catalog = await loadCatalog();

    expect(catalog?.activeVaultId).toBe('current');
    expect(catalog?.vaults[0]?.name).toBe('My vault');
  });

  it('serves the settings and the snapshots of the upgraded database', async () => {
    const { vault } = createNote(createEmptyVault(), 'Legacy note');
    await createVersion1Database({ version: 1, vault });

    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    await writeSnapshot('current', 'note-1', 'body');
    await expect(listSnapshots('current', 'note-1')).resolves.toHaveLength(1);
  });

  it('says when an old tab blocks the upgrade and opens once it lets go', async () => {
    const { vault } = createNote(createEmptyVault(), 'Legacy note');
    await createVersion1Database({ version: 1, vault });
    // A tab that was never upgraded holds the old version open.
    const held = await openRawVersion(1);

    await expect(withTimeout(saveVault(vault, 'current'), 500)).rejects.toThrow(/another tab/);
    held.close();
    // After the old tab lets go, the same open succeeds and the migration runs.
    await saveVault(vault, 'current');
    expect((await loadVault())?.notes[0]?.name).toBe('Legacy note');
  });
});

describe('the migration to version 3', () => {
  it('upgrades a version 2 database and keeps the vault document', async () => {
    const { vault, note } = createNote(createEmptyVault(), 'Legacy note', '# Legacy');
    await createVersion2Database({ version: 1, vault });
    expect(await storeNames()).toEqual([SETTINGS_STORE, SNAPSHOT_STORE, STORE_NAME]);

    const loaded = await loadVault();

    expect(loaded?.notes[0]?.id).toBe(note.id);
    expect(loaded?.notes[0]?.body).toBe('# Legacy');
    // The old record is not rewritten, it only gains the store of the bookmarks.
    expect(await readRawValue(DOCUMENT_KEY)).toEqual({ version: 1, vault });
    expect(await storeNames()).toEqual([
      BOOKMARK_STORE,
      SETTINGS_STORE,
      SNAPSHOT_STORE,
      STORE_NAME,
    ]);
  });

  it('keeps the settings and the snapshots of a version 2 database', async () => {
    const { vault } = createNote(createEmptyVault(), 'Legacy note');
    await createVersion2Database({ version: 1, vault });
    await saveSettings({ ...DEFAULT_SETTINGS, spellcheck: false });
    await writeSnapshot('current', 'note-1', 'the kept body');

    await expect(loadSettings()).resolves.toMatchObject({ spellcheck: false });
    await expect(listSnapshots('current', 'note-1')).resolves.toHaveLength(1);
  });

  it('serves the bookmarks of the upgraded database', async () => {
    const { vault } = createNote(createEmptyVault(), 'Legacy note');
    await createVersion2Database({ version: 1, vault });

    await saveBookmarks('current', [BOOKMARK]);

    await expect(loadBookmarks('current')).resolves.toMatchObject({ bookmarks: [BOOKMARK] });
  });
});

describe('the bookmarks of a vault', () => {
  it('keeps the bookmarks of a vault across a reopen', async () => {
    await saveBookmarks('current', [BOOKMARK]);

    const read = await loadBookmarks('current');

    expect(read.bookmarks).toEqual([BOOKMARK]);
    expect(read.dropped).toBe(0);
  });

  it('keeps the bookmarks of one vault apart from the bookmarks of another', async () => {
    await saveBookmarks('current', [BOOKMARK]);
    await saveBookmarks('other-vault', [OTHER_BOOKMARK]);

    await expect(loadBookmarks('current')).resolves.toMatchObject({ bookmarks: [BOOKMARK] });
    await expect(loadBookmarks('other-vault')).resolves.toMatchObject({
      bookmarks: [OTHER_BOOKMARK],
    });
  });

  it('replaces the bookmarks of a vault when they are saved again', async () => {
    await saveBookmarks('current', [BOOKMARK]);

    await saveBookmarks('current', []);

    await expect(loadBookmarks('current')).resolves.toMatchObject({ bookmarks: [] });
  });

  it('drops a corrupt bookmark record and keeps the rest', async () => {
    await saveBookmarks('current', [BOOKMARK]);
    await writeRawBookmark('broken', { id: 'broken', vaultId: 'current', kind: 'note' });

    const read = await loadBookmarks('current');

    expect(read.bookmarks).toEqual([BOOKMARK]);
    expect(read.dropped).toBe(1);
  });

  it('does not count the broken records of another vault', async () => {
    await saveBookmarks('current', [BOOKMARK]);
    await writeRawBookmark('broken-other', { id: 'other', vaultId: 'other-vault', kind: 'note' });

    const read = await loadBookmarks('current');

    // A record that belongs to another vault is not the business of this one.
    expect(read.bookmarks).toEqual([BOOKMARK]);
    expect(read.dropped).toBe(0);
  });

  it('refuses a vault id that cannot address a bookmark', async () => {
    await expect(loadBookmarks('')).rejects.toThrow(/id/i);
    await expect(loadBookmarks('bad id')).rejects.toThrow(/id/i);
    await expect(saveBookmarks('bad id', [BOOKMARK])).rejects.toThrow(/id/i);
  });
});

/** Opens the app database at one version and keeps the connection. */
function openRawVersion(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('raw open failed'));
  });
}

describe('the budget of the vault history', () => {
  /** Lets the next write get a later moment than the one before it. */
  async function tick(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 3));
  }

  it('evicts the oldest bodies of the vault until the new one fits', async () => {
    await writeSnapshot('other-vault', 'note-1', 'outside the budget');
    await writeSnapshot('current', 'note-1', 'one', { budget: 12 });
    await tick();
    await writeSnapshot('current', 'note-2', 'two', { budget: 12 });
    await tick();
    await writeSnapshot('current', 'note-3', 'three', { budget: 12 });
    await tick();
    // 3 + 3 + 5 bytes are kept; the next 4 bytes would break the budget, so
    // the oldest body of the vault goes first.
    await writeSnapshot('current', 'note-4', 'four', { budget: 12 });

    await expect(listSnapshots('current', 'note-1')).resolves.toEqual([]);
    await expect(listSnapshots('current', 'note-2')).resolves.toHaveLength(1);
    await expect(listSnapshots('current', 'note-3')).resolves.toHaveLength(1);
    await expect(listSnapshots('current', 'note-4')).resolves.toHaveLength(1);
    // The history of another vault is never spent for this one.
    await expect(listSnapshots('other-vault', 'note-1')).resolves.toHaveLength(1);
  });

  it('refuses a body larger than the budget and writes nothing', async () => {
    await writeSnapshot('current', 'note-1', 'small', { budget: 10 });

    await expect(
      writeSnapshot('current', 'note-2', 'a'.repeat(11), { budget: 10 }),
    ).rejects.toThrow(/budget/);

    await expect(listSnapshots('current', 'note-1')).resolves.toHaveLength(1);
    await expect(listSnapshots('current', 'note-2')).resolves.toEqual([]);
  });

  it('clears the oldest bodies first when the space is reclaimed', async () => {
    await writeSnapshot('current', 'note-1', 'x'.repeat(300));
    await tick();
    await writeSnapshot('current', 'note-2', 'x'.repeat(300));
    await tick();
    await writeSnapshot('other-vault', 'note-1', 'kept');

    const freed = await reclaimSnapshotSpace('current', 350);

    expect(freed).toBe(300);
    await expect(listSnapshots('current', 'note-1')).resolves.toEqual([]);
    await expect(listSnapshots('current', 'note-2')).resolves.toHaveLength(1);
    await expect(listSnapshots('other-vault', 'note-1')).resolves.toHaveLength(1);
  });
});

describe('purging a note', () => {
  it('removes the note, its tab entry and its history in one write', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'body a');
    const second = createNote(first.vault, 'Beta', 'body b');
    const purged = purgeNote(second.vault, second.note.id).vault;
    await saveVault({ ...second.vault, activeNoteId: second.note.id }, 'v-key', {
      version: 1,
      openNoteIds: [first.note.id, second.note.id],
    });
    await writeSnapshot('v-key', first.note.id, 'alpha, kept');
    await writeSnapshot('v-key', second.note.id, 'beta, kept');

    await purgeStoredNote('v-key', purged, second.note.id, {
      version: 1,
      openNoteIds: [first.note.id],
    });

    const stored = await loadVault('v-key');
    expect(stored?.notes.map((note) => note.id)).toEqual([first.note.id]);
    await expect(loadVaultSession('v-key')).resolves.toEqual({
      version: 1,
      openNoteIds: [first.note.id],
    });
    await expect(listSnapshots('v-key', second.note.id)).resolves.toEqual([]);
    // The history of the survivor stays.
    await expect(listSnapshots('v-key', first.note.id)).resolves.toHaveLength(1);
  });
});
