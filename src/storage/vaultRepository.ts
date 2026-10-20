/**
 * Local persistence for vault documents and the vault catalog.
 *
 * The app keeps one versioned document per vault in IndexedDB plus a catalog
 * of vault metadata. The public API stays small on purpose: `loadVault`
 * resolves null only when storage is readable and genuinely empty, and every
 * function rejects on storage or validation errors so the app can fall back
 * to memory and warn the user instead of losing work.
 *
 * Keys: the legacy document keeps `current`, every other vault is stored
 * under `vault:<id>` and the catalog under `catalog`. The legacy document is
 * only ever touched by an explicit read or write of that key, never through
 * the catalog selection.
 */

import { createEmptyVault, createNote, normalizeNoteName } from '../domain/vault';
import type { Note, Vault } from '../domain/types';

const DB_NAME = 'lattice-notes';
const DB_VERSION = 1;
const STORE_NAME = 'vault';
const DOCUMENT_KEY = 'current';
const CATALOG_KEY = 'catalog';
const DOCUMENT_VERSION = 1;
const CATALOG_VERSION = 1;
/** The legacy document keeps the reserved id and its own key. */
const LEGACY_VAULT_ID = 'current';
const LEGACY_VAULT_NAME = 'My vault';
/** Ids become store keys, so they stay plain and never carry a separator. */
const VAULT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface VaultMetadata {
  id: string;
  name: string;
  createdAt: number;
  archivedAt: number | null;
}

export interface VaultCatalog {
  version: 1;
  activeVaultId: string;
  vaults: VaultMetadata[];
}

interface VaultDocument {
  version: number;
  vault: Vault;
}

/**
 * Reads the stored vault.
 *
 * The legacy document is read by default; every other id is stored under
 * `vault:<id>`. Resolves `null` when storage is readable and holds no
 * document, resolves the vault when the document is current, and rejects on
 * any storage or document error.
 */
export async function loadVault(id: string = LEGACY_VAULT_ID): Promise<Vault | null> {
  assertVaultId(id);
  const db = await openDatabase();
  try {
    const document = await readDocument(db, documentKey(id));
    if (document === undefined || document === null) return null;
    return readVault(document);
  } finally {
    db.close();
  }
}

/**
 * Writes the vault as a versioned document.
 *
 * The legacy document is written by default, whatever the catalog selection
 * says. Rejects when the write fails.
 */
export async function saveVault(vault: Vault, id: string = LEGACY_VAULT_ID): Promise<void> {
  assertVaultId(id);
  const db = await openDatabase();
  try {
    await writeDocument(db, { version: DOCUMENT_VERSION, vault }, documentKey(id));
  } finally {
    db.close();
  }
}

/**
 * Reads the vault catalog.
 *
 * Resolves `null` only when neither the catalog nor the legacy document
 * exist. A readable legacy document without a catalog gains one metadata
 * entry; the legacy document itself is never rewritten, copied or moved.
 * Corrupt data rejects instead of being repaired.
 */
export async function loadCatalog(): Promise<VaultCatalog | null> {
  const db = await openDatabase();
  try {
    const records = await readRecords(db, [CATALOG_KEY, DOCUMENT_KEY]);
    const stored = records.get(CATALOG_KEY);
    if (stored !== undefined && stored !== null) return parseCatalog(stored);

    const legacy = records.get(DOCUMENT_KEY);
    if (legacy === undefined || legacy === null) return null;
    readVault(legacy); // a corrupt legacy document is an error, never a fresh start
    return await migrateLegacyCatalog(db);
  } finally {
    db.close();
  }
}

/**
 * Stores a new vault.
 *
 * The document, the catalog entry and the active selection are written in one
 * transaction, so a failure leaves no partial vault behind.
 *
 * The catalog is not seeded or migrated here: a legacy document becomes a
 * catalog member only through {@link loadCatalog}, so callers must call that
 * first or the user's original vault stays outside the catalog.
 */
export async function createStoredVault(
  name: string,
  vault: Vault,
): Promise<{ catalog: VaultCatalog; vault: Vault }> {
  const displayName = normalizeVaultName(name);
  if (!isVault(vault)) throw new Error('The vault document is unreadable.');
  const db = await openDatabase();
  try {
    const id = newVaultId();
    const entry: VaultMetadata = { id, name: displayName, createdAt: Date.now(), archivedAt: null };
    return await commitCatalog(db, [], ({ catalog }) => {
      if (catalog?.vaults.some((vault) => vault.id === id)) {
        throw new Error(`A vault with the id "${id}" already exists.`);
      }
      const vaults = [...(catalog?.vaults ?? []), entry];
      const next: VaultCatalog = { version: CATALOG_VERSION, activeVaultId: id, vaults };
      return {
        catalog: next,
        documents: [{ key: documentKey(id), vault }],
        result: { catalog: next, vault },
      };
    });
  } finally {
    db.close();
  }
}

/**
 * Opens a stored vault and persists the selection.
 *
 * The target is checked inside the transaction, so a missing, unreadable or
 * archived vault leaves the current selection untouched.
 */
export async function openStoredVault(id: string): Promise<{ catalog: VaultCatalog; vault: Vault }> {
  assertVaultId(id);
  const db = await openDatabase();
  try {
    const key = documentKey(id);
    return await commitCatalog(db, [key], ({ catalog, documents }) => {
      const member = catalog?.vaults.find((vault) => vault.id === id);
      if (!catalog || !member) throw new Error(`The vault "${id}" does not exist.`);
      if (member.archivedAt !== null) {
        throw new Error(`The vault "${member.name}" is archived. Restore it before opening it.`);
      }
      const vault = documents.get(key);
      if (!vault) throw new Error(`The vault "${member.name}" has no stored document.`);

      const next: VaultCatalog = { ...catalog, activeVaultId: id };
      return { catalog: next, documents: [], result: { catalog: next, vault } };
    });
  } finally {
    db.close();
  }
}

/** Renames a vault. Only the catalog changes, the document stays untouched. */
export async function renameStoredVault(id: string, name: string): Promise<VaultCatalog> {
  assertVaultId(id);
  const displayName = normalizeVaultName(name);
  const db = await openDatabase();
  try {
    return await commitCatalog(db, [], ({ catalog }) => {
      const member = catalog?.vaults.find((vault) => vault.id === id);
      if (!catalog || !member) throw new Error(`The vault "${id}" does not exist.`);

      const vaults = catalog.vaults.map((vault) =>
        vault.id === id ? { ...vault, name: displayName } : vault,
      );
      const next: VaultCatalog = { ...catalog, vaults };
      return { catalog: next, documents: [], result: next };
    });
  } finally {
    db.close();
  }
}

/**
 * Archives a vault.
 *
 * Archiving is reversible and only changes the catalog. The active vault
 * cannot be archived while it is the active one.
 */
export async function archiveStoredVault(id: string): Promise<VaultCatalog> {
  assertVaultId(id);
  const db = await openDatabase();
  try {
    return await commitCatalog(db, [], ({ catalog }) => {
      const member = catalog?.vaults.find((vault) => vault.id === id);
      if (!catalog || !member) throw new Error(`The vault "${id}" does not exist.`);
      if (member.id === catalog.activeVaultId) {
        throw new Error('The active vault cannot be archived. Open another vault first.');
      }
      if (member.archivedAt !== null) {
        throw new Error(`The vault "${member.name}" is already archived.`);
      }

      const vaults = catalog.vaults.map((vault) =>
        vault.id === id ? { ...vault, archivedAt: Date.now() } : vault,
      );
      const next: VaultCatalog = { ...catalog, vaults };
      return { catalog: next, documents: [], result: next };
    });
  } finally {
    db.close();
  }
}

/** Restores an archived vault. Only the catalog changes. */
export async function restoreStoredVault(id: string): Promise<VaultCatalog> {
  assertVaultId(id);
  const db = await openDatabase();
  try {
    return await commitCatalog(db, [], ({ catalog }) => {
      const member = catalog?.vaults.find((vault) => vault.id === id);
      if (!catalog || !member) throw new Error(`The vault "${id}" does not exist.`);
      if (member.archivedAt === null) {
        throw new Error(`The vault "${member.name}" is not archived.`);
      }

      const vaults = catalog.vaults.map((vault) =>
        vault.id === id ? { ...vault, archivedAt: null } : vault,
      );
      const next: VaultCatalog = { ...catalog, vaults };
      return { catalog: next, documents: [], result: next };
    });
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

/** The state one catalog transaction starts from. */
interface CatalogState {
  /** The stored catalog, or null when there is none yet. */
  catalog: VaultCatalog | null;
  /** The extra documents read in the same transaction, keyed by store key. */
  documents: ReadonlyMap<string, Vault | null>;
}

/** What one catalog transaction commits. */
interface CatalogCommit<T> {
  catalog: VaultCatalog;
  /** Documents stored in the same transaction as the catalog. */
  documents: ReadonlyArray<{ key: string; vault: Vault }>;
  result: T;
}

/**
 * Applies one catalog change inside a single readwrite transaction.
 *
 * The catalog is read, changed and written in the same transaction, so
 * overlapping operations never lose entries. A rejected change aborts the
 * transaction, so nothing is written at all.
 */
function commitCatalog<T>(
  db: IDBDatabase,
  extraKeys: readonly string[],
  change: (state: CatalogState) => CatalogCommit<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const records = new Map<string, unknown>();
    let result: T | undefined;
    let failure: Error | null = null;

    const fail = (error: Error) => {
      failure = error;
      try {
        transaction.abort();
      } catch {
        // The transaction is already ending.
      }
      reject(error);
    };

    transaction.oncomplete = () => resolve(result as T);
    transaction.onerror = (event) =>
      reject(failure ?? requestError(event) ?? new Error('The local vault catalog could not be written.'));
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error('The local vault catalog write was aborted.'));

    let pending = extraKeys.length + 1;
    const ready = () => {
      pending -= 1;
      if (pending > 0) return;
      try {
        const stored = records.get(CATALOG_KEY);
        const documents = new Map<string, Vault | null>();
        for (const key of extraKeys) {
          const document = records.get(key);
          documents.set(key, document === undefined ? null : readVault(document));
        }

        const commit = change({
          catalog: stored === undefined || stored === null ? null : parseCatalog(stored),
          documents,
        });
        result = commit.result;
        store.put(commit.catalog, CATALOG_KEY);
        for (const document of commit.documents) {
          store.put({ version: DOCUMENT_VERSION, vault: document.vault }, document.key);
        }
      } catch (error) {
        fail(asError(error, 'The local vault catalog could not be written.'));
      }
    };

    for (const key of [CATALOG_KEY, ...extraKeys]) {
      const request = store.get(key);
      request.onsuccess = () => {
        records.set(key, request.result);
        ready();
      };
    }
  });
}

/**
 * Adds the metadata-only catalog entry for a readable legacy document.
 *
 * The legacy document keeps its own key and its own content; only the
 * catalog is written. When another writer migrated first, their catalog
 * stays and nothing is written.
 */
function migrateLegacyCatalog(db: IDBDatabase): Promise<VaultCatalog> {
  return new Promise<VaultCatalog>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let result: VaultCatalog | undefined;
    let failure: Error | null = null;

    transaction.oncomplete = () => resolve(result as VaultCatalog);
    transaction.onerror = (event) =>
      reject(failure ?? requestError(event) ?? new Error('The local vault catalog could not be written.'));
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error('The local vault catalog write was aborted.'));

    const request = store.get(CATALOG_KEY);
    request.onsuccess = () => {
      try {
        if (request.result !== undefined && request.result !== null) {
          result = parseCatalog(request.result);
          return;
        }
        const catalog: VaultCatalog = {
          version: CATALOG_VERSION,
          activeVaultId: LEGACY_VAULT_ID,
          vaults: [
            {
              id: LEGACY_VAULT_ID,
              name: LEGACY_VAULT_NAME,
              createdAt: Date.now(),
              archivedAt: null,
            },
          ],
        };
        store.put(catalog, CATALOG_KEY);
        result = catalog;
      } catch (error) {
        failure = asError(error, 'The local vault catalog is unreadable.');
        try {
          transaction.abort();
        } catch {
          // The transaction is already ending.
        }
        reject(failure);
      }
    };
  });
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

/** Reads one stored record. */
function readDocument(db: IDBDatabase, key: string): Promise<unknown> {
  return readRecords(db, [key]).then((records) => records.get(key));
}

/** Reads several stored records in one readonly transaction. */
function readRecords(db: IDBDatabase, keys: readonly string[]): Promise<Map<string, unknown>> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const records = new Map<string, unknown>();
    let pending = keys.length;

    transaction.onerror = (event) =>
      reject(requestError(event) ?? new Error('The local vault could not be read.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('The local vault read was aborted.'));

    const ready = () => {
      pending -= 1;
      if (pending > 0) return;
      resolve(records);
    };

    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        records.set(key, request.result);
        ready();
      };
    }
  });
}

/** Writes one stored document. */
function writeDocument(db: IDBDatabase, document: VaultDocument, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) =>
      reject(requestError(event) ?? new Error('The local vault could not be written.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The local vault write was aborted.'));
    transaction.objectStore(STORE_NAME).put(document, key);
  });
}

/**
 * The error of the request that failed.
 *
 * A failed request bubbles its error to the transaction while the transaction
 * is still active, and `transaction.error` may not be read that early. The
 * error is a DOMException, which is not an `Error` in every environment.
 */
function requestError(event: Event): Error | null {
  const target = event.target as IDBRequest | null;
  if (!target || !('error' in target)) return null;
  let error: DOMException | null;
  try {
    error = target.error;
  } catch {
    // Reading the error while the transaction is still active throws in
    // browsers; the event's own error is reported from the handler instead.
    return null;
  }
  if (!error) return null;
  if (error instanceof Error) return error;

  const name = typeof (error as { name?: unknown }).name === 'string' ? (error as { name: string }).name : 'Error';
  const message =
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : String(error);
  const wrapped = new Error(message);
  wrapped.name = name;
  return wrapped;
}

/** The store key of a vault document. The legacy vault keeps its own key. */
function documentKey(id: string): string {
  return id === LEGACY_VAULT_ID ? DOCUMENT_KEY : `vault:${id}`;
}

/**
 * Rejects ids that cannot address a store key.
 *
 * The legacy id stays valid because it is reserved for the legacy document;
 * a new vault never receives it.
 */
function assertVaultId(id: string): void {
  if (typeof id !== 'string' || id.length === 0) throw new Error('A vault id is required.');
  if (!VAULT_ID_PATTERN.test(id)) throw new Error(`The vault id "${id}" is not valid.`);
}

/** Normalizes a display name the way note names are normalized. */
function normalizeVaultName(raw: string): string {
  if (typeof raw !== 'string') throw new Error('A vault name is required.');
  const name = normalizeNoteName(raw);
  if (!name) throw new Error('A vault name cannot be empty.');
  return name;
}

/** A fresh vault id. The reserved legacy id is never handed out. */
function newVaultId(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  return `vault-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

/** Unwraps and validates the stored catalog. */
function parseCatalog(value: unknown): VaultCatalog {
  if (!isRecord(value)) throw new Error('The stored vault catalog is unreadable.');
  if (value.version !== CATALOG_VERSION) {
    throw new Error(`The stored vault catalog has an unsupported version (${String(value.version)}).`);
  }
  const activeVaultId = value.activeVaultId;
  if (typeof activeVaultId !== 'string') throw new Error('The stored vault catalog is unreadable.');
  const entries = value.vaults;
  if (!Array.isArray(entries)) throw new Error('The stored vault catalog is unreadable.');

  const vaults = entries.map(parseMetadata);
  const seen = new Set<string>();
  for (const vault of vaults) {
    if (seen.has(vault.id)) {
      throw new Error(`The stored vault catalog contains a duplicate vault id (${vault.id}).`);
    }
    seen.add(vault.id);
  }

  const active = vaults.find((vault) => vault.id === activeVaultId);
  if (!active) throw new Error('The stored vault catalog has no active vault.');
  if (active.archivedAt !== null) {
    throw new Error('The stored vault catalog has an archived active vault.');
  }
  return { version: CATALOG_VERSION, activeVaultId, vaults };
}

/** Validates one catalog entry. */
function parseMetadata(value: unknown): VaultMetadata {
  if (!isRecord(value)) throw new Error('The stored vault catalog contains an unreadable entry.');
  const id = value.id;
  if (typeof id !== 'string' || !VAULT_ID_PATTERN.test(id)) {
    throw new Error('The stored vault catalog contains an invalid vault id.');
  }
  const name = value.name;
  if (typeof name !== 'string' || name.length === 0 || name !== normalizeNoteName(name)) {
    throw new Error(`The stored vault catalog contains an unnormalized vault name (${id}).`);
  }
  const createdAt = value.createdAt;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
    throw new Error(`The stored vault catalog contains an invalid creation time (${id}).`);
  }
  const archivedAt = value.archivedAt;
  if (archivedAt !== null && (typeof archivedAt !== 'number' || !Number.isFinite(archivedAt))) {
    throw new Error(`The stored vault catalog contains an invalid archive time (${id}).`);
  }
  return { id, name, createdAt, archivedAt };
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
