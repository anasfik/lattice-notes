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
 *
 * Version 2 adds two stores and rewrites nothing: `settings` holds the one
 * settings record of the app and `snapshots` holds the bodies of the notes
 * before they were replaced. A version 1 database is upgraded in place, with
 * its vault documents and its catalog left exactly as they were.
 *
 * Version 3 adds one more store and rewrites nothing either: `bookmarks`
 * holds the bookmarks of every vault, one record per bookmark. A version 1 or
 * a version 2 database is upgraded in place and keeps its documents, its
 * settings and its snapshots as they were.
 */

import { createEmptyVault, createNote, normalizeNoteName } from '../domain/vault';
import { normalizeSettings } from '../domain/settings';
import type { AppSettings } from '../domain/settings';
import {
  MAX_VAULT_SNAPSHOT_BYTES,
  byteLength,
  planSnapshotEviction,
} from '../domain/snapshots';
import type { Snapshot } from '../domain/snapshots';
import type { Bookmark, BookmarkKind } from '../domain/bookmarks';
import type { Note, Vault } from '../domain/types';

const DB_NAME = 'lattice-notes';
const DB_VERSION = 3;
const STORE_NAME = 'vault';
const SETTINGS_STORE = 'settings';
const SNAPSHOT_STORE = 'snapshots';
const BOOKMARK_STORE = 'bookmarks';
const DOCUMENT_KEY = 'current';
const CATALOG_KEY = 'catalog';
const SETTINGS_KEY = 'settings';
const DOCUMENT_VERSION = 1;
const CATALOG_VERSION = 1;
const SESSION_VERSION = 1;
/** The legacy document keeps the reserved id and its own key. */
const LEGACY_VAULT_ID = 'current';
const LEGACY_VAULT_NAME = 'My vault';
/** Ids become store keys, so they stay plain and never carry a separator. */
const VAULT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Counts the snapshots of this session, so two of them have an order. */
let snapshotSequence = 0;

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

/**
 * The open notes of one vault.
 *
 * The session holds ids only, never bodies, so a tab strip can never keep a
 * second copy of a note. It belongs to one vault and is stored under its own
 * key, so two vaults never share a tab list.
 */
export interface VaultTabSession {
  version: 1;
  openNoteIds: string[];
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
 * says. A session is written in the same transaction as the document, so a
 * failed write leaves neither the notes nor the tab list behind. Rejects when
 * the write fails.
 */
export async function saveVault(
  vault: Vault,
  id: string = LEGACY_VAULT_ID,
  session?: VaultTabSession,
): Promise<void> {
  assertVaultId(id);
  if (session !== undefined) assertSession(session);
  const db = await openDatabase();
  try {
    if (session === undefined) {
      await writeDocument(db, { version: DOCUMENT_VERSION, vault }, documentKey(id));
      return;
    }
    await writeDocumentWithSession(
      db,
      { version: DOCUMENT_VERSION, vault },
      documentKey(id),
      session,
      sessionKey(id),
    );
  } finally {
    db.close();
  }
}

/**
 * Reads the open notes of one vault.
 *
 * Resolves `null` when the vault has no session. A session that is not a
 * versioned list of ids rejects, because a broken session must not look like
 * an empty one.
 */
export async function loadVaultSession(id: string): Promise<VaultTabSession | null> {
  assertVaultId(id);
  const db = await openDatabase();
  try {
    const record = await readDocument(db, sessionKey(id));
    if (record === undefined || record === null) return null;
    return readSession(record);
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
    const records = await readRecords(db, STORE_NAME, [CATALOG_KEY, DOCUMENT_KEY]);
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
 * A readable legacy document joins the catalog in the same transaction, so
 * creating a vault can never hide the user's original notes. The legacy
 * document keeps its own key and its own content; only a metadata entry is
 * added. An unreadable legacy document stops the write instead of being
 * ignored, because a broken document is never a fresh start.
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
    return await commitCatalog(db, [DOCUMENT_KEY], ({ catalog, documents }) => {
      if (catalog?.vaults.some((vault) => vault.id === id)) {
        throw new Error(`A vault with the id "${id}" already exists.`);
      }
      const members = catalog?.vaults ?? [];
      const vaults =
        documents.get(DOCUMENT_KEY) && !members.some((member) => member.id === LEGACY_VAULT_ID)
          ? [...members, legacyCatalogMember()]
          : members;
      const next: VaultCatalog = { version: CATALOG_VERSION, activeVaultId: id, vaults: [...vaults, entry] };
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
 * Reads the settings of the app.
 *
 * A record that is missing or broken gives the defaults, so a settings file
 * that cannot be read never stops the notes from loading. The read never
 * writes, so it can never touch the vault.
 */
export async function loadSettings(): Promise<AppSettings> {
  const db = await openDatabase();
  try {
    const record = await readRecords(db, SETTINGS_STORE, [SETTINGS_KEY]);
    return normalizeSettings(record.get(SETTINGS_KEY));
  } finally {
    db.close();
  }
}

/**
 * Writes the settings of the app.
 *
 * The settings are normalized before they are stored, so the record in the
 * storage is always a valid one and a broken value can never come back.
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await openDatabase();
  try {
    await writeRecord(db, SETTINGS_STORE, normalizeSettings(settings), SETTINGS_KEY);
  } finally {
    db.close();
  }
}

/**
 * The snapshots of one note, the newest first.
 *
 * A snapshot belongs to one vault and one note, so a snapshot of another note
 * or of another vault is never in the list.
 */
export async function listSnapshots(vaultId: string, noteId: string): Promise<Snapshot[]> {
  assertVaultId(vaultId);
  assertNoteId(noteId);
  const db = await openDatabase();
  try {
    const records = await readAllRecords(db, SNAPSHOT_STORE);
    return records
      .filter((record): record is Snapshot =>
        isSnapshot(record) && record.vaultId === vaultId && record.noteId === noteId)
      .sort((a, b) => b.at - a.at || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  } finally {
    db.close();
  }
}

/** What one snapshot write may do besides keeping the body. */
export interface SnapshotWriteOptions {
  /** Bodies older than this are removed in the same transaction. */
  cutoff?: number;
  /** The byte budget of the vault. The default is the budget of the product. */
  budget?: number;
}

/**
 * Stores the body of a note before it is replaced.
 *
 * The write is bounded: the bodies of the vault share a byte budget, so the
 * oldest ones go first when the new one does not fit. A body that is larger
 * than the whole budget is refused, because keeping it would empty the
 * history of every other note. The bodies that are too old are swept in the
 * same transaction, so an expired body never takes part in the budget.
 *
 * A failure rejects, so the caller can report it and carry on with the note
 * itself.
 */
export async function writeSnapshot(
  vaultId: string,
  noteId: string,
  body: string,
  options: SnapshotWriteOptions = {},
): Promise<void> {
  assertVaultId(vaultId);
  assertNoteId(noteId);
  if (typeof body !== 'string') throw new Error('A note body is required.');
  const budget = options.budget ?? MAX_VAULT_SNAPSHOT_BYTES;
  const size = byteLength(body);
  if (size > budget) {
    throw new Error(
      `The body is larger than the ${budget} byte history budget of a vault.`,
    );
  }
  const at = Date.now();
  const snapshot: Snapshot = {
    key: newSnapshotKey(at),
    vaultId,
    noteId,
    at,
    body,
  };
  const db = await openDatabase();
  try {
    await writeSnapshotBounded(db, snapshot, size, budget, options.cutoff);
  } finally {
    db.close();
  }
}

/**
 * Keeps a body inside the budget of its vault, in one transaction.
 *
 * The expired bodies go first, then the oldest ones, until the new body fits.
 * The transaction covers every step, so the budget is never broken halfway
 * and a failure changes nothing.
 */
function writeSnapshotBounded(
  db: IDBDatabase,
  snapshot: Snapshot,
  size: number,
  budget: number,
  cutoff: number | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) =>
      reject(requestError(event) ?? new Error('The recovery history could not be written.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('The recovery history write was aborted.'));

    const store = transaction.objectStore(SNAPSHOT_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        const records = (request.result as unknown[]).filter(isSnapshot);
        const mine = records.filter((record) => record.vaultId === snapshot.vaultId);
        const expired = cutoff === undefined ? [] : mine.filter((record) => record.at < cutoff);
        const alive = cutoff === undefined ? mine : mine.filter((record) => record.at >= cutoff);
        for (const record of expired) store.delete(record.key);
        const doomed = planSnapshotEviction(
          alive.map((record) => ({ key: record.key, at: record.at, bytes: byteLength(record.body) })),
          size,
          budget,
        );
        for (const key of doomed) store.delete(key);
        store.put(snapshot, snapshot.key);
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction is already ending.
        }
        reject(asError(error, 'The recovery history could not be written.'));
      }
    };
    request.onerror = () =>
      reject(transaction.error ?? new Error('The recovery history could not be read.'));
  });
}

/**
 * Frees the space of the kept bodies of a vault.
 *
 * The oldest bodies go first, until the vault holds at most the given number
 * of bytes. It is the answer to a storage that refuses a write: the history
 * gives way so the notes of the reader can be stored. Returns the number of
 * bytes that were freed.
 */
export async function reclaimSnapshotSpace(
  vaultId: string,
  keepBytes: number = Math.floor(MAX_VAULT_SNAPSHOT_BYTES / 2),
): Promise<number> {
  assertVaultId(vaultId);
  const db = await openDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
      transaction.oncomplete = () => resolve(freed);
      transaction.onerror = (event) =>
        reject(requestError(event) ?? new Error('The recovery history could not be cleared.'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('The recovery history clear was aborted.'));

      const store = transaction.objectStore(SNAPSHOT_STORE);
      let freed = 0;
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          const mine = (request.result as unknown[])
            .filter(isSnapshot)
            .filter((record) => record.vaultId === vaultId);
          const sized = mine.map((record) => ({
            key: record.key,
            at: record.at,
            bytes: byteLength(record.body),
          }));
          let total = sized.reduce((sum, body) => sum + body.bytes, 0);
          const oldestFirst = [...sized].sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
          for (const body of oldestFirst) {
            if (total <= keepBytes) break;
            store.delete(body.key);
            total -= body.bytes;
            freed += body.bytes;
          }
        } catch (error) {
          try {
            transaction.abort();
          } catch {
            // The transaction is already ending.
          }
          reject(asError(error, 'The recovery history could not be cleared.'));
        }
      };
      request.onerror = () =>
        reject(transaction.error ?? new Error('The recovery history could not be read.'));
    });
  } finally {
    db.close();
  }
}

/**
 * Removes a note from a vault for good, with its history, in one transaction.
 *
 * The document, the tab list and the kept bodies of the note are written and
 * removed together: either the note is gone from the vault, from the tab
 * list and from the history, or nothing changed at all. A failed write leaves
 * the note and its history exactly as they were.
 */
export async function purgeStoredNote(
  vaultId: string,
  vault: Vault,
  noteId: string,
  session?: VaultTabSession,
): Promise<void> {
  assertVaultId(vaultId);
  assertNoteId(noteId);
  if (session !== undefined) assertSession(session);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, SNAPSHOT_STORE], 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = (event) =>
        reject(requestError(event) ?? new Error('The note could not be deleted.'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('The deletion of the note was aborted.'));

      const store = transaction.objectStore(STORE_NAME);
      const snapshots = transaction.objectStore(SNAPSHOT_STORE);
      const request = snapshots.getAll();
      request.onsuccess = () => {
        try {
          for (const record of request.result as unknown[]) {
            if (isSnapshot(record) && record.vaultId === vaultId && record.noteId === noteId) {
              snapshots.delete(record.key);
            }
          }
          if (session !== undefined) store.put(session, sessionKey(vaultId));
          store.put({ version: DOCUMENT_VERSION, vault }, documentKey(vaultId));
        } catch (error) {
          try {
            transaction.abort();
          } catch {
            // The transaction is already ending.
          }
          reject(asError(error, 'The note could not be deleted.'));
        }
      };
      request.onerror = () =>
        reject(transaction.error ?? new Error('The recovery history could not be read.'));
    });
  } finally {
    db.close();
  }
}

/**
 * Reads one snapshot.
 *
 * Resolves `null` when the key is unknown or when the record is broken, so a
 * broken snapshot never stops the list of the others.
 */
export async function readSnapshot(key: string): Promise<Snapshot | null> {
  assertSnapshotKey(key);
  const db = await openDatabase();
  try {
    const records = await readRecords(db, SNAPSHOT_STORE, [key]);
    const record = records.get(key);
    return isSnapshot(record) ? record : null;
  } finally {
    db.close();
  }
}

/** Removes one snapshot. */
export async function deleteSnapshot(key: string): Promise<void> {
  assertSnapshotKey(key);
  const db = await openDatabase();
  try {
    await deleteRecord(db, SNAPSHOT_STORE, key);
  } finally {
    db.close();
  }
}

/**
 * Removes the snapshots of one vault that are older than the cutoff.
 *
 * The snapshots of the other vaults and the ones inside the window stay.
 * Returns how many snapshots were removed.
 */
export async function pruneSnapshots(vaultId: string, cutoff: number): Promise<number> {
  assertVaultId(vaultId);
  if (!Number.isFinite(cutoff)) throw new Error('A cutoff is required.');
  const db = await openDatabase();
  try {
    const records = await readAllRecords(db, SNAPSHOT_STORE);
    const doomed = records.filter(
      (record): record is Snapshot =>
        isSnapshot(record) && record.vaultId === vaultId && record.at < cutoff,
    );
    for (const snapshot of doomed) {
      await deleteRecord(db, SNAPSHOT_STORE, snapshot.key);
    }
    return doomed.length;
  } finally {
    db.close();
  }
}

/**
 * The bookmarks of one vault, and the records that could not be read.
 */
export interface BookmarkRead {
  /** The bookmarks of the vault that could be read. */
  bookmarks: Bookmark[];
  /** How many records were too broken to be a bookmark. */
  dropped: number;
}

/**
 * Reads the bookmarks of a vault.
 *
 * A record that is not a bookmark is dropped and counted, so a broken
 * bookmark never stops the notes of the vault from loading. The bookmarks of
 * another vault are never in the list.
 */
export async function loadBookmarks(vaultId: string): Promise<BookmarkRead> {
  assertVaultId(vaultId);
  const db = await openDatabase();
  try {
    const records = await readAllRecords(db, BOOKMARK_STORE);
    const bookmarks: Bookmark[] = [];
    let dropped = 0;
    for (const record of records) {
      // A record that names another vault is not the business of this read,
      // so only a broken record of this vault is counted as dropped.
      if (!isStoredBookmark(record)) {
        const claimed = isRecord(record) ? (record as { vaultId?: unknown }).vaultId : undefined;
        if (claimed !== undefined && claimed !== vaultId) continue;
        dropped += 1;
        continue;
      }
      if (record.vaultId !== vaultId) continue;
      bookmarks.push({
        id: record.id,
        kind: record.kind,
        target: record.target,
        title: record.title,
        group: record.group,
      });
    }
    return { bookmarks, dropped };
  } finally {
    db.close();
  }
}

/**
 * Writes the bookmarks of a vault.
 *
 * The list of the vault is replaced in one transaction: the records that are
 * gone are deleted and the new ones are written, so a half written list never
 * lands in the storage. A write that fails rejects, so the caller can report
 * it and carry on with the notes.
 */
export async function saveBookmarks(vaultId: string, bookmarks: Bookmark[]): Promise<void> {
  assertVaultId(vaultId);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(BOOKMARK_STORE, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = (event) =>
        reject(requestError(event) ?? new Error('The bookmarks could not be written.'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('The bookmark write was aborted.'));

      const store = transaction.objectStore(BOOKMARK_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          for (const record of request.result as unknown[]) {
            if (!isStoredBookmark(record)) continue;
            if (record.vaultId !== vaultId) continue;
            store.delete(bookmarkKey(vaultId, record.id));
          }
          for (const bookmark of bookmarks) {
            store.put({ ...bookmark, vaultId }, bookmarkKey(vaultId, bookmark.id));
          }
        } catch (error) {
          try {
            transaction.abort();
          } catch {
            // The transaction is already ending.
          }
          reject(asError(error, 'The bookmarks could not be written.'));
        }
      };
      request.onerror = () =>
        reject(transaction.error ?? new Error('The bookmarks could not be read.'));
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
 * Builds the metadata entry for the legacy document.
 *
 * The entry describes the document that already exists at the legacy key; it
 * never carries content, so the document itself stays untouched.
 */
function legacyCatalogMember(): VaultMetadata {
  return {
    id: LEGACY_VAULT_ID,
    name: LEGACY_VAULT_NAME,
    createdAt: Date.now(),
    archivedAt: null,
  };
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
          vaults: [legacyCatalogMember()],
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
      // The stores of version 2 are added and nothing else is touched, so a
      // version 1 database keeps its documents and its catalog as they were.
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE);
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE);
      // The store of the bookmarks is added in version 3 and rewrites nothing,
      // so a version 1 and a version 2 database keep everything they had.
      if (!db.objectStoreNames.contains(BOOKMARK_STORE)) db.createObjectStore(BOOKMARK_STORE);
    };
    request.onsuccess = () => {
      // A connection that arrives after the request was rejected must not leak.
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      const db = request.result;
      // Another tab that opens a newer version of the database waits for the
      // open connections to go. This one closes itself when the version
      // changes, so the other tab is not held up by a tab that is not looking
      // at the screen any more.
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
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
  return readRecords(db, STORE_NAME, [key]).then((records) => records.get(key));
}

/** Reads several stored records in one readonly transaction. */
function readRecords(
  db: IDBDatabase,
  store: string,
  keys: readonly string[],
): Promise<Map<string, unknown>> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
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
      const request = transaction.objectStore(store).get(key);
      request.onsuccess = () => {
        records.set(key, request.result);
        ready();
      };
    }
  });
}

/** Reads every record of a store in one readonly transaction. */
function readAllRecords(db: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    transaction.onerror = (event) =>
      reject(requestError(event) ?? new Error('The local records could not be read.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('The local records read was aborted.'));

    const request = transaction.objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = (event) =>
      reject(requestError(event) ?? new Error('The local records could not be read.'));
  });
}

/** Writes one record into a store. */
function writeRecord(
  db: IDBDatabase,
  store: string,
  value: unknown,
  key: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) =>
      reject(requestError(event) ?? new Error('The local record could not be written.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('The local record write was aborted.'));
    transaction.objectStore(store).put(value, key);
  });
}

/** Removes one record from a store. */
function deleteRecord(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) =>
      reject(requestError(event) ?? new Error('The local record could not be removed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('The local record removal was aborted.'));
    transaction.objectStore(store).delete(key);
  });
}

/** Writes one stored document. */
function writeDocument(db: IDBDatabase, document: VaultDocument, key: string): Promise<void> {
  return writeRecord(db, STORE_NAME, document, key);
}

/**
 * Writes the document and the session in one transaction.
 *
 * Both records belong to one write, so a failure changes neither the notes nor
 * the tab list. The session is written first, so a document that cannot be
 * stored rolls the session back with it.
 */
function writeDocumentWithSession(
  db: IDBDatabase,
  document: VaultDocument,
  key: string,
  session: VaultTabSession,
  sessionKey: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) =>
      reject(requestError(event) ?? new Error('The local vault could not be written.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The local vault write was aborted.'));
    const store = transaction.objectStore(STORE_NAME);
    try {
      store.put(session, sessionKey);
      store.put(document, key);
    } catch (error) {
      // A value that cannot be stored aborts the transaction, so the other
      // record is not written either.
      try {
        transaction.abort();
      } catch {
        // The transaction is already ending.
      }
      reject(asError(error, 'The local vault could not be written.'));
    }
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

/** The store key of the tab session of a vault. */
function sessionKey(id: string): string {
  return `session:${id}`;
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

/** Rejects a note id that cannot belong to a snapshot. */
function assertNoteId(id: string): void {
  if (typeof id !== 'string' || id.length === 0) throw new Error('A note id is required.');
}

/** Rejects a snapshot key that cannot address a record. */
function assertSnapshotKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) throw new Error('A snapshot key is required.');
}

/** True for a record that is a snapshot of a note. */
function isSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    typeof value.vaultId === 'string' &&
    typeof value.noteId === 'string' &&
    typeof value.at === 'number' &&
    Number.isFinite(value.at) &&
    typeof value.body === 'string'
  );
}

/** A bookmark as it is stored: it belongs to a vault. */
interface StoredBookmark extends Bookmark {
  vaultId: string;
}

/** True for a record that is a bookmark of a vault. */
function isStoredBookmark(value: unknown): value is StoredBookmark {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.vaultId === 'string' &&
    isBookmarkKind(value.kind) &&
    typeof value.target === 'string' &&
    typeof value.title === 'string' &&
    typeof value.group === 'string'
  );
}

/** True for a kind of bookmark the product knows. */
function isBookmarkKind(value: unknown): value is BookmarkKind {
  return value === 'note' || value === 'heading' || value === 'search';
}

/** The store key of a bookmark. The vault is part of it, so two vaults never meet. */
function bookmarkKey(vaultId: string, id: string): string {
  return `bookmark:${vaultId}:${id}`;
}

/** A fresh key for a snapshot. */
function newSnapshotKey(at: number): string {
  const source = globalThis.crypto;
  const random =
    source && typeof source.randomUUID === 'function'
      ? source.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  // The key grows with the clock, so two snapshots of the same millisecond
  // still have an order and the newest one is always the first of the list.
  snapshotSequence += 1;
  return `${String(at).padStart(16, '0')}-${snapshotSequence.toString(36)}-${random}`;
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

/** Unwraps and validates a stored tab session. */
function readSession(value: unknown): VaultTabSession {
  if (!isRecord(value)) throw new Error('The stored vault session is unreadable.');
  if (value.version !== SESSION_VERSION) {
    throw new Error(`The stored vault session has an unsupported version (${String(value.version)}).`);
  }
  const openNoteIds = value.openNoteIds;
  if (!Array.isArray(openNoteIds) || !openNoteIds.every((id) => typeof id === 'string')) {
    throw new Error('The stored vault session is unreadable.');
  }
  return { version: SESSION_VERSION, openNoteIds: [...openNoteIds] as string[] };
}

/** Checks a session before it is written, so a broken one never lands. */
function assertSession(session: VaultTabSession): void {
  if (!isRecord(session)) throw new Error('The vault session is unreadable.');
  if (session.version !== SESSION_VERSION) {
    throw new Error(`The vault session has an unsupported version (${String(session.version)}).`);
  }
  if (!Array.isArray(session.openNoteIds) || !session.openNoteIds.every((id) => typeof id === 'string')) {
    throw new Error('The vault session is unreadable.');
  }
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
