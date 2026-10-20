import 'fake-indexeddb/auto';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { formatLocalDate } from './domain/dailyNotes';
import { MAX_ENVELOPE_NOTES } from './domain/transfer';
import { createEmptyVault, createNote, deleteNote } from './domain/vault';
import type { Vault } from './domain/types';
import {
  createSeedVault,
  createStoredVault,
  loadCatalog,
  loadVault,
  loadVaultSession,
  openStoredVault,
  saveVault,
} from './storage/vaultRepository';
import type { VaultTabSession } from './storage/vaultRepository';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The storage of the test, with the switches that make the timing of a
 * write observable: a write can wait, a write can fail and a read of a vault
 * can fail. The real repository does the work; only the timing is added.
 */
const storage = vi.hoisted(() => ({
  /** The milliseconds every next write to a key waits for. */
  delays: new Map<string, number[]>(),
  /** The writes that were started, so a test can wait for one to land. */
  writes: [] as { key: string; done: boolean; failed: boolean; session: unknown }[],
  /** The writes that fail, per key. */
  failures: new Map<string, number>(),
  /** The reads of a vault that fail, per id. */
  readFailures: new Map<string, number>(),
  /** The milliseconds a read of a vault waits for, per id. */
  readDelays: new Map<string, number>(),
  /** The reads of a tab list that fail, per vault id. */
  sessionFailures: new Map<string, number>(),
}));

vi.mock('./storage/vaultRepository', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('./storage/vaultRepository');
  return {
    ...actual,
    saveVault: async (vault: Vault, id?: string, session?: VaultTabSession) => {
      const key = id ?? 'current';
      const record = { key, done: false, failed: false, session: session ?? null };
      storage.writes.push(record);
      const queue = storage.delays.get(key);
      const wait = queue && queue.length > 0 ? (queue.shift() as number) : 0;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const failures = storage.failures.get(key) ?? 0;
      if (failures > 0) {
        storage.failures.set(key, failures - 1);
        record.failed = true;
        record.done = true;
        throw new Error('the local vault could not be written');
      }
      await actual.saveVault(vault, id, session);
      record.done = true;
    },
    openStoredVault: async (id: string) => {
      const wait = storage.readDelays.get(id) ?? 0;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const failures = storage.readFailures.get(id) ?? 0;
      if (failures > 0) {
        storage.readFailures.set(id, failures - 1);
        throw new Error('the stored vault could not be opened');
      }
      return actual.openStoredVault(id);
    },
    loadVaultSession: async (id: string) => {
      const failures = storage.sessionFailures.get(id) ?? 0;
      if (failures > 0) {
        storage.sessionFailures.set(id, failures - 1);
        throw new Error('the stored tab list could not be read');
      }
      return actual.loadVaultSession(id);
    },
  };
});

// jsdom ships the dialog element without the modal behaviour, so the harness
// stands in for the platform: the open state, focus moved into the dialog,
// and focus restored to the element that had it before the dialog opened.
const dialogProto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
if (typeof dialogProto.showModal !== 'function') {
  const restore = new WeakMap<object, HTMLElement | null>();
  dialogProto.showModal = function showModal(this: HTMLDialogElement) {
    restore.set(this, document.activeElement as HTMLElement | null);
    this.setAttribute('open', '');
    this.querySelector<HTMLElement>('input, button')?.focus();
  };
  dialogProto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
    restore.get(this)?.focus();
  };
}

const DB_NAME = 'lattice-notes';
const STORE_NAME = 'vault';
const DOCUMENT_KEY = 'current';
/** The width jsdom starts with; the compact layout starts below 768. */
const INITIAL_WIDTH = window.innerWidth;

let container: HTMLDivElement;
let root: Root;

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Raises the database version and drops the store, so later writes fail. */
async function dropStore(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (request.result.objectStoreNames.contains('vault')) {
        request.result.deleteObjectStore('vault');
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error ?? new Error('upgrade failed'));
  });
}

/** Rebuilds the database with the vault store so a retry can succeed. */
async function restoreStore(): Promise<void> {
  await deleteDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('vault')) {
        request.result.createObjectStore('vault');
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error ?? new Error('create failed'));
  });
}

/** Reads the stored document without the repository's version check. */
async function readRawDocument(): Promise<{ version: number; vault: Vault }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('raw open failed'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(DOCUMENT_KEY);
      request.onsuccess = () => resolve(request.result as { version: number; vault: Vault });
      request.onerror = () => reject(request.error ?? new Error('raw read failed'));
    });
  } finally {
    db.close();
  }
}

/** Writes a raw document, including envelopes the repository must reject. */
async function writeRawDocument(document: unknown): Promise<void> {
  await writeRaw('current', document);
}

/** Writes a raw catalog, including a catalog the repository must reject. */
async function writeRawCatalog(catalog: unknown): Promise<void> {
  await writeRaw('catalog', catalog);
}

/** Writes one raw record into the store of the app. */
async function writeRaw(key: string, value: unknown): Promise<void> {
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
      transaction.objectStore(STORE_NAME).put(value, key);
    });
  } finally {
    db.close();
  }
}

/** Stores a readable vault that the repository refuses to load. */
async function storeUnreadableDocument(): Promise<void> {
  const { vault } = createNote(createEmptyVault(), 'Stored note');
  await saveVault(vault);
  await writeRawDocument({ version: 2, vault });
}

function queryAll<E extends HTMLElement = HTMLElement>(selector: string): E[] {
  return Array.from(container.querySelectorAll<E>(selector));
}

function accessibleName(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
}

function buttonByName(name: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>('button').find((element) => accessibleName(element) === name);
  if (!found) throw new Error(`no button named "${name}"`);
  return found;
}

function noteNames(): string[] {
  return queryAll('.explorer__note').map((element) => element.textContent?.trim() ?? '');
}

function statusText(): string {
  return container.querySelector('[role="status"]')?.textContent?.trim() ?? '';
}

function alertText(): string {
  return container.querySelector('[role="alert"]')?.textContent?.trim() ?? '';
}

function noteTitle(): string {
  return container.querySelector('.workspace__doc-title')?.textContent?.trim() ?? '';
}

function editorTextarea(): HTMLTextAreaElement {
  const found = container.querySelector<HTMLTextAreaElement>('textarea');
  if (!found) throw new Error('no editor textarea');
  return found;
}

function fileInput(): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!found) throw new Error('no file input');
  return found;
}

/** Hands a list of files to the import control. */
async function selectFiles(input: HTMLInputElement, files: unknown[]): Promise<void> {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function searchInput(): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('.search__input');
  if (!found) throw new Error('no search input');
  return found;
}

function paletteDialog(): HTMLDialogElement {
  const found = container.querySelector<HTMLDialogElement>('dialog.palette');
  if (!found) throw new Error('no palette dialog');
  return found;
}

function paletteInput(): HTMLInputElement {
  const found = paletteDialog().querySelector<HTMLInputElement>('input');
  if (!found) throw new Error('no palette input');
  return found;
}

function paletteOptions(): HTMLElement[] {
  return Array.from(paletteDialog().querySelectorAll<HTMLElement>('[role="option"]'));
}

function switcherDialog(): HTMLDialogElement {
  const found = container.querySelector<HTMLDialogElement>('dialog.switcher');
  if (!found) throw new Error('no switcher dialog');
  return found;
}

function switcherInput(): HTMLInputElement {
  const found = switcherDialog().querySelector<HTMLInputElement>('input');
  if (!found) throw new Error('no switcher input');
  return found;
}

function switcherOptions(): HTMLElement[] {
  return Array.from(switcherDialog().querySelectorAll<HTMLElement>('[role="option"]'));
}

/** The names of the open tabs, in the order of the strip. */
function tabLabels(): string[] {
  return queryAll<HTMLButtonElement>('.tabs__label').map(
    (button) => button.textContent?.trim() ?? '',
  );
}

/** The close controls of the open tabs, in the order of the strip. */
function tabCloses(): HTMLButtonElement[] {
  return queryAll<HTMLButtonElement>('.tabs__close');
}

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 4000): Promise<void> {
  // Waiting runs with the act environment off, the way React Testing Library
  // does it: asynchronous app updates may land between assertions, and the
  // DOM the check reads is the DOM the user would see.
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const start = Date.now();
    for (;;) {
      if (await check()) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return;
      }
      if (Date.now() - start > timeout) throw new Error('timed out waiting for the workspace');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const prototype =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pressKey(
  element: Element,
  key: string,
  init: KeyboardEventInit = {},
): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

/** Waits past the save debounce so any scheduled write would have run. */
async function sleep(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function renderApp(): Promise<void> {
  await act(async () => {
    root.render(<App />);
  });
  await waitFor(
    () =>
      container.querySelector('.workspace') !== null ||
      container.querySelector('.onboarding') !== null,
  );
}

/**
 * Boots the app as a user whose notes are already stored.
 *
 * The legacy document is stored when the test stored nothing, so the app
 * finds a catalog, skips the onboarding and opens the stored vault. A storage
 * that cannot be read is left alone, so the app can show its error.
 */
async function renderLegacyApp(): Promise<void> {
  try {
    const stored = await loadCatalog();
    if (stored === null) await saveVault(createSeedVault());
  } catch {
    // The storage cannot be read, so nothing is written into it.
  }
  await renderApp();
}

/** Unmounts the app and mounts it again on the same stored vault. */
async function remountApp(): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  await waitFor(
    () =>
      container.querySelector('.workspace') !== null ||
      container.querySelector('.onboarding') !== null,
  );
}

/**
 * Stores a second vault in the catalog and returns its id.
 *
 * The open vault stays the one of the test, so the app opens it as usual.
 */
async function storeSecondVault(): Promise<string> {
  return storeVault('Second vault', 'Only in B', 'body of B');
}

/** Stores a third vault in the catalog and returns its id. */
async function storeThirdVault(): Promise<string> {
  return storeVault('Third vault', 'Only in C', 'body of C');
}

/** Stores another vault in the catalog and returns its id. */
async function storeVault(name: string, noteName: string, body: string): Promise<string> {
  const created = createNote(createEmptyVault(), noteName, body);
  const vault = { ...created.vault, activeNoteId: created.note.id };
  const stored = await createStoredVault(name, vault);
  const id = stored.catalog.activeVaultId;
  await openStoredVault('current');
  return id;
}

/** The button of the vault manager with the given label. */
function findManagerButton(label: string): HTMLButtonElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('dialog.vaults button'),
  ).find((button) => button.getAttribute('aria-label') === label);
}

/**
 * Clicks a button of the vault manager.
 *
 * The manager reads the catalog when it opens, so the button may arrive a
 * moment later.
 */
async function clickManagerButton(label: string): Promise<void> {
  await waitFor(() => findManagerButton(label) !== undefined);
  await click(findManagerButton(label) as Element);
}

/** Opens the vault manager of the toolbar. */
async function openVaultManager(): Promise<void> {
  const trigger = Array.from(container.querySelectorAll<HTMLButtonElement>('.workspace__vault'))[0];
  if (!trigger) throw new Error('no vault trigger');
  await click(trigger);
  await waitFor(() => container.querySelector('dialog.vaults')?.hasAttribute('open') === true);
}

/** Opens the command palette with the shortcut under test. */
async function openPalette(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
    );
  });
}

/** Opens the quick switcher with the shortcut under test. */
async function openSwitcher(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }),
    );
  });
}

/** Runs a command of the catalog through the palette. */
async function runCommand(label: string): Promise<void> {
  await openPalette();
  await fill(paletteInput(), label);
  await pressKey(paletteInput(), 'Enter');
}

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  window.innerWidth = INITIAL_WIDTH;
  storage.delays.clear();
  storage.writes.length = 0;
  storage.failures.clear();
  storage.readFailures.clear();
  storage.readDelays.clear();
  await deleteDatabase();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe('workspace shell', () => {
  it('renders without an application console error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await renderLegacyApp();
    } finally {
      const calls = spy.mock.calls;
      spy.mockRestore();
      // The application logs nothing at all: every console error is a defect,
      // not only the one message this test used to look for.
      expect(calls).toEqual([]);
    }
    expect(container.querySelector('search')).toBeNull();
  });

  it('seeds a usable vault for a user whose notes are already stored', async () => {
    await renderLegacyApp();

    expect(noteNames().length).toBeGreaterThan(1);
    expect(noteNames()).toContain('Welcome to Lattice Notes');
    expect(noteTitle()).toBe('Welcome to Lattice Notes');
  });

  it('keeps a deliberately emptied vault empty and offers recovery', async () => {
    const created = createNote(createEmptyVault(), 'Scratch');
    await saveVault(deleteNote(created.vault, created.note.id).vault);

    await renderLegacyApp();

    expect(noteNames()).toHaveLength(0);
    expect(container.querySelector('.explorer__empty-text')?.textContent).toContain('No notes yet');

    await click(buttonByName('Restore Scratch'));

    expect(noteNames()).toContain('Scratch');
    expect(statusText()).toContain('Restored');
  });

  it('drops the undo control when the empty state restores the note', async () => {
    const created = createNote(createEmptyVault(), 'Only note');
    await saveVault(created.vault);
    await renderLegacyApp();

    await click(buttonByName('Delete Only note'));
    expect(container.querySelectorAll('.workspace__undo')).toHaveLength(1);

    await click(buttonByName('Restore Only note'));

    expect(noteNames()).toContain('Only note');
    // The undo slot held the restored note, so the control would do nothing.
    expect(container.querySelectorAll('.workspace__undo')).toHaveLength(0);
  });

  it('creates a note, selects it, and announces the change', async () => {
    await renderLegacyApp();
    const before = noteNames().length;

    await click(buttonByName('New note'));

    expect(noteNames()).toHaveLength(before + 1);
    expect(statusText()).toContain('Created');
    expect(noteTitle()).toBe('Untitled');
    expect(editorTextarea().disabled).toBe(false);
  });

  it('edits the note body in memory and persists it', async () => {
    await renderLegacyApp();

    await fill(editorTextarea(), 'Hello lattice');

    expect(editorTextarea().value).toBe('Hello lattice');
    expect(container.querySelector('.preview__body')?.textContent).toContain('Hello lattice');

    await waitFor(async () => {
      const stored = await loadVault();
      return stored?.notes.some((note) => note.body === 'Hello lattice') ?? false;
    });
  });

  it('renames a note with the keyboard', async () => {
    await renderLegacyApp();

    await click(buttonByName('Rename Welcome to Lattice Notes'));
    const input = container.querySelector<HTMLInputElement>('.explorer__rename-input');
    if (!input) throw new Error('no rename input');
    await fill(input, 'Welcome');
    await pressKey(input, 'Enter');

    expect(noteNames()).toContain('Welcome');
    expect(statusText()).toContain('Renamed');
  });

  it('deletes a note and restores it with undo', async () => {
    await renderLegacyApp();

    await click(buttonByName('Delete Welcome to Lattice Notes'));

    expect(noteNames()).not.toContain('Welcome to Lattice Notes');
    expect(statusText()).toContain('Deleted');

    await click(buttonByName('Undo delete'));

    expect(noteNames()).toContain('Welcome to Lattice Notes');
    expect(statusText()).toContain('Restored');
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Welcome to Lattice Notes');
  });

  it('creates a note with the Ctrl/Cmd+N shortcut', async () => {
    await renderLegacyApp();
    const before = noteNames().length;

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(noteNames()).toHaveLength(before + 1);
  });

  it('renders an existing wiki link as a button that selects the target', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'See [[Beta]] now.');
    const second = createNote(first.vault, 'Beta', 'Beta body');
    await saveVault({ ...second.vault, activeNoteId: first.note.id });

    await renderLegacyApp();
    const link = container.querySelector('.preview__wikilink');

    expect(link?.tagName).toBe('BUTTON');
    expect(link?.textContent).toBe('Beta');

    await click(link as Element);

    expect(noteTitle()).toBe('Beta');
  });

  it('renders hostile markdown as inert text', async () => {
    const created = createNote(
      createEmptyVault(),
      'Hostile',
      '<script>alert(1)</script> [click](javascript:alert(1)) [safe](https://example.com)',
    );
    await saveVault({ ...created.vault, activeNoteId: created.note.id });

    await renderLegacyApp();
    const body = container.querySelector('.preview__body');

    expect(body?.querySelector('script')).toBeNull();
    // The hostile target is dropped by the parser, so there is no anchor at
    // all; the safe link of the same note proves the query would have found
    // one.
    expect(body?.querySelector('a[href*="javascript"]')).toBeNull();
    expect(body?.textContent).toContain('<script>');
    expect(body?.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('keeps the notes usable and warns when saving fails', async () => {
    await renderLegacyApp();
    await dropStore();

    await fill(editorTextarea(), 'draft body');

    await waitFor(() => container.querySelector('[role="alert"]') !== null);
    expect(alertText()).toContain('Local storage');
    expect(editorTextarea().value).toBe('draft body');
    expect(noteNames().length).toBeGreaterThan(0);

    await restoreStore();
    await click(buttonByName('Retry'));

    await waitFor(async () => {
      const stored = await loadVault();
      return stored?.notes.some((note) => note.body === 'draft body') ?? false;
    });
    await waitFor(() => container.querySelector('[role="alert"]') === null);
  });

  it('warns and stays usable when local storage cannot be read', async () => {
    vi.stubGlobal('indexedDB', undefined);

    await renderLegacyApp();

    expect(alertText()).toContain('Local storage');

    await click(buttonByName('Create first note'));

    expect(noteNames()).toContain('Untitled');
  });

  it('names a missing wiki link as a create action', async () => {
    const created = createNote(createEmptyVault(), 'Alpha', 'See [[Nowhere]] now.');
    await saveVault({ ...created.vault, activeNoteId: created.note.id });

    await renderLegacyApp();

    const link = container.querySelector('.preview__wikilink');
    expect(link?.textContent).toMatch(/^Create note Nowhere/);
    expect(accessibleName(link as Element)).toBe('Create note Nowhere');
  });

  it('keeps the alias of a missing wiki link in the visible name', async () => {
    const created = createNote(createEmptyVault(), 'Alpha', 'See [[Nowhere|the void]] now.');
    await saveVault({ ...created.vault, activeNoteId: created.note.id });

    await renderLegacyApp();

    const link = container.querySelector('.preview__wikilink--missing');
    expect(link?.textContent).toMatch(/^Create note Nowhere \(the void\)/);
    expect(accessibleName(link as Element)).toBe(link?.textContent?.trim());
  });

  it('keeps one polite live region and a persistent visible label', async () => {
    await renderLegacyApp();

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-live="assertive"]')).toHaveLength(0);

    const label = container.querySelector('label[for="note-editor"]');
    expect(label?.textContent).toContain('Markdown body');
    expect(container.querySelector('#note-editor')?.tagName).toBe('TEXTAREA');
  });

  it('confirms a local save in the live region', async () => {
    await renderLegacyApp();
    await fill(editorTextarea(), 'saved body');

    await waitFor(() => statusText().includes('Saved to local storage'));
  });

  it('explains the empty preview instead of showing a blank pane', async () => {
    const created = createNote(createEmptyVault(), 'Empty', '');
    await saveVault(created.vault);

    await renderLegacyApp();

    const body = container.querySelector('.preview__body');
    expect(body?.children.length).toBeGreaterThan(0);
    expect(body?.textContent).toContain('Nothing to preview yet');
  });

  it('keeps the document order in step with the reading order', async () => {
    await renderLegacyApp();

    const order = Array.from(container.querySelector('.workspace')?.children ?? []).map(
      (child) => child.className,
    );

    expect(order).toEqual([
      'workspace__toolbar',
      'workspace__explorer',
      'workspace__main',
      'workspace__context',
    ]);
  });

  it('restores the selected note after a remount', async () => {
    await renderLegacyApp();

    await click(buttonByName('Getting started'));
    await waitFor(async () => {
      const stored = await loadVault();
      if (!stored) return false;
      const selected = stored.notes.find((note) => note.name === 'Getting started');
      return stored.activeNoteId === selected?.id;
    });

    await remountApp();

    expect(noteTitle()).toBe('Getting started');
  });

  it('replaces the undo slot with the note of the second delete', async () => {
    await renderLegacyApp();

    await click(buttonByName('Delete Welcome to Lattice Notes'));
    expect(statusText()).toContain('Deleted Welcome to Lattice Notes');

    await click(buttonByName('Delete Getting started'));
    expect(statusText()).toContain('Deleted Getting started');

    await click(buttonByName('Undo delete'));

    expect(noteNames()).toContain('Getting started');
    expect(noteNames()).not.toContain('Welcome to Lattice Notes');
  });
});

describe('import and export', () => {
  it('imports a Markdown file as a new note and keeps the existing notes', async () => {
    await renderLegacyApp();
    const before = noteNames();

    await selectFiles(fileInput(), [
      new File(['# imported body'], 'notes.md', { type: 'text/markdown' }),
    ]);

    expect(noteNames()).toContain('notes');
    expect(noteNames()).toEqual(expect.arrayContaining(before));
    expect(statusText()).toContain('Imported 1 note');
  });

  it('says that an import in memory only mode is not saved', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await renderLegacyApp();

    await selectFiles(fileInput(), [
      new File(['# imported body'], 'notes.md', { type: 'text/markdown' }),
    ]);

    expect(statusText()).toContain('Imported 1 note');
    expect(statusText()).toContain('not saved');
    expect(statusText()).toContain('Export');
  });

  it('skips a file that is neither Markdown nor an envelope', async () => {
    await renderLegacyApp();

    await selectFiles(fileInput(), [
      new File(['binary'], 'picture.pdf', { type: 'application/pdf' }),
    ]);

    expect(statusText()).toContain('unsupported type');
    expect(statusText()).toContain('picture.pdf');
    expect(noteNames()).not.toContain('picture.pdf');
  });

  it('skips a Markdown file over the size limit without reading it', async () => {
    await renderLegacyApp();

    await selectFiles(fileInput(), [
      new File(['x'.repeat(1_048_577)], 'big.md', { type: 'text/markdown' }),
    ]);

    expect(statusText()).toContain('too large');
    expect(noteNames()).not.toContain('big');
  });

  it('merges into the vault that is current when the files were read', async () => {
    await renderLegacyApp();

    let release: (text: string) => void = () => {};
    const slow = {
      name: 'notes.md',
      size: 12,
      text: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    };
    await selectFiles(fileInput(), [slow]);

    await fill(editorTextarea(), 'written while the file was read');

    release('# imported');
    await waitFor(() => statusText().includes('Imported 1 note'));

    expect(editorTextarea().value).toBe('written while the file was read');
    expect(noteNames()).toContain('notes');
  });

  it('reports a malformed envelope as an error and leaves the vault unchanged', async () => {
    await renderLegacyApp();
    const before = noteNames();

    await selectFiles(fileInput(), [
      new File(['not json at all'], 'vault.json', { type: 'application/json' }),
    ]);

    expect(alertText()).toContain('import failed');
    expect(noteNames()).toEqual(before);
  });

  it('exports the vault of this tab as a JSON file', async () => {
    await renderLegacyApp();

    const blobs: Blob[] = [];
    const revoked: string[] = [];
    let connected = false;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        blobs.push(blob);
        return 'blob:lattice-notes/vault';
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: (url: string) => {
        revoked.push(url);
      },
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        connected = this.isConnected;
      });

    try {
      await click(buttonByName('Export vault'));

      expect(blobs).toHaveLength(1);
      expect(blobs[0]?.type).toBe('application/json');
      const envelope = JSON.parse(await (blobs[0] as Blob).text()) as {
        app: string;
        notes: { name: string }[];
      };
      expect(envelope.app).toBe('lattice-notes');
      expect(envelope.notes.map((note) => note.name)).toEqual([...noteNames()].sort());

      expect(anchorClick).toHaveBeenCalledTimes(1);
      const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toBe('lattice-notes-vault.json');
      // The anchor has to be in the document when it is clicked.
      expect(connected).toBe(true);

      await waitFor(() => revoked.length === 1);
      expect(revoked).toEqual(['blob:lattice-notes/vault']);
    } finally {
      anchorClick.mockRestore();
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke });
    }
  });

  it('keeps the export control reachable while the storage banner is showing', async () => {
    vi.stubGlobal('indexedDB', undefined);

    await renderLegacyApp();

    expect(alertText()).toContain('Local storage');

    // The export control lives in the files disclosure, so the disclosure
    // has to be open before the control is on the screen.
    const files = container.querySelector<HTMLDetailsElement>('details.workspace__files');
    if (!files) throw new Error('no files disclosure');
    await click(files.querySelector('summary') as Element);
    expect(files.open).toBe(true);

    const exportButton = buttonByName('Export vault');
    expect(exportButton).not.toBeNull();
    expect(files.contains(exportButton)).toBe(true);
  });

  it('clears the import alert when a later import succeeds', async () => {
    await renderLegacyApp();

    await selectFiles(fileInput(), [
      new File(['not json at all'], 'vault.json', { type: 'application/json' }),
    ]);

    expect(alertText()).toContain('import failed');
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);

    await selectFiles(fileInput(), [
      new File(['# imported body'], 'notes.md', { type: 'text/markdown' }),
    ]);

    await waitFor(() => statusText().includes('Imported 1 note'));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('moves the keyboard to the import control when the import alert is dismissed', async () => {
    await renderLegacyApp();

    await selectFiles(fileInput(), [
      new File(['not json at all'], 'vault.json', { type: 'application/json' }),
    ]);
    await waitFor(() => alertText().includes('import failed'));

    const dismiss = buttonByName('Dismiss');
    dismiss.focus();
    await click(dismiss);

    await waitFor(() => document.activeElement !== document.body);
    expect(document.activeElement).toBe(buttonByName('Import Markdown'));
  });

  it('reports a file that cannot be read and leaves the vault unchanged', async () => {
    await renderLegacyApp();
    const before = noteNames();

    await selectFiles(fileInput(), [
      { name: 'x.md', size: 1, text: () => Promise.reject(new Error('gone')) },
    ]);

    await waitFor(() => alertText().includes('import failed'));
    expect(noteNames()).toEqual(before);
  });

  it('names at most five skipped files in the status line', async () => {
    await renderLegacyApp();

    const files = Array.from(
      { length: 10 },
      (_, index) => new File(['x'], `file-${index}.pdf`, { type: 'application/pdf' }),
    );
    await selectFiles(fileInput(), files);

    expect(statusText()).toContain('file-0.pdf');
    expect(statusText()).toContain('and 5 more');
    expect(statusText()).not.toContain('file-9.pdf');
  });

  it('imports a vault envelope that is larger than the Markdown file limit', async () => {
    await renderLegacyApp();

    const envelope = JSON.stringify({
      app: 'lattice-notes',
      formatVersion: 1,
      notes: [{ name: 'Big', body: 'x'.repeat(1_200_000) }],
    });
    await selectFiles(fileInput(), [
      new File([envelope], 'vault.json', { type: 'application/json' }),
    ]);

    await waitFor(() => statusText().includes('Imported 1 note'));
    expect(noteNames()).toContain('Big');
  });

  it('imports the admissible notes of an envelope that is far over the note ceiling', async () => {
    await renderLegacyApp();
    const before = noteNames();

    const entries = Array.from({ length: MAX_ENVELOPE_NOTES + 50_000 }, (_, index) => ({
      name: `Note ${index}`,
      body: '',
    }));
    const envelope = JSON.stringify({ app: 'lattice-notes', formatVersion: 1, notes: entries });

    await selectFiles(fileInput(), [
      new File([envelope], 'vault.json', { type: 'application/json' }),
    ]);

    await waitFor(() => statusText().includes(`Imported ${MAX_ENVELOPE_NOTES} notes`));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(noteNames()).toEqual(expect.arrayContaining(before));
  }, 60_000);

  it('imports an envelope whose skip list is longer than the argument limit', async () => {
    await renderLegacyApp();
    const before = noteNames();

    // The skip list is longer than the engine can spread into one call (the
    // limit is between 100 000 and 150 000 arguments here), so a spread merge
    // breaks the whole import instead of importing what it may.
    const entries = Array.from({ length: 200_000 }, (_, index) => ({
      name: `Note ${index}`,
      body: '',
    }));
    const envelope = JSON.stringify({ app: 'lattice-notes', formatVersion: 1, notes: entries });

    await selectFiles(fileInput(), [
      new File([envelope], 'vault.json', { type: 'application/json' }),
    ]);

    await waitFor(() => statusText().includes(`Imported ${MAX_ENVELOPE_NOTES} notes`));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(noteNames()).toEqual(expect.arrayContaining(before));
  }, 120_000);

  it('skips the files beyond the batch limit', async () => {
    await renderLegacyApp();

    const files = Array.from({ length: 501 }, (_, index) => ({
      name: `note-${index}.md`,
      size: 4,
      text: async () => `# note ${index}`,
    }));
    await selectFiles(fileInput(), files);

    await waitFor(() => statusText().includes('over the batch limit'));
    expect(noteNames()).toContain('note-0');
    expect(noteNames()).not.toContain('note-500');
  });
});

describe('compact panels', () => {
  it('turns the notes and the context into panels on a narrow screen', async () => {
    window.innerWidth = 390;
    await renderLegacyApp();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    const toggles = queryAll<HTMLButtonElement>('.workspace__panel-toggle');
    expect(toggles).toHaveLength(2);
    const [notesToggle, contextToggle] = toggles;
    expect(notesToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(contextToggle?.getAttribute('aria-expanded')).toBe('false');

    const notesPanel = document.getElementById(notesToggle?.getAttribute('aria-controls') ?? '');
    const contextPanel = document.getElementById(contextToggle?.getAttribute('aria-controls') ?? '');
    expect(notesPanel).not.toBeNull();
    expect(contextPanel).not.toBeNull();
    expect(notesPanel?.hasAttribute('hidden')).toBe(true);
    expect(contextPanel?.hasAttribute('hidden')).toBe(true);

    notesToggle?.focus();
    await click(notesToggle as Element);

    expect(notesToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(notesPanel?.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).toBe(notesToggle);

    await pressKey(notesPanel as Element, 'Escape');

    expect(notesToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(notesPanel?.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(notesToggle);
  });

  it('keeps both panes visible on a wide screen', async () => {
    window.innerWidth = 1280;
    await renderLegacyApp();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(container.querySelector('.workspace__explorer')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('.workspace__context')?.hasAttribute('hidden')).toBe(false);
  });

  it('keeps an open panel open when Escape comes from a field', async () => {
    window.innerWidth = 390;
    await renderLegacyApp();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    await click(queryAll<HTMLButtonElement>('.workspace__panel-toggle')[0] as Element);
    const input = searchInput();

    await pressKey(input, 'Escape');

    expect(queryAll<HTMLButtonElement>('.workspace__panel-toggle')[0]?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(container.querySelector('.workspace__explorer')?.hasAttribute('hidden')).toBe(false);
  });

  it('opens the notes panel for a search request on a narrow screen', async () => {
    window.innerWidth = 390;
    await renderLegacyApp();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    await runCommand('Search workspace');

    await waitFor(() => document.activeElement === searchInput());
    expect(container.querySelector('.workspace__explorer')?.hasAttribute('hidden')).toBe(false);
  });

  it('opens the notes panel and keeps the keyboard on the row after a delete', async () => {
    window.innerWidth = 390;
    await renderLegacyApp();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    await click(buttonByName('Delete Welcome to Lattice Notes'));

    await waitFor(() => document.activeElement !== document.body);
    expect(container.querySelector('.workspace__explorer')?.hasAttribute('hidden')).toBe(false);
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Getting started');
  });

  it('opens the notes panel and keeps the keyboard on the empty state after the last delete', async () => {
    const created = createNote(createEmptyVault(), 'Only note');
    await saveVault(created.vault);
    window.innerWidth = 390;
    await renderLegacyApp();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    await click(buttonByName('Delete Only note'));

    await waitFor(() => document.activeElement !== document.body);
    expect(container.querySelector('.workspace__explorer')?.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).toBe(buttonByName('Create first note'));
  });

  it('keeps the keyboard on the restored row after an undo', async () => {
    window.innerWidth = 390;
    await renderLegacyApp();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    await click(buttonByName('Delete Welcome to Lattice Notes'));

    // The panel is open after the delete; close it again, so the undo asks
    // for a focus target inside a collapsed panel.
    const toggles = queryAll<HTMLButtonElement>('.workspace__panel-toggle');
    await click(toggles[0] as Element);
    expect(container.querySelector('.workspace__explorer')?.hasAttribute('hidden')).toBe(true);

    const undo = buttonByName('Undo delete');
    undo.focus();
    await click(undo);

    await waitFor(() => document.activeElement !== document.body);
    expect(container.querySelector('.workspace__explorer')?.hasAttribute('hidden')).toBe(false);
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe(
      'Welcome to Lattice Notes',
    );
  });

  it('closes the panel that holds the keyboard on Escape', async () => {
    window.innerWidth = 390;
    await renderLegacyApp();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    const toggles = queryAll<HTMLButtonElement>('.workspace__panel-toggle');
    await click(toggles[0] as Element);
    await click(toggles[1] as Element);

    const row = container.querySelector<HTMLButtonElement>('.explorer__note');
    if (!row) throw new Error('no note row');
    row.focus();
    await pressKey(row, 'Escape');

    expect(toggles[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(toggles[1]?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggles[0]);
  });
});

describe('keyboard focus', () => {
  it('focuses the rename field and returns focus to the note on cancel', async () => {
    await renderLegacyApp();

    await click(buttonByName('Rename Welcome to Lattice Notes'));
    const input = container.querySelector<HTMLInputElement>('.explorer__rename-input');
    if (!input) throw new Error('no rename input');

    expect(document.activeElement).toBe(input);

    await pressKey(input, 'Escape');

    expect(document.activeElement?.textContent).toBe('Welcome to Lattice Notes');
  });

  it('returns focus to the note after a rename is committed', async () => {
    await renderLegacyApp();

    await click(buttonByName('Rename Welcome to Lattice Notes'));
    const input = container.querySelector<HTMLInputElement>('.explorer__rename-input');
    if (!input) throw new Error('no rename input');
    await fill(input, 'Welcome');
    await pressKey(input, 'Enter');

    expect(document.activeElement?.textContent).toBe('Welcome');
  });

  it('moves focus to the surviving note after a delete', async () => {
    await renderLegacyApp();

    await click(buttonByName('Delete Welcome to Lattice Notes'));

    expect(document.activeElement?.textContent).toBe('Getting started');
  });

  it('keeps the keyboard in the editor when a note is created with Ctrl/Cmd+N', async () => {
    await renderLegacyApp();
    editorTextarea().focus();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(document.activeElement).toBe(editorTextarea());
  });

  it('moves focus to the empty state after the last note is deleted', async () => {
    const created = createNote(createEmptyVault(), 'Only note');
    await saveVault(created.vault);
    await renderLegacyApp();

    await click(buttonByName('Delete Only note'));

    expect(document.activeElement).toBe(buttonByName('Create first note'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('keeps the keyboard on the new note row when the empty state creates a note', async () => {
    const created = createNote(createEmptyVault(), 'Only note');
    await saveVault(created.vault);
    await renderLegacyApp();

    await click(buttonByName('Delete Only note'));
    expect(document.activeElement).toBe(buttonByName('Create first note'));

    await click(buttonByName('Create first note'));

    await waitFor(() => document.activeElement !== document.body);
    expect(document.activeElement).toBe(container.querySelector('.explorer__note'));
    expect(document.activeElement?.textContent).toBe('Untitled');
  });

  it('keeps the keyboard on the new note row on a narrow screen', async () => {
    const created = createNote(createEmptyVault(), 'Only note');
    await saveVault(created.vault);
    window.innerWidth = 390;
    await renderLegacyApp();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    await click(queryAll<HTMLButtonElement>('.workspace__panel-toggle')[0] as Element);

    await click(buttonByName('Delete Only note'));
    expect(document.activeElement).toBe(buttonByName('Create first note'));

    await click(buttonByName('Create first note'));

    await waitFor(() => document.activeElement !== document.body);
    expect(document.activeElement).toBe(container.querySelector('.explorer__note'));
  });

  it('keeps the keyboard in the note list when a note is opened', async () => {
    await renderLegacyApp();
    const row = container.querySelectorAll<HTMLButtonElement>('.explorer__note')[1];
    if (!row) throw new Error('no second note row');
    row.focus();

    await click(row);

    expect(document.activeElement).toBe(row);
    expect(document.activeElement).not.toBe(editorTextarea());
  });

  it('keeps the keyboard on the search result that was opened', async () => {
    const first = createNote(createEmptyVault(), 'Roadmap', 'Plan the release.');
    const second = createNote(first.vault, 'Backlog', 'Nothing here yet.');
    await saveVault({ ...second.vault, activeNoteId: first.note.id });
    await renderLegacyApp();
    await fill(searchInput(), 'Roadmap');
    const result = container.querySelector<HTMLButtonElement>('.search__result');
    result?.focus();

    await click(result as Element);

    expect(document.activeElement).toBe(result);
  });
});

describe('unreadable storage', () => {
  it('offers a retry that replaces the unreadable vault with the tab notes', async () => {
    await storeUnreadableDocument();

    await renderLegacyApp();
    expect(alertText()).toContain('Local storage');

    await click(buttonByName('Create first note'));
    await click(buttonByName('Retry'));

    await waitFor(() => alertText().includes('replaces the unreadable vault'));

    await click(buttonByName('Retry'));

    await waitFor(async () => (await readRawDocument()).version === 1);
    const stored = await readRawDocument();
    expect(stored.vault.notes.map((note) => note.name)).toEqual(['Untitled']);
  });

  it('never writes over a vault it could not read', async () => {
    await storeUnreadableDocument();

    await renderLegacyApp();
    await click(buttonByName('Create first note'));
    await fill(editorTextarea(), 'edited body');
    await sleep(600);

    expect((await readRawDocument()).version).toBe(2);
    expect(alertText()).toContain('Local storage');
  });

  it('refuses to write an empty tab over the unreadable vault', async () => {
    await storeUnreadableDocument();

    await renderLegacyApp();
    await click(buttonByName('Retry'));
    await waitFor(() => alertText().includes('replaces the unreadable vault'));

    await click(buttonByName('Retry'));

    await waitFor(() => alertText().includes('no notes'));
    expect((await readRawDocument()).version).toBe(2);
  });

  it('refuses to overwrite a vault that became readable again', async () => {
    await storeUnreadableDocument();

    await renderLegacyApp();
    await click(buttonByName('Create first note'));
    await click(buttonByName('Retry'));
    await waitFor(() => alertText().includes('replaces the unreadable vault'));

    const recovered = createNote(createEmptyVault(), 'Recovered note');
    await writeRawDocument({ version: 1, vault: recovered.vault });

    await click(buttonByName('Retry'));

    await waitFor(() => alertText().includes('readable again'));
    const stored = await readRawDocument();
    expect(stored.version).toBe(1);
    expect(stored.vault.notes.map((note) => note.name)).toEqual(['Recovered note']);
  });

  it('does not promise a save when the stored vault becomes readable before the retry', async () => {
    await storeUnreadableDocument();

    await renderLegacyApp();
    await click(buttonByName('Create first note'));

    // The stored document becomes readable before the first retry, so the
    // retry takes the load branch.
    const recovered = createNote(createEmptyVault(), 'Recovered note');
    await writeRawDocument({ version: 1, vault: recovered.vault });

    await click(buttonByName('Retry'));

    await waitFor(() => alertText().includes('readable again'));
    expect(alertText()).not.toContain('Retry saves');
    expect(alertText()).toContain('Export the notes of this tab');

    await click(buttonByName('Retry'));

    const stored = await readRawDocument();
    expect(stored.vault.notes.map((note) => note.name)).toEqual(['Recovered note']);
  });

  it('keeps saving after a retry restores the stored vault', async () => {
    await storeUnreadableDocument();

    await renderLegacyApp();
    await click(buttonByName('Retry'));
    await waitFor(() => alertText().includes('replaces the unreadable vault'));

    // The document becomes readable before the retry, so the tab keeps the
    // stored vault instead of replacing it with its own notes.
    const recovered = createNote(createEmptyVault(), 'Recovered note');
    await writeRawDocument({
      version: 1,
      vault: { ...recovered.vault, activeNoteId: recovered.note.id },
    });

    await click(buttonByName('Retry'));
    await waitFor(() => statusText().includes('restored'));

    await fill(editorTextarea(), 'edited after recovery');
    await sleep(600);

    const stored = await readRawDocument();
    expect(stored.vault.notes[0]?.body).toBe('edited after recovery');
  });

  it('replaces the unreadable stored vault with the notes of this tab', async () => {
    const { vault } = createNote(createEmptyVault(), 'Stored note');
    const created = await createStoredVault('Work', vault);
    const id = created.catalog.activeVaultId;
    // The catalog stays valid, but the document of the active vault is
    // unreadable.
    await writeRaw(`vault:${id}`, { version: 2, vault });

    await renderApp();
    await click(buttonByName('Create first note'));
    await click(buttonByName('Retry'));
    await waitFor(() => alertText().includes('replaces the unreadable vault'));
    await click(buttonByName('Retry'));

    await waitFor(async () => {
      try {
        return (await loadVault(id))?.notes.some((note) => note.name === 'Untitled') ?? false;
      } catch {
        // The document is still the unreadable one until the recovery lands.
        return false;
      }
    });
    // The notes are in the vault the user is in, and the legacy key stays
    // untouched.
    expect(await loadVault('current')).toBeNull();
    expect((await loadCatalog())?.activeVaultId).toBe(id);
    // The name of the vault and the manager are back without a reload.
    await waitFor(() => container.querySelector('.workspace__vault-label') !== null);
    expect(container.querySelector('.workspace__vault-label')?.textContent).toBe('Work');
  });

  it('keeps saving after a retry replaces the unreadable vault', async () => {
    await storeUnreadableDocument();

    await renderLegacyApp();
    await click(buttonByName('Create first note'));
    await click(buttonByName('Retry'));
    await waitFor(() => alertText().includes('replaces the unreadable vault'));

    await click(buttonByName('Retry'));
    await waitFor(async () => (await readRawDocument()).version === 1);

    await fill(editorTextarea(), 'second body');
    await sleep(600);

    const stored = await readRawDocument();
    expect(stored.vault.notes[0]?.body).toBe('second body');
  });
});

describe('search', () => {
  async function renderRoadmap(): Promise<void> {
    const first = createNote(createEmptyVault(), 'Roadmap', 'Plan the release.');
    const second = createNote(first.vault, 'Backlog', 'Nothing here yet.');
    await saveVault({ ...second.vault, activeNoteId: first.note.id });
    await renderLegacyApp();
  }

  it('opens a note found by its title', async () => {
    await renderRoadmap();

    await fill(searchInput(), 'Roadmap');

    const result = container.querySelector('.search__result');
    expect(result?.textContent).toContain('Roadmap');
    expect(statusText()).toContain('1 result for “Roadmap”');

    await click(result as Element);

    expect(noteTitle()).toBe('Roadmap');
  });

  it('shows the snippet of a note found by its body', async () => {
    await renderRoadmap();

    await fill(searchInput(), 'release');

    const result = container.querySelector('.search__result');
    expect(result?.textContent).toContain('Roadmap');
    expect(result?.querySelector('.search__snippet')?.textContent).toContain('Plan the release');
  });

  it('echoes a query with no matches and clears it', async () => {
    await renderRoadmap();

    await fill(searchInput(), 'zzz absent');

    expect(container.querySelector('.search__empty')?.textContent).toContain('zzz absent');
    expect(statusText()).toContain('No results for “zzz absent”');

    await click(buttonByName('Clear search'));

    expect(searchInput().value).toBe('');
    expect(container.querySelector('.search__empty')).toBeNull();
  });

  it('never returns a deleted note', async () => {
    const created = createNote(createEmptyVault(), 'Roadmap', 'Plan the release.');
    await saveVault(deleteNote(created.vault, created.note.id).vault);

    await renderLegacyApp();
    await fill(searchInput(), 'Roadmap');

    expect(container.querySelector('.search__result')).toBeNull();
    expect(container.querySelector('.search__empty')?.textContent).toContain('Roadmap');
  });

  it('focuses the search field with the search command', async () => {
    await renderRoadmap();
    editorTextarea().focus();

    await runCommand('Search workspace');

    expect(document.activeElement).toBe(searchInput());
  });
});

describe('command palette', () => {
  it('opens with Ctrl+K, takes the keyboard, and closes with Escape', async () => {
    await renderLegacyApp();

    await openPalette();

    expect(paletteDialog().hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(paletteInput());

    await pressKey(paletteInput(), 'Escape');

    expect(paletteDialog().hasAttribute('open')).toBe(false);
  });

  it('returns focus to the trigger when it closes', async () => {
    await renderLegacyApp();
    const trigger = buttonByName('Commands');
    trigger.focus();

    await click(trigger);
    expect(paletteDialog().hasAttribute('open')).toBe(true);

    await pressKey(paletteInput(), 'Escape');

    expect(document.activeElement).toBe(trigger);
  });

  it('runs the New note command', async () => {
    await renderLegacyApp();
    const before = noteNames().length;

    await openPalette();
    const option = paletteOptions().find((element) => element.textContent?.includes('New note'));
    await click(option as Element);

    expect(noteNames()).toHaveLength(before + 1);
    expect(noteTitle()).toBe('Untitled');
    expect(statusText()).toContain('Created');
    expect(paletteDialog().hasAttribute('open')).toBe(false);
  });

  it('opens a note with the quick switcher', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'Body one.');
    const second = createNote(first.vault, 'Beta', 'Body two.');
    await saveVault({ ...second.vault, activeNoteId: first.note.id });
    await renderLegacyApp();

    await openSwitcher();
    await fill(switcherInput(), 'Beta');

    const options = switcherOptions();
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Beta');

    await pressKey(switcherInput(), 'Enter');

    expect(noteTitle()).toBe('Beta');
    expect(switcherDialog().hasAttribute('open')).toBe(false);
  });

  it('moves the active option with the arrow keys', async () => {
    await renderLegacyApp();

    await openPalette();
    expect(paletteOptions().length).toBeGreaterThan(2);

    await pressKey(paletteInput(), 'ArrowDown');
    expect(paletteInput().getAttribute('aria-activedescendant')).toContain('option-1');

    await pressKey(paletteInput(), 'ArrowUp');
    expect(paletteInput().getAttribute('aria-activedescendant')).toContain('option-0');
  });

  it('names the palette field and says whether it has options', async () => {
    await renderLegacyApp();

    await openPalette();

    expect(paletteInput().getAttribute('aria-label')).toBe('Search commands');
    expect(paletteInput().getAttribute('aria-expanded')).toBe('true');

    await fill(paletteInput(), 'zzz absent');

    expect(paletteInput().getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps a command that cannot run and says why', async () => {
    const created = createNote(createEmptyVault(), 'Only note');
    await saveVault({ ...created.vault, activeNoteId: null });
    await renderLegacyApp();

    await openPalette();

    const rename = paletteOptions().find((element) => element.textContent?.includes('Rename note'));
    expect(rename?.textContent).toContain('Open a note first');
    expect(rename?.getAttribute('aria-disabled')).toBe('true');
  });

  it('does not create a note behind the open palette', async () => {
    await renderLegacyApp();
    const before = noteNames().length;

    await openPalette();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(noteNames()).toHaveLength(before);
    expect(paletteDialog().hasAttribute('open')).toBe(true);
  });

  it('keeps a single polite live region with the palette open', async () => {
    await renderLegacyApp();

    await openPalette();
    await fill(searchInput(), 'Getting');

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});

describe('preview links', () => {
  it('opens an external link in a new tab and keeps an internal link in the same tab', async () => {
    const created = createNote(
      createEmptyVault(),
      'Links',
      'Internal [plan](notes/plan.md) and external [site](https://example.com/page).',
    );
    await saveVault({ ...created.vault, activeNoteId: created.note.id });

    await renderLegacyApp();
    const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>('.preview__body a'));
    expect(anchors).toHaveLength(2);

    const [internal, external] = anchors;
    expect(internal?.getAttribute('href')).toBe('notes/plan.md');
    expect(internal?.getAttribute('target')).toBeNull();
    expect(external?.getAttribute('href')).toBe('https://example.com/page');
    expect(external?.getAttribute('target')).toBe('_blank');
    expect(external?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('linked notes', () => {
  it('creates a missing wiki target once and selects it', async () => {
    const created = createNote(createEmptyVault(), 'Alpha', 'See [[Ghost]] now.');
    await saveVault({ ...created.vault, activeNoteId: created.note.id });
    await renderLegacyApp();

    await click(container.querySelector('.preview__wikilink') as Element);

    expect(noteNames()).toEqual(['Alpha', 'Ghost']);
    expect(noteTitle()).toBe('Ghost');
    expect(statusText()).toContain('Created Ghost');

    await click(buttonByName('Alpha'));
    await click(container.querySelector('.preview__wikilink') as Element);

    expect(noteNames()).toEqual(['Alpha', 'Ghost']);
    expect(noteTitle()).toBe('Ghost');
  });

  it('keeps the keyboard in the note it opened', async () => {
    const created = createNote(createEmptyVault(), 'Alpha', 'See [[Ghost]] now.');
    await saveVault({ ...created.vault, activeNoteId: created.note.id });
    await renderLegacyApp();

    await click(container.querySelector('.preview__wikilink') as Element);

    expect(document.activeElement).toBe(editorTextarea());
  });

  it('lists the backlinks of the active note and opens one', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'See [[Beta]] now.');
    const second = createNote(first.vault, 'Beta', 'Beta body.');
    await saveVault({ ...second.vault, activeNoteId: second.note.id });
    await renderLegacyApp();

    // The graph follows the vault at background priority, so it settles later.
    await waitFor(
      () =>
        container
          .querySelector('nav[aria-label="Backlinks"]')
          ?.textContent?.includes('Alpha') === true,
    );

    const nav = container.querySelector('nav[aria-label="Backlinks"]');
    expect(nav?.textContent).toContain('Alpha');

    await click(nav?.querySelector('button') as Element);

    expect(noteTitle()).toBe('Alpha');
    expect(document.activeElement).toBe(editorTextarea());
  });

  it('does not claim there are no backlinks while the graph is still settling', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'See [[Beta]] now.');
    const second = createNote(first.vault, 'Beta', 'Beta body.');
    await saveVault({ ...second.vault, activeNoteId: second.note.id });
    await renderLegacyApp();

    // Sample the section while the deferred graph settles: it may show the
    // pending state, but it must never claim there are no backlinks.
    const samples: string[] = [];
    await waitFor(() => {
      const text = container.querySelector('nav[aria-label="Backlinks"]')?.textContent ?? '';
      if (text) samples.push(text);
      return text.includes('Alpha');
    });

    expect(samples).not.toHaveLength(0);
    for (const sample of samples) {
      expect(sample).not.toContain('No backlinks yet.');
    }

    expect(container.querySelector('nav[aria-label="Backlinks"]')?.textContent).toContain(
      'Alpha',
    );
  });

  it('shows the genuine empty state once the graph has settled', async () => {
    const created = createNote(createEmptyVault(), 'Solo', 'Nothing links here.');
    await saveVault({ ...created.vault, activeNoteId: created.note.id });
    await renderLegacyApp();

    await waitFor(
      () =>
        container
          .querySelector('nav[aria-label="Backlinks"]')
          ?.textContent?.includes('No backlinks yet.') === true,
    );

    expect(container.querySelector('nav[aria-label="Backlinks"]')?.textContent).toContain(
      'No backlinks yet.',
    );
    expect(container.querySelector('.graph__empty')?.textContent).toContain(
      'No local connections yet',
    );
  });

  it('lists the outgoing links and offers to create the missing one', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'See [[Beta]] and [[Ghost]].');
    const second = createNote(first.vault, 'Beta', 'Beta body.');
    await saveVault({ ...second.vault, activeNoteId: first.note.id });
    await renderLegacyApp();

    const links = container.querySelector('.context__links');
    expect(links?.textContent).toContain('Beta');
    expect(links?.textContent).toContain('Create “Ghost”');

    const create = Array.from(links?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (button) => button.textContent?.includes('Create'),
    );
    await click(create as Element);

    expect(noteNames()).toEqual(['Alpha', 'Beta', 'Ghost']);
    expect(noteTitle()).toBe('Ghost');
  });

  it('draws the local graph and opens a node', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'See [[Beta]].');
    const second = createNote(first.vault, 'Beta', 'See [[Alpha]].');
    await saveVault({ ...second.vault, activeNoteId: first.note.id });
    await renderLegacyApp();

    await waitFor(() => container.querySelector('.graph__node') !== null);

    expect(container.querySelectorAll('.graph__node')).toHaveLength(2);
    expect(container.querySelectorAll('.graph__edge')).toHaveLength(2);
    expect(container.querySelector('.graph__node[aria-current="true"]')).not.toBeNull();

    await click(container.querySelector('.graph__list button') as Element);

    expect(noteTitle()).toBe('Beta');
  });

  it('keeps the keyboard in the note a graph neighbour opens', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'See [[Beta]].');
    const second = createNote(first.vault, 'Beta', 'See [[Alpha]].');
    await saveVault({ ...second.vault, activeNoteId: first.note.id });
    await renderLegacyApp();

    await waitFor(() => container.querySelector('.graph__list button') !== null);
    const button = container.querySelector<HTMLButtonElement>('.graph__list button');
    if (!button) throw new Error('no graph neighbour button');
    button.focus();

    await click(button);

    expect(noteTitle()).toBe('Beta');
    expect(document.activeElement).toBe(editorTextarea());
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('toolbar and views', () => {
  function filesDisclosure(): HTMLDetailsElement {
    const found = container.querySelector<HTMLDetailsElement>('details.workspace__files');
    if (!found) throw new Error('no files disclosure');
    return found;
  }

  function noteDisclosure(index = 0): HTMLDetailsElement {
    const found = container.querySelectorAll<HTMLDetailsElement>('details.explorer__actions')[index];
    if (!found) throw new Error('no note disclosure');
    return found;
  }

  function viewRadio(value: string): HTMLInputElement {
    const found = container.querySelector<HTMLInputElement>(
      `input[name="workspace-view"][value="${value}"]`,
    );
    if (!found) throw new Error(`no ${value} radio`);
    return found;
  }

  it('shows the product name and the primary actions in the toolbar', async () => {
    await renderLegacyApp();

    const toolbar = container.querySelector('.workspace__toolbar');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelector('h1')?.textContent).toBe('Lattice Notes');
    expect(buttonByName('New note')).not.toBeNull();
    expect(buttonByName('Commands')).not.toBeNull();
    expect(filesDisclosure().querySelector('summary')?.textContent).toBe('Files');
    expect(buttonByName('Import Markdown')).not.toBeNull();
    expect(buttonByName('Export vault')).not.toBeNull();
  });

  it('opens the files disclosure and closes it with Escape', async () => {
    await renderLegacyApp();
    const files = filesDisclosure();
    const summary = files.querySelector('summary') as HTMLElement;

    summary.focus();
    await click(summary);
    expect(files.open).toBe(true);

    await pressKey(summary, 'Escape');

    expect(files.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('closes the files disclosure after an action and gives the keyboard back to the summary', async () => {
    await renderLegacyApp();
    const files = filesDisclosure();
    const summary = files.querySelector('summary') as HTMLElement;
    await click(summary);
    expect(files.open).toBe(true);

    await click(buttonByName('Import Markdown'));

    expect(files.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('puts the rename and delete actions behind a per-note disclosure', async () => {
    await renderLegacyApp();

    const disclosure = noteDisclosure();
    expect(disclosure.querySelector('summary')?.textContent).toBe('Actions');
    expect(disclosure.querySelector('summary')?.getAttribute('aria-label')).toBe(
      'Actions for Welcome to Lattice Notes',
    );
    expect(disclosure.querySelector('button')?.textContent).toBe('Rename');
    // The whole title stays in the row, so it never has to be cut short.
    expect(container.querySelector('.explorer__note')?.textContent).toBe('Welcome to Lattice Notes');
  });

  it('renames a note through the per-note disclosure', async () => {
    await renderLegacyApp();
    const disclosure = noteDisclosure();
    await click(disclosure.querySelector('summary') as Element);
    expect(disclosure.open).toBe(true);

    await click(buttonByName('Rename Welcome to Lattice Notes'));

    // The disclosure closes on the action, so the menu is not left open
    // over the note list.
    expect(disclosure.open).toBe(false);

    const input = container.querySelector<HTMLInputElement>('.explorer__rename-input');
    if (!input) throw new Error('no rename input');
    await fill(input, 'Renamed');
    await pressKey(input, 'Enter');

    expect(noteNames()).toContain('Renamed');
    expect(statusText()).toContain('Renamed');
  });

  it('closes the per-note disclosure when a note is deleted', async () => {
    await renderLegacyApp();
    const disclosure = noteDisclosure();
    await click(disclosure.querySelector('summary') as Element);
    expect(disclosure.open).toBe(true);

    await click(buttonByName('Delete Welcome to Lattice Notes'));

    expect(disclosure.open).toBe(false);
    expect(noteNames()).not.toContain('Welcome to Lattice Notes');
  });

  it('closes the per-note disclosure with Escape and gives the keyboard back to the summary', async () => {
    await renderLegacyApp();
    const disclosure = noteDisclosure();
    const summary = disclosure.querySelector('summary') as HTMLElement;
    await click(summary);
    expect(disclosure.open).toBe(true);

    await pressKey(summary, 'Escape');

    expect(disclosure.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('shows the active note title and the view modes in the header', async () => {
    await renderLegacyApp();

    expect(container.querySelector('.workspace__doc-title')?.textContent).toBe(
      'Welcome to Lattice Notes',
    );
    const radios = queryAll<HTMLInputElement>('input[name="workspace-view"]');
    expect(radios.map((radio) => radio.value)).toEqual(['write', 'split', 'read']);
  });

  it('defaults to split on a wide screen and to write on a narrow one', async () => {
    await renderLegacyApp();
    expect(viewRadio('split').checked).toBe(true);

    window.innerWidth = 390;
    await remountApp();
    expect(viewRadio('write').checked).toBe(true);
  });

  it('keeps the note text when the view changes', async () => {
    await renderLegacyApp();
    await fill(editorTextarea(), 'kept body');

    // The writer's place in the text is a part of the draft.
    const textarea = editorTextarea();
    textarea.setSelectionRange(4, 8);
    const field = textarea;

    await click(viewRadio('read'));

    expect(container.querySelector('.editor')?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('.preview')?.hasAttribute('hidden')).toBe(false);
    expect(editorTextarea().value).toBe('kept body');

    await click(viewRadio('write'));

    expect(container.querySelector('.preview')?.hasAttribute('hidden')).toBe(true);
    expect(editorTextarea().value).toBe('kept body');
    // The same field, with the same selection, so the caret is not reset.
    expect(editorTextarea()).toBe(field);
    expect(editorTextarea().selectionStart).toBe(4);
    expect(editorTextarea().selectionEnd).toBe(8);
  });

  it('puts the keyboard on the visible content when the graph picture opens a note in read mode', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'See [[Beta]].');
    const second = createNote(first.vault, 'Beta', 'See [[Alpha]].');
    await saveVault({ ...second.vault, activeNoteId: first.note.id });
    await renderLegacyApp();
    await waitFor(() => container.querySelector('.graph__node') !== null);

    await click(viewRadio('read'));
    const node = container.querySelectorAll('.graph__node')[1];
    if (!node) throw new Error('no graph node');

    await click(node);

    expect(noteTitle()).toBe('Beta');
    // The picture opens the note like the list does, so the keyboard lands on
    // the content that is on the screen and not on a hidden field.
    expect(document.activeElement).toBe(container.querySelector('.preview'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('keeps the scroll offset of the editor and the preview across a view change', async () => {
    await renderLegacyApp();
    const textarea = editorTextarea();

    textarea.scrollTop = 250;
    await click(viewRadio('read'));
    // A browser drops the offset of a box it takes off the screen, so the
    // app has to put it back when the box returns.
    textarea.scrollTop = 0;
    await click(viewRadio('write'));

    expect(textarea.scrollTop).toBe(250);
  });

  it('keeps the scroll offset of the preview across a view change', async () => {
    await renderLegacyApp();
    const preview = container.querySelector('.preview') as HTMLElement;
    if (!preview) throw new Error('no preview');

    preview.scrollTop = 120;
    await click(viewRadio('write'));
    preview.scrollTop = 0;
    await click(viewRadio('split'));

    expect(preview.scrollTop).toBe(120);
  });

  it('follows a wiki link in read mode and puts the keyboard on the visible content', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'See [[Beta]] now.');
    const second = createNote(first.vault, 'Beta', 'Beta body.');
    await saveVault({ ...second.vault, activeNoteId: first.note.id });
    await renderLegacyApp();

    await click(viewRadio('read'));
    await click(container.querySelector('.preview__wikilink') as Element);

    expect(noteTitle()).toBe('Beta');
    expect(document.activeElement).toBe(container.querySelector('.preview'));
    expect(document.activeElement).not.toBe(editorTextarea());
  });

  it('creates a missing wiki target in read mode and keeps the keyboard on the visible content', async () => {
    const created = createNote(createEmptyVault(), 'Alpha', 'See [[Ghost]] now.');
    await saveVault({ ...created.vault, activeNoteId: created.note.id });
    await renderLegacyApp();

    await click(viewRadio('read'));
    await click(container.querySelector('.preview__wikilink') as Element);

    expect(noteTitle()).toBe('Ghost');
    expect(document.activeElement).toBe(container.querySelector('.preview'));
  });

  it('puts the keyboard on the visible content when a backlink opens a note in read mode', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'See [[Beta]] now.');
    const second = createNote(first.vault, 'Beta', 'Beta body.');
    await saveVault({ ...second.vault, activeNoteId: second.note.id });
    await renderLegacyApp();
    await waitFor(() => container.querySelector('nav[aria-label="Backlinks"] button') !== null);

    await click(viewRadio('read'));
    await click(container.querySelector('nav[aria-label="Backlinks"] button') as Element);

    expect(noteTitle()).toBe('Alpha');
    expect(document.activeElement).toBe(container.querySelector('.preview'));
  });

  it('puts the keyboard on the visible content when the graph opens a note in read mode', async () => {
    const first = createNote(createEmptyVault(), 'Alpha', 'See [[Beta]].');
    const second = createNote(first.vault, 'Beta', 'See [[Alpha]].');
    await saveVault({ ...second.vault, activeNoteId: first.note.id });
    await renderLegacyApp();
    await waitFor(() => container.querySelector('.graph__list button') !== null);

    await click(viewRadio('read'));
    await click(container.querySelector('.graph__list button') as Element);

    expect(noteTitle()).toBe('Beta');
    expect(document.activeElement).toBe(container.querySelector('.preview'));
  });

  it('opens the command palette on a narrow screen while the notes panel is closed', async () => {
    window.innerWidth = 390;
    await renderLegacyApp();
    expect(container.querySelector('.workspace__explorer')?.hasAttribute('hidden')).toBe(true);

    await click(buttonByName('Commands'));

    expect(paletteDialog().hasAttribute('open')).toBe(true);
  });
});

describe('first use', () => {
  function onboardingName(): HTMLInputElement {
    const found = container.querySelector<HTMLInputElement>('#onboarding-name');
    if (!found) throw new Error('no onboarding name field');
    return found;
  }

  async function submitOnboarding(): Promise<void> {
    const form = container.querySelector('form.onboarding__form');
    if (!form) throw new Error('no onboarding form');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }

  it('welcomes a genuine first use instead of a seeded vault', async () => {
    await renderApp();

    expect(container.querySelector('.onboarding')).not.toBeNull();
    expect(container.querySelector('.workspace')).toBeNull();
    // Nothing is created behind the user's back.
    expect(container.textContent).not.toContain('Welcome to Lattice Notes');
    expect(await loadCatalog()).toBeNull();
  });

  it('creates the vault once and puts the keyboard on the content', async () => {
    await renderApp();

    await click(container.querySelector('input[value="example"]') as Element);
    await submitOnboarding();

    await waitFor(() => container.querySelector('.workspace') !== null);
    expect(noteNames()).toContain('Welcome to Lattice Notes');
    await waitFor(() => document.activeElement === editorTextarea());

    const catalog = await loadCatalog();
    expect(catalog?.vaults).toHaveLength(1);
  });

  it('never shows the onboarding to a user whose notes are already stored', async () => {
    await saveVault(createSeedVault());
    await renderApp();

    expect(container.querySelector('.onboarding')).toBeNull();
    expect(container.querySelector('.workspace')).not.toBeNull();
    expect(noteNames()).toContain('Welcome to Lattice Notes');
  });

  it('shows an actionable error for a corrupt catalog and never the first use', async () => {
    await writeRawCatalog({ version: 1, activeVaultId: 'gone', vaults: 'not a list' });
    await renderApp();

    expect(container.querySelector('.onboarding')).toBeNull();
    expect(alertText()).toContain('Local storage');
    expect(buttonByName('Retry')).not.toBeNull();
    // Nothing was seeded and nothing was created.
    expect(noteNames()).toHaveLength(0);
    // The broken catalog is left as it is.
    await expect(loadCatalog()).rejects.toThrow('unreadable');
  });

  it('restores a backup into a new vault on the first use', async () => {
    const envelope = JSON.stringify({
      app: 'lattice-notes',
      formatVersion: 1,
      notes: [{ name: 'Kept', body: '# kept body', createdAt: '2024-01-02T03:04:05.000Z' }],
    });

    await renderApp();
    await click(container.querySelector('input[value="restore"]') as Element);
    const file = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!file) throw new Error('no backup input');
    Object.defineProperty(file, 'files', {
      configurable: true,
      value: [new File([envelope], 'vault.json', { type: 'application/json' })],
    });
    await act(async () => {
      file.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await fill(onboardingName(), 'Restored');
    await submitOnboarding();

    await waitFor(() => container.querySelector('.workspace') !== null);
    expect(noteNames()).toEqual(['Kept']);
    expect(container.querySelector('.preview__body')?.textContent).toContain('kept body');
  });
});

describe('guarded vault lifecycle', () => {
  it('writes the open vault before another one is opened', async () => {
    await renderLegacyApp();
    await storeSecondVault();

    await fill(editorTextarea(), 'body of A');
    await openVaultManager();
    await clickManagerButton('Open Second vault');

    await waitFor(() => noteTitle() === 'Only in B');
    const stored = await loadVault('current');
    expect(stored?.notes.some((note) => note.body === 'body of A')).toBe(true);
  });

  it('keeps the notes of two vaults apart', async () => {
    await renderLegacyApp();
    await storeSecondVault();

    await fill(editorTextarea(), 'body of A');
    await openVaultManager();
    await clickManagerButton('Open Second vault');
    await waitFor(() => noteTitle() === 'Only in B');

    expect(editorTextarea().value).toBe('body of B');

    await openVaultManager();
    await clickManagerButton('Open My vault');
    await waitFor(() => noteTitle() === 'Welcome to Lattice Notes');

    expect(editorTextarea().value).toBe('body of A');
  });

  it('keeps the vaults apart after a reload', async () => {
    await renderLegacyApp();
    await storeSecondVault();

    await fill(editorTextarea(), 'body of A');
    await openVaultManager();
    await clickManagerButton('Open Second vault');
    await waitFor(() => noteTitle() === 'Only in B');
    await remountApp();

    expect(noteTitle()).toBe('Only in B');
    expect(editorTextarea().value).toBe('body of B');
  });

  it('never marks the new vault as saved when the write of the old one lands late', async () => {
    await renderLegacyApp();
    const second = await storeSecondVault();
    // The first write is quick, the flush of the switch waits and the write
    // of the last edit waits the longest, so it lands after the switch.
    storage.delays.set('current', [0, 300, 400]);

    await fill(editorTextarea(), 'draft one');
    await sleep(250);
    await fill(editorTextarea(), 'draft two');
    await sleep(50);

    await openVaultManager();
    await clickManagerButton('Open Second vault');
    // The writer keeps typing while the switch is running.
    await sleep(50);
    await fill(editorTextarea(), 'draft three');

    await waitFor(() => noteTitle() === 'Only in B');
    await waitFor(() => storage.writes.filter((write) => write.key === 'current').length >= 3);
    await sleep(600);

    expect(statusText()).toContain('Opened');
    expect(statusText()).not.toContain('Saved to local storage');
    // The late write went to the vault it belongs to and not to the new one.
    const storedSecond = await loadVault(second);
    expect(storedSecond?.notes.some((note) => note.body.includes('draft'))).toBe(false);
  });

  it('runs two switches one after the other and keeps the last request', async () => {
    await renderLegacyApp();
    const second = await storeSecondVault();
    await storeThirdVault();
    storage.readDelays.set(second, 120);

    await openVaultManager();
    await clickManagerButton('Open Second vault');
    await clickManagerButton('Open Third vault');

    await waitFor(() => noteTitle() === 'Only in C');
    expect(statusText()).toContain('Third vault');
  });

  it('keeps the open vault and its draft when the source cannot be written', async () => {
    await renderLegacyApp();
    await storeSecondVault();
    storage.failures.set('current', 2);

    await fill(editorTextarea(), 'draft of A');
    await sleep(300);
    await openVaultManager();
    await clickManagerButton('Open Second vault');

    await waitFor(() => alertText().includes('could not be saved'));
    expect(noteTitle()).toBe('Welcome to Lattice Notes');
    expect(editorTextarea().value).toBe('draft of A');
    expect(buttonByName('Export vault')).not.toBeNull();
    const catalog = await loadCatalog();
    expect(catalog?.activeVaultId).toBe('current');
  });

  it('keeps the open vault and its draft when the target cannot be read', async () => {
    await renderLegacyApp();
    const second = await storeSecondVault();
    storage.readFailures.set(second, 1);

    await fill(editorTextarea(), 'draft of A');
    await openVaultManager();
    await clickManagerButton('Open Second vault');

    await waitFor(() => alertText().includes('could not be opened'));
    expect(noteTitle()).toBe('Welcome to Lattice Notes');
    expect(editorTextarea().value).toBe('draft of A');
    expect(buttonByName('Export vault')).not.toBeNull();
    const catalog = await loadCatalog();
    expect(catalog?.activeVaultId).toBe('current');
  });
});

describe('vault manager', () => {
  it('shows a failed operation inside the open manager and keeps recovery after closing', async () => {
    await renderLegacyApp();
    const second = await storeSecondVault();
    storage.readFailures.set(second, 1);
    await openVaultManager();
    await clickManagerButton('Open Second vault');

    await waitFor(() => alertText().includes('could not be opened'));
    const manager = container.querySelector('dialog.vaults');
    expect(manager?.querySelector('[role="alert"]')?.textContent).toContain('could not be opened');
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(noteTitle()).toBe('Welcome to Lattice Notes');

    await click(container.querySelector('dialog.vaults .vaults__done') as Element);
    expect(container.querySelector('.workspace__warning')?.textContent).toContain('could not be opened');
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('opens the manager from the name of the open vault', async () => {
    await renderLegacyApp();
    await storeSecondVault();

    expect(buttonByName('Vaults: My vault')).not.toBeNull();
    await openVaultManager();

    expect(container.querySelector('dialog.vaults')?.hasAttribute('open')).toBe(true);
    await waitFor(() => container.textContent?.includes('Second vault') === true);
  });

  it('refuses to archive the open vault and says why', async () => {
    await renderLegacyApp();
    await openVaultManager();

    await clickManagerButton('Archive My vault');

    expect(container.querySelector('.vaults__reason')?.textContent).toContain('cannot be archived');
    expect(buttonByName('Vaults: My vault')).not.toBeNull();
  });

  it('archives a vault that is not open', async () => {
    await renderLegacyApp();
    await storeSecondVault();
    await openVaultManager();

    await clickManagerButton('Archive Second vault');
    await waitFor(() => statusText().includes('archived'));

    expect(container.textContent).toContain('Archived');
    const catalog = await loadCatalog();
    expect(catalog?.vaults.find((member) => member.name === 'Second vault')?.archivedAt).not.toBeNull();
  });

  it('renames the vault and shows the new name in the header', async () => {
    await renderLegacyApp();
    await openVaultManager();

    await clickManagerButton('Rename My vault');
    const input = container.querySelector<HTMLInputElement>('.vaults__rename-input');
    if (!input) throw new Error('no rename input');
    await fill(input, 'Renamed vault');
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Save name',
    );
    await click(save as Element);

    await waitFor(() => statusText().includes('Renamed'));
    expect(buttonByName('Vaults: Renamed vault')).not.toBeNull();
    // The explorer says which vault the notes belong to.
    expect(container.querySelector('.workspace__vault-label')?.textContent).toBe('Renamed vault');
  });
});

describe('undo of a vault', () => {
  it('keeps the undo of a vault with the vault', async () => {
    await renderLegacyApp();
    await storeSecondVault();

    await click(buttonByName('Delete Welcome to Lattice Notes'));
    expect(container.querySelectorAll('.workspace__undo')).toHaveLength(1);

    await openVaultManager();
    await clickManagerButton('Open Second vault');
    await waitFor(() => noteTitle() === 'Only in B');
    expect(container.querySelectorAll('.workspace__undo')).toHaveLength(0);

    await openVaultManager();
    await clickManagerButton('Open My vault');
    await waitFor(() => noteTitle() === 'Getting started');
    expect(container.querySelectorAll('.workspace__undo')).toHaveLength(1);

    await click(buttonByName('Undo delete'));
    expect(noteNames()).toContain('Welcome to Lattice Notes');
  });

  it('keeps the undo after the vault was renamed', async () => {
    await renderLegacyApp();

    await click(buttonByName('Delete Welcome to Lattice Notes'));
    await openVaultManager();
    await clickManagerButton('Rename My vault');
    const input = container.querySelector<HTMLInputElement>('.vaults__rename-input');
    if (!input) throw new Error('no rename input');
    await fill(input, 'Renamed vault');
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Save name',
    );
    await click(save as Element);
    await waitFor(() => statusText().includes('Renamed'));

    await click(buttonByName('Undo delete'));
    expect(noteNames()).toContain('Welcome to Lattice Notes');
  });
});

describe('import of a vault', () => {
  it('refuses to import when the vault changed while the file was read', async () => {
    await renderLegacyApp();
    await storeSecondVault();

    let release: (text: string) => void = () => {};
    const slow = {
      name: 'notes.md',
      size: 12,
      text: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    };
    await selectFiles(fileInput(), [slow]);

    await openVaultManager();
    await clickManagerButton('Open Second vault');
    await waitFor(() => noteTitle() === 'Only in B');

    release('# imported');
    await waitFor(() => alertText().includes('vault switched during the import'));

    expect(noteNames()).not.toContain('notes');
    expect(noteNames()).toEqual(['Only in B']);
  });
});

describe('scroll of the panes', () => {
  it('does not restore the scroll offset of another note', async () => {
    await renderLegacyApp();

    await click(container.querySelector('input[value="read"]') as Element);
    const preview = container.querySelector('.preview') as HTMLElement;
    if (!preview) throw new Error('no preview');
    preview.scrollTop = 120;

    await click(buttonByName('Getting started'));

    expect(preview.scrollTop).toBe(0);
  });

  it('keeps the scroll offset of a note when the reader comes back', async () => {
    await renderLegacyApp();

    const textarea = editorTextarea();
    textarea.scrollTop = 120;
    // A browser tells the panes about a scroll, so the offset belongs to the
    // note that is on the screen.
    textarea.dispatchEvent(new Event('scroll'));

    await click(buttonByName('Getting started'));
    expect(textarea.scrollTop).toBe(0);

    await click(buttonByName('Welcome to Lattice Notes'));
    expect(textarea.scrollTop).toBe(120);
  });
});

describe('quick switcher', () => {
  it('opens with Ctrl+P and keeps the browser from printing', async () => {
    await renderLegacyApp();
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(switcherDialog().hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(switcherInput());
    // The command palette is a different dialog.
    expect(paletteDialog().hasAttribute('open')).toBe(false);
  });

  it('finds a note by its title and by its body', async () => {
    await renderLegacyApp();

    await openSwitcher();
    await fill(switcherInput(), 'Getting started');
    // The title of one note and the body of the two notes that link to it.
    expect(switcherOptions().length).toBeGreaterThan(1);
    expect(switcherOptions()[0]?.textContent).toContain('Getting started');

    await fill(switcherInput(), 'browser');
    expect(switcherOptions()).toHaveLength(1);
    expect(switcherOptions()[0]?.textContent).toContain('Welcome to Lattice Notes');
    expect(switcherOptions()[0]?.querySelector('.switcher__snippet')?.textContent).toContain(
      'browser',
    );
  });

  it('says that nothing matches the query', async () => {
    await renderLegacyApp();

    await openSwitcher();
    await fill(switcherInput(), 'zzz absent');

    expect(switcherOptions()).toHaveLength(0);
    expect(switcherDialog().querySelector('.switcher__empty')?.textContent).toContain('zzz absent');
  });

  it('never creates a note while it is open', async () => {
    await renderLegacyApp();
    const before = noteNames().length;

    await openSwitcher();
    await fill(switcherInput(), 'Ghost note');

    expect(noteNames()).toHaveLength(before);
  });

  it('does not open a note while the text is composed', async () => {
    await renderLegacyApp();

    await openSwitcher();
    await fill(switcherInput(), 'Getting started');
    await pressKey(switcherInput(), 'Enter', { isComposing: true });

    expect(noteTitle()).toBe('Welcome to Lattice Notes');
  });

  it('closes with Escape and gives the keyboard back', async () => {
    await renderLegacyApp();
    const trigger = buttonByName('Commands');
    trigger.focus();

    await openSwitcher();
    await pressKey(switcherInput(), 'Escape');

    expect(switcherDialog().hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('does nothing while another modal is open', async () => {
    await renderLegacyApp();
    const before = noteNames().length;

    await openPalette();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(switcherDialog().hasAttribute('open')).toBe(false);
    expect(paletteDialog().hasAttribute('open')).toBe(true);
    expect(noteNames()).toHaveLength(before);
  });

  it('does nothing while the vault manager is open', async () => {
    await renderLegacyApp();
    const before = noteNames().length;

    await openVaultManager();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(switcherDialog().hasAttribute('open')).toBe(false);
    expect(container.querySelector('dialog.vaults')?.hasAttribute('open')).toBe(true);
    expect(noteNames()).toHaveLength(before);
  });

  it('keeps one polite live region while it is open', async () => {
    await renderLegacyApp();

    await openSwitcher();
    await fill(switcherInput(), 'Getting');

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});

describe('note tabs', () => {
  it('shows one tab for the note that is on the screen', async () => {
    await renderLegacyApp();

    await waitFor(() => tabLabels().length > 0);
    expect(tabLabels()).toEqual(['Welcome to Lattice Notes']);
  });

  it('opens a tab for a note and never opens it twice', async () => {
    await renderLegacyApp();

    await click(buttonByName('Getting started'));
    expect(tabLabels()).toEqual(['Welcome to Lattice Notes', 'Getting started']);

    await click(buttonByName('Getting started'));
    expect(tabLabels()).toHaveLength(2);
  });

  it('closes a tab without deleting the note', async () => {
    await renderLegacyApp();
    await click(buttonByName('Getting started'));

    await click(tabCloses()[1] as Element);

    expect(tabLabels()).toEqual(['Welcome to Lattice Notes']);
    expect(noteNames()).toContain('Getting started');
  });

  it('takes the right neighbour when the active tab closes', async () => {
    await renderLegacyApp();
    await click(buttonByName('Getting started'));
    await click(buttonByName('Welcome to Lattice Notes'));

    await click(tabCloses()[0] as Element);

    expect(tabLabels()).toEqual(['Getting started']);
    expect(noteTitle()).toBe('Getting started');
  });

  it('takes the left neighbour when the active tab is the last one', async () => {
    await renderLegacyApp();
    await click(buttonByName('Getting started'));

    await click(tabCloses()[1] as Element);

    expect(tabLabels()).toEqual(['Welcome to Lattice Notes']);
    expect(noteTitle()).toBe('Welcome to Lattice Notes');
  });

  it('keeps the keyboard on the tab that took its place', async () => {
    await renderLegacyApp();
    await click(buttonByName('Getting started'));
    await click(buttonByName('Welcome to Lattice Notes'));

    await click(tabCloses()[0] as Element);

    await waitFor(() => document.activeElement !== document.body);
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Getting started');
  });

  it('selects nothing when the last tab closes and keeps it after a reload', async () => {
    await renderLegacyApp();

    await click(tabCloses()[0] as Element);

    expect(tabLabels()).toEqual([]);
    expect(container.querySelector('.workspace__empty-note')).not.toBeNull();
    await waitFor(async () => {
      const stored = await loadVault();
      return stored?.activeNoteId === null;
    });
    // The stored session is empty as well, so the reload has nothing to open.
    await waitFor(async () => {
      const session = await loadVaultSession('current');
      return session !== null && session.openNoteIds.length === 0;
    });

    await remountApp();

    expect(tabLabels()).toEqual([]);
    expect(container.querySelector('.workspace__empty-note')).not.toBeNull();
    // The notes are still there.
    expect(noteNames().length).toBeGreaterThan(1);
  });

  it('follows the name of a renamed note', async () => {
    await renderLegacyApp();

    await click(buttonByName('Rename Welcome to Lattice Notes'));
    const input = container.querySelector<HTMLInputElement>('.explorer__rename-input');
    if (!input) throw new Error('no rename input');
    await fill(input, 'Welcome');
    await pressKey(input, 'Enter');

    expect(tabLabels()).toEqual(['Welcome']);
  });

  it('removes the tab of a trashed note and brings it back with the undo', async () => {
    await renderLegacyApp();
    await click(buttonByName('Getting started'));
    await click(buttonByName('Welcome to Lattice Notes'));

    await click(buttonByName('Delete Getting started'));
    expect(tabLabels()).toEqual(['Welcome to Lattice Notes']);

    await click(buttonByName('Undo delete'));
    expect(tabLabels()).toEqual(['Welcome to Lattice Notes', 'Getting started']);
  });

  it('stores the open notes with the vault', async () => {
    await renderLegacyApp();
    await click(buttonByName('Getting started'));

    await waitFor(async () => {
      const session = await loadVaultSession('current');
      return (session?.openNoteIds.length ?? 0) === 2;
    });
  });

  it('leaves the stored tab list alone when it cannot be read', async () => {
    await renderLegacyApp();
    await click(buttonByName('Getting started'));
    await waitFor(async () => {
      const session = await loadVaultSession('current');
      return (session?.openNoteIds.length ?? 0) === 2;
    });

    // The next boot reads the vault, but not its tab list: the empty strip is
    // not the tab list of the vault, so it must not be written back.
    storage.sessionFailures.set('current', 1);
    await remountApp();
    await fill(editorTextarea(), 'A draft written without the tab list');
    await sleep(600);

    expect((await loadVaultSession('current'))?.openNoteIds).toHaveLength(2);
    const written = [...storage.writes].reverse().find((write) => write.key === 'current' && write.done);
    expect(written?.session).toBeNull();
  });

  it('moves the keyboard into the note created from the empty panel', async () => {
    await renderLegacyApp();
    await click(buttonByName('Close Welcome to Lattice Notes'));

    const create = container.querySelector<HTMLButtonElement>('.workspace__empty-note-action');
    if (!create) throw new Error('no empty note action');
    await click(create);

    expect(document.activeElement).toBe(editorTextarea());
  });

  it('keeps the tabs of two vaults apart', async () => {
    await renderLegacyApp();
    // A second vault with two notes of its own.
    const first = createNote(createEmptyVault(), 'Only in B', 'body of B');
    const second = createNote(first.vault, 'Second in B', 'more of B');
    const created = await createStoredVault('Second vault', {
      ...second.vault,
      activeNoteId: first.note.id,
    });
    const secondId = created.catalog.activeVaultId;
    await openStoredVault('current');

    await click(buttonByName('Getting started'));
    await waitFor(async () => (await loadVaultSession('current'))?.openNoteIds.length === 2);

    await openVaultManager();
    await clickManagerButton('Open Second vault');
    await waitFor(() => noteTitle() === 'Only in B');

    expect(tabLabels()).toEqual(['Only in B']);

    await click(buttonByName('Second in B'));
    await waitFor(async () => (await loadVaultSession(secondId))?.openNoteIds.length === 2);

    expect(tabLabels()).toEqual(['Only in B', 'Second in B']);
    // The first vault keeps its own tabs.
    expect((await loadVaultSession('current'))?.openNoteIds).toHaveLength(2);
  });

  it('leaves the tabs of the open vault alone when a switch fails', async () => {
    await renderLegacyApp();
    const second = await storeSecondVault();
    await click(buttonByName('Getting started'));
    await waitFor(async () => {
      const session = await loadVaultSession('current');
      return (session?.openNoteIds.length ?? 0) === 2;
    });
    storage.readFailures.set(second, 1);

    await openVaultManager();
    await clickManagerButton('Open Second vault');

    await waitFor(() => alertText().includes('could not be opened'));
    expect(tabLabels()).toEqual(['Welcome to Lattice Notes', 'Getting started']);
    const session = await loadVaultSession('current');
    expect(session?.openNoteIds).toHaveLength(2);
  });

  it('drops unknown, trashed and repeated ids from a stored session', async () => {
    const first = createNote(createEmptyVault(), 'Alpha');
    const second = createNote(first.vault, 'Beta');
    const third = createNote(second.vault, 'Gamma');
    const trashed = deleteNote(third.vault, third.note.id);
    await saveVault(
      { ...trashed.vault, activeNoteId: first.note.id },
      'current',
      { version: 1, openNoteIds: ['not-a-note', first.note.id, first.note.id, third.note.id] },
    );

    await renderLegacyApp();

    await waitFor(() => tabLabels().length > 0);
    expect(tabLabels()).toEqual(['Alpha']);
  });
});

describe('the daily notes and the calendar', () => {
  it('opens the daily note of today from the toolbar', async () => {
    await renderLegacyApp();
    const today = formatLocalDate(new Date());

    await click(buttonByName("Open today's daily note"));

    await waitFor(() => noteTitle() === today);
    expect(editorTextarea().value).toBe(`# ${today}\n\n`);
    expect(tabLabels().filter((label) => label === today)).toHaveLength(1);
    expect(noteNames().filter((name) => name === today)).toHaveLength(1);
  });

  it('opens the daily note of today from the command catalog', async () => {
    await renderLegacyApp();
    const today = formatLocalDate(new Date());

    await runCommand("Open today's daily note");

    await waitFor(() => noteTitle() === today);
    expect(editorTextarea().value).toBe(`# ${today}\n\n`);
  });

  it('opens the daily note of today only once', async () => {
    await renderLegacyApp();
    const today = formatLocalDate(new Date());

    await click(buttonByName("Open today's daily note"));
    await waitFor(() => noteTitle() === today);
    const tabs = tabLabels().length;
    const notes = noteNames().length;

    await click(buttonByName("Open today's daily note"));

    expect(tabLabels()).toHaveLength(tabs);
    expect(noteNames()).toHaveLength(notes);
    expect(tabLabels().filter((label) => label === today)).toHaveLength(1);
    expect(noteNames().filter((name) => name === today)).toHaveLength(1);
    expect(editorTextarea().value).toBe(`# ${today}\n\n`);
  });

  it('keeps the daily note of today over a reload', async () => {
    await renderLegacyApp();
    const today = formatLocalDate(new Date());

    await click(buttonByName("Open today's daily note"));
    await waitFor(() => noteTitle() === today);
    await waitFor(async () => {
      const stored = await loadVault('current');
      return stored?.notes.some((note) => note.name === today) ?? false;
    });

    await remountApp();

    await waitFor(() => noteTitle() === today);
    expect(editorTextarea().value).toBe(`# ${today}\n\n`);
  });

  it('announces the date of the daily note in the polite region', async () => {
    await renderLegacyApp();
    const today = formatLocalDate(new Date());

    await click(buttonByName("Open today's daily note"));

    await waitFor(() => statusText().includes(today));
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('opens the calendar from the toolbar', async () => {
    await renderLegacyApp();

    await click(buttonByName('Open the calendar'));

    await waitFor(() => container.querySelector('dialog.calendar')?.hasAttribute('open') === true);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('opens the note of a day from the calendar', async () => {
    await renderLegacyApp();
    await click(buttonByName('Open the calendar'));
    await waitFor(() => container.querySelector('dialog.calendar')?.hasAttribute('open') === true);
    const today = formatLocalDate(new Date());

    const day = container.querySelector<HTMLButtonElement>(`.calendar__day[data-day="${today}"]`);
    if (!day) throw new Error('no day in the calendar');
    await click(day);

    await waitFor(() => noteTitle() === today);
    expect(editorTextarea().value).toBe(`# ${today}\n\n`);
    expect(tabLabels().filter((label) => label === today)).toHaveLength(1);
    expect(noteNames().filter((name) => name === today)).toHaveLength(1);
  });

  it('opens the calendar from the command catalog', async () => {
    await renderLegacyApp();

    await runCommand('Open the calendar');

    await waitFor(() => container.querySelector('dialog.calendar')?.hasAttribute('open') === true);
  });
});

describe('the fullscreen graph', () => {
  it('opens from the command and from the trigger with one graph', async () => {
    await renderLegacyApp();

    await runCommand('Open the fullscreen graph');
    await waitFor(
      () => container.querySelector('dialog.graphview')?.hasAttribute('open') === true,
    );
    expect(container.querySelectorAll('dialog.graphview')).toHaveLength(1);

    await pressKey(container.querySelector('dialog.graphview') as Element, 'Escape');
    await waitFor(
      () => container.querySelector('dialog.graphview')?.hasAttribute('open') === false,
    );

    await click(buttonByName('Open the fullscreen graph'));
    await waitFor(
      () => container.querySelector('dialog.graphview')?.hasAttribute('open') === true,
    );
    expect(container.querySelectorAll('dialog.graphview')).toHaveLength(1);
  });

  it('opens a note of the graph into the content on the screen', async () => {
    await renderLegacyApp();

    await click(buttonByName('Open the fullscreen graph'));
    await waitFor(
      () => container.querySelector('dialog.graphview')?.hasAttribute('open') === true,
    );

    const item = container.querySelector<HTMLButtonElement>('.graphview__list button');
    if (!item) throw new Error('no note in the graph list');
    const name = item.textContent?.trim() ?? '';
    await click(item);
    const open = container.querySelector<HTMLButtonElement>('.graphview__open');
    if (!open) throw new Error('no open control in the graph');
    await click(open);

    await waitFor(() => noteTitle() === name);
    expect(container.querySelector('.workspace__panes')?.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).toBe(editorTextarea());
    expect(tabLabels().filter((label) => label === name)).toHaveLength(1);
  });

  it('announces the graph in the one polite region', async () => {
    await renderLegacyApp();

    await click(buttonByName('Open the fullscreen graph'));

    await waitFor(() => statusText().includes('Graph'));
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('keeps the graph inside a narrow screen', async () => {
    window.innerWidth = 320;
    await renderLegacyApp();

    await click(buttonByName('Open the fullscreen graph'));
    await waitFor(
      () => container.querySelector('dialog.graphview')?.hasAttribute('open') === true,
    );

    expect(container.querySelectorAll('dialog.graphview')).toHaveLength(1);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });
});
