import 'fake-indexeddb/auto';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { createEmptyVault, createNote, deleteNote } from './domain/vault';
import type { Vault } from './domain/types';
import { loadVault, saveVault } from './storage/vaultRepository';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DB_NAME = 'lattice-notes';
const STORE_NAME = 'vault';
const DOCUMENT_KEY = 'current';

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
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
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

function editorTitle(): string {
  return container.querySelector('.editor__title')?.textContent?.trim() ?? '';
}

function editorTextarea(): HTMLTextAreaElement {
  const found = container.querySelector<HTMLTextAreaElement>('textarea');
  if (!found) throw new Error('no editor textarea');
  return found;
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

async function pressKey(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
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
  await waitFor(() => container.querySelector('.workspace') !== null);
}

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
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
  it('seeds a usable vault on the first visit', async () => {
    await renderApp();

    expect(noteNames().length).toBeGreaterThan(1);
    expect(noteNames()).toContain('Welcome to Lattice Notes');
    expect(editorTitle()).toBe('Welcome to Lattice Notes');
  });

  it('keeps a deliberately emptied vault empty and offers recovery', async () => {
    const created = createNote(createEmptyVault(), 'Scratch');
    await saveVault(deleteNote(created.vault, created.note.id).vault);

    await renderApp();

    expect(noteNames()).toHaveLength(0);
    expect(container.querySelector('.explorer__empty-text')?.textContent).toContain('No notes yet');

    await click(buttonByName('Restore Scratch'));

    expect(noteNames()).toContain('Scratch');
    expect(statusText()).toContain('Restored');
  });

  it('creates a note, selects it, and announces the change', async () => {
    await renderApp();
    const before = noteNames().length;

    await click(buttonByName('New note'));

    expect(noteNames()).toHaveLength(before + 1);
    expect(statusText()).toContain('Created');
    expect(editorTitle()).toBe('Untitled');
    expect(editorTextarea().disabled).toBe(false);
  });

  it('edits the note body in memory and persists it', async () => {
    await renderApp();

    await fill(editorTextarea(), 'Hello lattice');

    expect(editorTextarea().value).toBe('Hello lattice');
    expect(container.querySelector('.preview__body')?.textContent).toContain('Hello lattice');

    await waitFor(async () => {
      const stored = await loadVault();
      return stored?.notes.some((note) => note.body === 'Hello lattice') ?? false;
    });
  });

  it('renames a note with the keyboard', async () => {
    await renderApp();

    await click(buttonByName('Rename Welcome to Lattice Notes'));
    const input = container.querySelector<HTMLInputElement>('.explorer__rename-input');
    if (!input) throw new Error('no rename input');
    await fill(input, 'Welcome');
    await pressKey(input, 'Enter');

    expect(noteNames()).toContain('Welcome');
    expect(statusText()).toContain('Renamed');
  });

  it('deletes a note and restores it with undo', async () => {
    await renderApp();

    await click(buttonByName('Delete Welcome to Lattice Notes'));

    expect(noteNames()).not.toContain('Welcome to Lattice Notes');
    expect(statusText()).toContain('Deleted');

    await click(buttonByName('Undo delete'));

    expect(noteNames()).toContain('Welcome to Lattice Notes');
    expect(statusText()).toContain('Restored');
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Welcome to Lattice Notes');
  });

  it('creates a note with the Ctrl/Cmd+N shortcut', async () => {
    await renderApp();
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

    await renderApp();
    const link = container.querySelector('.preview__wikilink');

    expect(link?.tagName).toBe('BUTTON');
    expect(link?.textContent).toBe('Beta');

    await click(link as Element);

    expect(editorTitle()).toBe('Beta');
  });

  it('renders hostile markdown as inert text', async () => {
    const created = createNote(
      createEmptyVault(),
      'Hostile',
      '<script>alert(1)</script> [click](javascript:alert(1))',
    );
    await saveVault({ ...created.vault, activeNoteId: created.note.id });

    await renderApp();
    const body = container.querySelector('.preview__body');

    expect(body?.querySelector('script')).toBeNull();
    expect(body?.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:');
    expect(body?.textContent).toContain('<script>');
  });

  it('keeps the notes usable and warns when saving fails', async () => {
    await renderApp();
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

    await renderApp();

    expect(alertText()).toContain('Local storage');

    await click(buttonByName('Create first note'));

    expect(noteNames()).toContain('Untitled');
  });

  it('announces a missing wiki target without creating it', async () => {
    const created = createNote(createEmptyVault(), 'Alpha', 'See [[Nowhere]] now.');
    await saveVault({ ...created.vault, activeNoteId: created.note.id });

    await renderApp();
    await click(container.querySelector('.preview__wikilink') as Element);

    expect(statusText()).toContain('No note named Nowhere yet');
    expect(noteNames()).toEqual(['Alpha']);
  });

  it('keeps one polite live region and a persistent visible label', async () => {
    await renderApp();

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-live="assertive"]')).toHaveLength(0);

    const label = container.querySelector('label[for="note-editor"]');
    expect(label?.textContent).toContain('Markdown body');
    expect(container.querySelector('#note-editor')?.tagName).toBe('TEXTAREA');
  });

  it('confirms a local save in the live region', async () => {
    await renderApp();
    await fill(editorTextarea(), 'saved body');

    await waitFor(() => statusText().includes('Saved to local storage'));
  });
});

describe('keyboard focus', () => {
  it('focuses the rename field and returns focus to the note on cancel', async () => {
    await renderApp();

    await click(buttonByName('Rename Welcome to Lattice Notes'));
    const input = container.querySelector<HTMLInputElement>('.explorer__rename-input');
    if (!input) throw new Error('no rename input');

    expect(document.activeElement).toBe(input);

    await pressKey(input, 'Escape');

    expect(document.activeElement?.textContent).toBe('Welcome to Lattice Notes');
  });

  it('returns focus to the note after a rename is committed', async () => {
    await renderApp();

    await click(buttonByName('Rename Welcome to Lattice Notes'));
    const input = container.querySelector<HTMLInputElement>('.explorer__rename-input');
    if (!input) throw new Error('no rename input');
    await fill(input, 'Welcome');
    await pressKey(input, 'Enter');

    expect(document.activeElement?.textContent).toBe('Welcome');
  });

  it('moves focus to the surviving note after a delete', async () => {
    await renderApp();

    await click(buttonByName('Delete Welcome to Lattice Notes'));

    expect(document.activeElement?.textContent).toBe('Getting started');
  });
});

describe('unreadable storage', () => {
  it('offers a retry that replaces the unreadable vault with the tab notes', async () => {
    await storeUnreadableDocument();

    await renderApp();
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

    await renderApp();
    await click(buttonByName('Create first note'));
    await fill(editorTextarea(), 'edited body');
    await sleep(600);

    expect((await readRawDocument()).version).toBe(2);
    expect(alertText()).toContain('Local storage');
  });
});
