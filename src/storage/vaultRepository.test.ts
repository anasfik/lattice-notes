import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyVault, createNote } from '../domain/vault';
import type { Vault } from '../domain/types';
import {
  archiveStoredVault,
  createSeedVault,
  createStoredVault,
  loadCatalog,
  loadVault,
  openStoredVault,
  renameStoredVault,
  restoreStoredVault,
  saveVault,
} from './vaultRepository';
import type { VaultCatalog, VaultMetadata } from './vaultRepository';

const DB_NAME = 'lattice-notes';
const STORE_NAME = 'vault';
const DOCUMENT_KEY = 'current';
const CATALOG_KEY = 'catalog';

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
async function openRawDatabase(version = 1): Promise<IDBDatabase> {
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
