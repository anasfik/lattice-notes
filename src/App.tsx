/**
 * Lattice Notes application shell.
 *
 * App owns the in-memory vault, its persistence, the undo of every vault and
 * the status messages. The components stay presentational so later waves can
 * extend them without rewriting the data flow.
 *
 * The open vault has an identity: its id and a generation that changes with
 * every switch. Every write and every import takes the identity before it
 * does its work, so a write that lands after a switch cannot mark another
 * vault as saved and a file can never be merged into another vault.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import {
  activeNotes,
  buildLocalGraph,
  createEmptyVault,
  createNote,
  deleteNote,
  normalizeNoteName,
  renameNote,
  restoreNote,
  updateNoteBody,
} from './domain/vault';
import { buildCommands } from './domain/commands';
import type { CommandAction, ViewMode } from './domain/commands';
import { closeTab, sanitizeTabIds, stepTab } from './domain/tabs';
import {
  MAX_ENVELOPE_BYTES,
  MAX_IMPORT_FILES,
  MAX_IMPORT_FILE_BYTES,
  importEnvelope,
  importMarkdownFiles,
  serializeVault,
} from './domain/transfer';
import type { ImportSkip, SkipReason } from './domain/transfer';
import type { Vault } from './domain/types';
import {
  archiveStoredVault,
  createStoredVault,
  loadCatalog,
  loadVault,
  loadVaultSession,
  openStoredVault,
  renameStoredVault,
  restoreStoredVault,
  saveVault,
} from './storage/vaultRepository';
import type { VaultCatalog, VaultTabSession } from './storage/vaultRepository';
import CommandPalette from './components/CommandPalette';
import Onboarding from './components/Onboarding';
import QuickSwitcher from './components/QuickSwitcher';
import VaultManager from './components/VaultManager';
import Workspace, { isCompact, isHidden } from './components/Workspace';
import type { FocusTarget } from './components/Explorer';

const SAVE_DEBOUNCE_MS = 200;
/** The key of the legacy document, used by a session that has no vault. */
const LEGACY_VAULT_ID = 'current';

/** The Markdown extensions the import accepts, without the dot. */
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'txt'];

const SKIP_REASONS: Record<SkipReason, string> = {
  'unsupported-type': 'unsupported type',
  'too-large': 'too large',
  'batch-limit': 'over the batch limit',
  'unreadable-content': 'not readable',
};

/** The ways the app can be before the workspace is on the screen. */
type Phase = 'loading' | 'onboarding' | 'workspace';
/** Whether the storage holds the notes of this tab. */
type StorageMode = 'ready' | 'memory-only';

/** The identity of the vault that is on the screen. */
interface Identity {
  /** The id of the open vault, or null when the session has none. */
  id: string | null;
  /** A counter that changes whenever another vault takes the screen. */
  generation: number;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [vault, setVault] = useState<Vault>(() => createEmptyVault());
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<VaultCatalog | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>('memory-only');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [retryKind, setRetryKind] = useState<'load' | 'save'>('load');
  const [undoSlots, setUndoSlots] = useState<Record<string, { id: string; name: string }>>({});
  const [focusNote, setFocusNote] = useState<FocusTarget | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [searchRequest, setSearchRequest] = useState(0);
  const [focusContentRequest, setFocusContentRequest] = useState(0);
  /** The open notes of the vault on the screen, in the order of the strip. */
  const [openNoteIds, setOpenNoteIds] = useState<string[]>([]);
  /** The way the note is shown next to the explorer. */
  const [view, setView] = useState<ViewMode>(() => (isCompact() ? 'write' : 'split'));
  /** True on a narrow screen, so the context panel can be folded away. */
  const [compact, setCompact] = useState(() => isCompact());
  /** Counts the requests to fold the context panel away. */
  const [contextToggleRequest, setContextToggleRequest] = useState(0);
  /** Asks the tab strip to put the keyboard on one of its tabs. */
  const [tabFocus, setTabFocus] = useState<{ id: string | null; request: number }>({
    id: null,
    request: 0,
  });

  const vaultRef = useRef(vault);
  const baseRef = useRef(vault);
  /** The open notes that are stored, so a save knows what changed. */
  const baseSessionRef = useRef<string[]>([]);
  /**
   * False while the stored tab list could not be read.
   *
   * A tab list that was never read must not be written back: the empty strip
   * shown after a failed read is not the tab list of the vault, so a save
   * writes the notes only and leaves the stored tabs alone.
   */
  const sessionKnownRef = useRef(true);
  const identityRef = useRef<Identity>({ id: null, generation: 0 });
  const saveSeqRef = useRef(0);
  const lastSaveSeqRef = useRef(new Map<string, number>());
  const bootedRef = useRef(false);
  const loadFailuresRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<boolean> | null>(null);
  const switchRef = useRef<{ promise: Promise<void> } | null>(null);
  const queuedSwitchRef = useRef<string | null>(null);
  const creatingRef = useRef(false);
  /** The catalog of the app, so a shortcut always runs the current command. */
  const commandsRef = useRef<CommandAction[]>([]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** The undo slot of the vault that is on the screen. */
  const undoKey = vaultId ?? '';
  const undo = undoSlots[undoKey] ?? null;

  /** The open notes that may be shown as tabs. */
  const tabIds = useMemo(
    () => sanitizeTabIds(openNoteIds, vault, vault.activeNoteId),
    [openNoteIds, vault],
  );

  /** Applies the next vault to the state and to the ref the handlers read. */
  const applyVault = useCallback((next: Vault) => {
    vaultRef.current = next;
    setVault(next);
  }, []);

  /** True when the tab holds notes that are not in the storage. */
  const hasUnsavedWork = useCallback(() => baseRef.current !== vaultRef.current, []);

  /** True while the identity of the vault is still the one that was taken. */
  const isCurrent = useCallback((identity: Identity) => {
    const current = identityRef.current;
    return current.id === identity.id && current.generation === identity.generation;
  }, []);

  /**
   * Puts a vault on the screen.
   *
   * The generation changes with every new vault, so a write that was started
   * for the previous vault can no longer mark this one as saved. The open
   * notes come with the vault, so two vaults never share a tab list.
   */
  const commitVault = useCallback(
    (nextCatalog: VaultCatalog, next: Vault, id: string, sessionIds: string[]) => {
      identityRef.current = { id, generation: identityRef.current.generation + 1 };
      vaultRef.current = next;
      baseRef.current = next;
      setVault(next);
      setVaultId(id);
      setCatalog(nextCatalog);
      setStorageMode('ready');
      setError(null);
      const ids = sanitizeTabIds(sessionIds, next, next.activeNoteId);
      setOpenNoteIds(ids);
      baseSessionRef.current = ids;
    },
    [],
  );

  /**
   * Writes a vault and its open notes to the storage.
   *
   * The write carries the identity of the vault it belongs to. A write that
   * finishes after the vault changed is dropped: it must not mark another
   * vault as saved and it must not claim that the notes on the screen are
   * stored. The content and the open notes go in one transaction, so a failed
   * write leaves neither the notes nor the tab list behind.
   */
  const save = useCallback(
    async (
      next: Vault,
      target: string,
      identity: Identity,
      session: VaultTabSession | null,
    ): Promise<boolean> => {
      const seq = (saveSeqRef.current += 1);
      lastSaveSeqRef.current.set(target, seq);
      const write = (async () => {
        try {
          // A session that was never read is left out of the write, so the
          // stored tab list cannot be replaced by an empty strip.
          await saveVault(next, target, session ?? undefined);
        } catch {
          if (isCurrent(identity)) {
            setError('Local storage rejected the save. Your notes are still here in this tab.');
            setRetryKind('save');
          }
          return false;
        }
        // A newer write to the same slot wins, and a write of a vault that
        // is not on the screen any more is dropped.
        if (lastSaveSeqRef.current.get(target) !== seq) return true;
        if (!isCurrent(identity)) return true;
        baseRef.current = next;
        if (session) baseSessionRef.current = session.openNoteIds;
        setError(null);
        setStorageMode('ready');
        setStatus('Saved to local storage');
        return true;
      })();
      pendingSaveRef.current = write;
      try {
        return await write;
      } finally {
        if (pendingSaveRef.current === write) pendingSaveRef.current = null;
      }
    },
    [isCurrent],
  );

  /**
   * Writes the pending changes of the open vault before it is left.
   *
   * A write that is already running is waited for, so two writes never
   * overlap, and the debounce is dropped, so the draft is written once.
   */
  const flushPendingSave = useCallback(async (): Promise<boolean> => {
    const running = pendingSaveRef.current;
    if (running) {
      const ok = await running;
      if (!ok) return false;
    }
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const identity = identityRef.current;
    if (identity.id === null) return true;
    const session = sessionKnownRef.current ? sessionOf(openNoteIds, vaultRef.current) : null;
    if (
      baseRef.current === vaultRef.current
      && (session === null || sameIds(baseSessionRef.current, session.openNoteIds))
    ) {
      return true;
    }
    return save(vaultRef.current, identity.id, identity, session);
  }, [openNoteIds, save]);

  // Edits are applied immediately in memory and written after a short pause.
  useEffect(() => {
    if (storageMode !== 'ready') return;
    const identity = identityRef.current;
    const id = identity.id;
    if (id === null) return;
    const session = sessionKnownRef.current ? sessionOf(openNoteIds, vault) : null;
    if (
      baseRef.current === vault
      && (session === null || sameIds(baseSessionRef.current, session.openNoteIds))
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void save(vault, id, identity, session);
    }, SAVE_DEBOUNCE_MS);
    saveTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (saveTimerRef.current === timer) saveTimerRef.current = null;
    };
  }, [openNoteIds, save, storageMode, vault]);

  /**
   * Reads the open notes of a vault.
   *
   * A tab list that cannot be read is not a reason to refuse the vault: the
   * notes are what matters, so the vault opens with an empty strip and the
   * status says what happened.
   */
  const readSessionIds = useCallback(async (id: string): Promise<string[]> => {
    try {
      const session = await loadVaultSession(id);
      sessionKnownRef.current = true;
      return session?.openNoteIds ?? [];
    } catch {
      sessionKnownRef.current = false;
      setStatus('The tab list of this vault could not be read, so it starts empty.');
      return [];
    }
  }, []);

  /**
   * Reads the storage and opens the vault that is selected there.
   *
   * The catalog decides whether this is a first use, a user whose notes are
   * stored or a storage that cannot be read. A first use shows the
   * onboarding, a stored vault is opened, and a broken storage leaves the
   * session in memory with a warning instead of pretending it is fresh.
   */
  const boot = useCallback(async () => {
    try {
      const stored = await loadCatalog();
      if (stored === null) {
        // Nothing is stored at all, so this is a genuine first use.
        if (hasUnsavedWork()) {
          setRetryKind('save');
          setError(
            'Local storage is readable but empty. Retry saves the notes of this tab to local storage.',
          );
          return;
        }
        setPhase('onboarding');
        return;
      }

      const opened = await openStoredVault(stored.activeVaultId);
      if (hasUnsavedWork()) {
        // The tab holds notes that are not in the storage, so they are not
        // thrown away for the stored ones.
        setRetryKind('save');
        setError(
          'Local storage is readable again. Export the notes of this tab, then reload the page to use the stored vault.',
        );
        return;
      }
      const tabIds = await readSessionIds(opened.catalog.activeVaultId);
      commitVault(opened.catalog, opened.vault, opened.catalog.activeVaultId, tabIds);
      setPhase('workspace');
      setStatus('Local vault restored');
    } catch {
      loadFailuresRef.current += 1;
      setStorageMode('memory-only');
      setPhase('workspace');
      if (loadFailuresRef.current >= 2) {
        setRetryKind('save');
        setError(
          'Local storage still cannot be read. Retry replaces the unreadable vault with the notes of this tab.',
        );
        return;
      }
      setRetryKind('load');
      setError(
        'Local storage could not be read, so this session runs in memory only. Your notes are not saved yet.',
      );
    }
  }, [commitVault, hasUnsavedWork, readSessionIds]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void boot();
  }, [boot]);

  /** Puts a note in the tab strip, once. */
  const rememberTab = useCallback((id: string) => {
    setOpenNoteIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }, []);

  const handleCreate = useCallback(() => {
    const current = vaultRef.current;
    // An empty vault shows the create button instead of the list, so the
    // button is destroyed by the create and the keyboard needs a new home.
    // With notes in the vault the keyboard stays where it was, so
    // Ctrl/Cmd+N from the editor keeps the caret in the editor.
    const wasEmpty = activeNotes(current).length === 0;
    const { vault: next, note } = createNote(current);
    applyVault({ ...next, activeNoteId: note.id });
    rememberTab(note.id);
    setStatus(`Created ${note.name}`);
    if (wasEmpty) setFocusNote({ kind: 'note', id: note.id });
  }, [applyVault, rememberTab]);

  const handleSelect = useCallback(
    (id: string) => {
      const current = vaultRef.current;
      const note = current.notes.find((candidate) => candidate.id === id);
      if (!note) return;
      if (current.activeNoteId !== id) applyVault({ ...current, activeNoteId: id });
      rememberTab(id);
      setStatus(`Opened ${note.name}`);
    },
    [applyVault, rememberTab],
  );

  /**
   * Closes a tab.
   *
   * A tab holds the id of a note, so closing it never deletes the note. The
   * note that is on the screen moves to the tab on its right, or to the one on
   * its left when there is none on the right.
   */
  const handleCloseTab = useCallback(
    (id: string) => {
      const current = vaultRef.current;
      const ids = sanitizeTabIds(openNoteIds, current, current.activeNoteId);
      const result = closeTab(ids, current.activeNoteId, id);
      setOpenNoteIds(result.openNoteIds);
      if (result.activeNoteId !== current.activeNoteId) {
        applyVault({ ...current, activeNoteId: result.activeNoteId });
      }
      // The keyboard follows the tab that took the place of the closed one.
      setTabFocus((focus) => ({ id: result.focusTabId, request: focus.request + 1 }));
      const note = current.notes.find((candidate) => candidate.id === id);
      setStatus(`Closed ${note?.name ?? 'the note'}`);
    },
    [applyVault, openNoteIds],
  );

  /** Walks to the next or the previous tab. */
  const handleStepTab = useCallback(
    (delta: number) => {
      const current = vaultRef.current;
      const ids = sanitizeTabIds(openNoteIds, current, current.activeNoteId);
      const next = stepTab(ids, current.activeNoteId, delta);
      if (!next) return;
      handleSelect(next);
    },
    [handleSelect, openNoteIds],
  );

  /**
   * Puts the keyboard on the content the reader can see.
   *
   * The editor and the preview are both mounted in every view, and the
   * inactive one is hidden, so the keyboard may never go to a hidden field.
   */
  const focusContent = useCallback(() => {
    const editor = editorRef.current;
    if (editor && !editor.disabled && !isHidden(editor)) {
      editor.focus();
      return;
    }
    const preview = previewRef.current;
    if (preview && !isHidden(preview)) preview.focus();
  }, []);

  /**
   * Opens a note from a control that the navigation destroys, so the keyboard
   * has to be placed somewhere that survives.
   */
  const handleNavigate = useCallback(
    (id: string) => {
      handleSelect(id);
      focusContent();
    },
    [focusContent, handleSelect],
  );

  const handleChange = useCallback((body: string) => {
    const current = vaultRef.current;
    if (!current.activeNoteId) return;
    const { vault: next } = updateNoteBody(current, current.activeNoteId, body);
    if (next === current) return;
    applyVault(next);
  }, [applyVault]);

  const handleRename = useCallback((id: string, name: string) => {
    const current = vaultRef.current;
    const { vault: next, note } = renameNote(current, id, name);
    if (!note || next === current) return;
    applyVault(next);
    setStatus(`Renamed to ${note.name}`);
  }, [applyVault]);

  const handleDelete = useCallback(
    (id: string) => {
      const current = vaultRef.current;
      const { vault: next, note } = deleteNote(current, id);
      if (!note || next === current) return;
      applyVault(next);
      // The tab of a note that is gone is gone as well.
      setOpenNoteIds((ids) => ids.filter((candidate) => candidate !== id));
      // The deleted row disappears with the focus on it, so the keyboard is
      // handed to the note the vault selected, or to the empty state when the
      // last note is gone.
      setFocusNote(
        next.activeNoteId ? { kind: 'note', id: next.activeNoteId } : { kind: 'empty' },
      );
      // The undo slot belongs to the vault the note was deleted in.
      setUndoSlots((slots) => ({ ...slots, [undoKey]: { id: note.id, name: note.name } }));
      setStatus(`Deleted ${note.name}`);
    },
    [applyVault, undoKey],
  );

  const handleRestore = useCallback(
    (id: string): boolean => {
      const { vault: next, note } = restoreNote(vaultRef.current, id);
      if (!note) return false;
      applyVault({ ...next, activeNoteId: note.id });
      rememberTab(note.id);
      setFocusNote({ kind: 'note', id: note.id });
      // The undo slot holds the restored note, so the undo control would do
      // nothing. It goes when the note comes back.
      setUndoSlots((slots) => {
        if (slots[undoKey]?.id !== note.id) return slots;
        const next = { ...slots };
        delete next[undoKey];
        return next;
      });
      setStatus(`Restored ${note.name}`);
      return true;
    },
    [applyVault, rememberTab, undoKey],
  );

  const handleUndo = useCallback(() => {
    if (!undo) return;
    handleRestore(undo.id);
  }, [handleRestore, undo]);

  /** Renames the note that is on the screen. */
  const handleRenameActive = useCallback(() => {
    const current = vaultRef.current;
    const id = current.activeNoteId;
    if (!id) return;
    const note = current.notes.find((candidate) => candidate.id === id);
    if (!note) return;
    // The platform asks for the name, so the command needs no dialog of its
    // own and the keyboard comes back to the page afterwards.
    const name = window.prompt('New name of the note', note.name);
    if (name === null) return;
    handleRename(id, name);
  }, [handleRename]);

  /** Moves the note that is on the screen to the trash. */
  const handleTrashActive = useCallback(() => {
    const id = vaultRef.current.activeNoteId;
    if (!id) return;
    handleDelete(id);
  }, [handleDelete]);

  /** Closes the tab of the note that is on the screen. */
  const closeActiveTab = useCallback(() => {
    const id = vaultRef.current.activeNoteId;
    if (!id) return;
    handleCloseTab(id);
  }, [handleCloseTab]);

  /** Opens the quick switcher. */
  const openSwitcher = useCallback(() => {
    setSwitcherOpen(true);
  }, []);

  /** Opens the vault manager. */
  const openVaultManager = useCallback(() => {
    setManagerOpen(true);
  }, []);

  /** Folds the context panel away, or shows it again. */
  const toggleContextPanel = useCallback(() => {
    setContextToggleRequest((request) => request + 1);
  }, []);

  /** Opens the hidden file picker behind the visible import control. */
  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Reads the selected files and merges them into the vault.
   *
   * The identity of the vault is taken before the files are read, so a file
   * that is read while another vault takes the screen is never merged into
   * that vault. The files are read one after the other, so a large selection
   * does not hold the text of every file in memory at once. The limits are
   * checked on the file size before the content is read, so an oversized
   * file is never pulled into memory.
   */
  const handleImportFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const files = Array.from(input.files ?? []);
      input.value = '';
      setImportError(null);
      if (files.length === 0) return;

      const identity = identityRef.current;

      const skipped: ImportSkip[] = [];
      const envelopes: File[] = [];
      const markdown: File[] = [];

      for (const file of files) {
        const name = file.name;
        if (name.toLowerCase().endsWith('.json')) {
          if (file.size > MAX_ENVELOPE_BYTES) {
            skipped.push({ name, reason: 'too-large' });
            continue;
          }
          envelopes.push(file);
          continue;
        }
        if (!MARKDOWN_EXTENSIONS.includes(extensionOf(name))) {
          skipped.push({ name, reason: 'unsupported-type' });
          continue;
        }
        if (markdown.length >= MAX_IMPORT_FILES) {
          skipped.push({ name, reason: 'batch-limit' });
          continue;
        }
        if (file.size > MAX_IMPORT_FILE_BYTES) {
          skipped.push({ name, reason: 'too-large' });
          continue;
        }
        markdown.push(file);
      }

      let imported = 0;

      try {
        const notes: { name: string; text: string }[] = [];
        for (const file of markdown) {
          notes.push({ name: stripExtension(file.name), text: await file.text() });
        }
        const envelopesText: string[] = [];
        for (const file of envelopes) {
          envelopesText.push(await file.text());
        }

        // The vault that is on the screen is not the one the files were
        // chosen for any more, so the files are refused.
        if (!isCurrent(identity)) {
          setImportError('The vault switched during the import, so the files were not imported.');
          setStatus('The import was refused');
          return;
        }

        // The merge runs against the vault of this moment, not against a vault
        // captured before the files were read.
        let next = vaultRef.current;
        for (const json of envelopesText) {
          const result = importEnvelope(next, json);
          next = result.vault;
          imported += result.report.imported;
          mergeSkips(skipped, result.report.skipped);
        }

        const result = importMarkdownFiles(next, notes);
        next = result.vault;
        imported += result.report.imported;
        mergeSkips(skipped, result.report.skipped);

        applyVault(next);
      } catch (error) {
        // A broken file or envelope changes nothing: every note of the vault
        // stays, and the reason is in the import alert.
        setImportError(`The import failed: ${errorMessage(error)}`);
        return;
      }

      const summary = describeImport(imported, skipped);
      // Without storage the notes only live in this tab, so the summary says
      // so instead of only counting the import.
      setStatus(storageMode === 'ready' ? summary : `${summary} (not saved — use Export)`);
    },
    [applyVault, isCurrent, storageMode],
  );

  /** Writes the vault of this tab to a JSON file. The storage is not read. */
  const handleExport = useCallback(() => {
    const current = vaultRef.current;
    const blob = new Blob([serializeVault(current)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'lattice-notes-vault.json';
    // The anchor has to be in the document when it is clicked, or some
    // browsers ignore the download.
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // The download reads the object URL after the click, so the URL is
    // released on the next tick and not before.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus(`Exported ${activeNotes(current).length} notes`);
  }, []);

  const handleWikiLink = useCallback(
    (target: string) => {
      const wanted = normalizeNoteName(target);
      if (!wanted) return;
      const match = activeNotes(vaultRef.current).find(
        (note) => note.name.toLowerCase() === wanted.toLowerCase(),
      );
      if (match) {
        handleSelect(match.id);
        // The preview link is replaced by the note it opens.
        focusContent();
        return;
      }
      // A missing target becomes the note it names, once.
      const { vault: next, note } = createNote(vaultRef.current, wanted);
      applyVault({ ...next, activeNoteId: note.id });
      rememberTab(note.id);
      setStatus(`Created ${note.name}`);
      focusContent();
    },
    [applyVault, focusContent, handleSelect, rememberTab],
  );

  const announce = useCallback((message: string) => {
    setStatus(message);
  }, []);

  const openPalette = useCallback(() => {
    setPaletteOpen(true);
  }, []);

  /**
   * Asks for the search field. The workspace opens the notes panel first when
   * the search field sits inside a closed panel.
   */
  const requestSearch = useCallback(() => {
    setSearchRequest((request) => request + 1);
  }, []);

  /**
   * Opens another vault.
   *
   * The pending changes of the open vault are written first, so nothing is
   * lost. A read of the target that fails leaves the open vault, its draft
   * and the selection of the catalog as they were.
   */
  const performSwitch = useCallback(
    async (id: string): Promise<boolean> => {
      if (id === identityRef.current.id) return true;

      const flushed = await flushPendingSave();
      if (!flushed) {
        setError(
          'The notes of this vault could not be saved, so the vault was not changed. Export the notes of this tab before you leave.',
        );
        setStatus('The vault was not changed');
        return false;
      }

      let opened: { catalog: VaultCatalog; vault: Vault };
      try {
        opened = await openStoredVault(id);
      } catch (error) {
        setError(
          `The vault could not be opened: ${errorMessage(error)}. The open vault and your draft are unchanged.`,
        );
        setStatus('The vault was not changed');
        return false;
      }

      // The tab list belongs to the vault that is opened, so the open notes of
      // the other vault never follow the reader.
      const tabIds = await readSessionIds(opened.catalog.activeVaultId);
      commitVault(opened.catalog, opened.vault, opened.catalog.activeVaultId, tabIds);
      setStatus(`Opened ${vaultName(opened.catalog, opened.catalog.activeVaultId)}`);
      return true;
    },
    [commitVault, flushPendingSave, readSessionIds],
  );

  /**
   * Asks for another vault.
   *
   * A request that arrives while a switch is running waits for it and
   * replaces it with the latest target, so two switches never overlap.
   */
  const switchVault = useCallback(
    (id: string): Promise<void> => {
      const running = switchRef.current;
      if (running) {
        queuedSwitchRef.current = id;
        return running.promise;
      }
      const promise = (async () => {
        try {
          for (;;) {
            const target = queuedSwitchRef.current ?? id;
            queuedSwitchRef.current = null;
            const ok = await performSwitch(target);
            if (!ok) break;
            const next = queuedSwitchRef.current;
            // A queued request for the target that just opened is satisfied;
            // leaving it set would make the next request silently re-run it.
            if (next === null || next === target) {
              queuedSwitchRef.current = null;
              break;
            }
          }
        } finally {
          switchRef.current = null;
        }
      })();
      switchRef.current = { promise };
      return promise;
    },
    [performSwitch],
  );

  /**
   * Creates a vault and opens it.
   *
   * The pending changes of the open vault are written first, so nothing is
   * lost when the new vault takes the screen. A second request while a
   * vault is created is refused, so a double submit cannot create two
   * vaults.
   */
  const createVault = useCallback(
    async (name: string, next: Vault): Promise<void> => {
      if (creatingRef.current) throw new Error('a vault is already being created');
      creatingRef.current = true;
      try {
        // A creation that lands in the middle of a switch would leave the
        // screen and the stored selection disagreeing, so let the switch end.
        await switchRef.current?.promise;
        const flushed = await flushPendingSave();
        if (!flushed) {
          throw new Error('the notes of this vault could not be saved');
        }
        const created = await createStoredVault(name, next);
        commitVault(created.catalog, created.vault, created.catalog.activeVaultId, []);
        setStatus(
          `Created the vault ${vaultName(created.catalog, created.catalog.activeVaultId)}`,
        );
      } finally {
        creatingRef.current = false;
      }
    },
    [commitVault, flushPendingSave],
  );

  /** The first vault of a first use. */
  const handleOnboardingCreate = useCallback(
    async (name: string, next: Vault) => {
      await createVault(name, next);
      setPhase('workspace');
      setFocusContentRequest((request) => request + 1);
    },
    [createVault],
  );

  const handleRenameVault = useCallback(async (id: string, name: string) => {
    try {
      const next = await renameStoredVault(id, name);
      setCatalog(next);
      setStatus(`Renamed the vault to ${name}`);
    } catch (error) {
      setError(`The vault could not be renamed: ${errorMessage(error)}`);
    }
  }, []);

  const handleArchiveVault = useCallback(async (id: string) => {
    try {
      const next = await archiveStoredVault(id);
      setCatalog(next);
      setStatus('The vault was archived. Restore it to open it again.');
    } catch (error) {
      setError(`The vault could not be archived: ${errorMessage(error)}`);
    }
  }, []);

  const handleRestoreVault = useCallback(async (id: string) => {
    try {
      const next = await restoreStoredVault(id);
      setCatalog(next);
      setStatus('The vault was restored.');
    } catch (error) {
      setError(`The vault could not be restored: ${errorMessage(error)}`);
    }
  }, []);

  const handleCreateVault = useCallback(
    async (name: string) => {
      try {
        await createVault(name, createEmptyVault());
        setManagerOpen(false);
      } catch (error) {
        setError(`The vault could not be created: ${errorMessage(error)}`);
      }
    },
    [createVault],
  );

  const handleRetry = useCallback(async () => {
    if (retryKind === 'save') {
      if (storageMode === 'memory-only') {
        // The recovery save may destroy the stored vault, so the store is
        // read again first and the write only happens when it is the only
        // way out.
        try {
          const stored = await loadVault(LEGACY_VAULT_ID);
          if (stored !== null) {
            if (baseRef.current === vaultRef.current) {
              // The tab changed nothing, so the stored vault is the truth.
              // Boot again so the vault also gets its identity and catalog
              // back; without them later edits would never be written.
              await boot();
            } else {
              setError(
                'Local storage is readable again. Export the notes of this tab, then reload the page to use the stored vault.',
              );
            }
            return;
          }
        } catch {
          // The document is still unreadable: the explicit replacement below
          // is the only way out.
        }
        if (vaultRef.current.notes.length === 0) {
          setError(
            'This tab has no notes to save. Create or import a note before replacing the unreadable vault.',
          );
          return;
        }
      }
      const identity = identityRef.current;
      const session = sessionOf(openNoteIds, vaultRef.current);
      const saved = await save(
        vaultRef.current,
        identity.id ?? LEGACY_VAULT_ID,
        identity,
        session,
      );
      if (saved && identity.id === null) {
        // The notes are stored again, so the vault needs an identity before
        // the next keystroke can be written. The catalog stays as it is: a
        // broken catalog must not take the storage away again.
        identityRef.current = { id: LEGACY_VAULT_ID, generation: identityRef.current.generation + 1 };
        setVaultId(LEGACY_VAULT_ID);
      }
      return;
    }

    await boot();
  }, [boot, openNoteIds, retryKind, save, storageMode]);

  /**
   * Reads the catalog again when the manager opens.
   *
   * The manager has to show the vaults that are really in the storage, so a
   * vault that was created in another tab is there too.
   */
  useEffect(() => {
    if (!managerOpen) return;
    void (async () => {
      try {
        const fresh = await loadCatalog();
        if (fresh) setCatalog(fresh);
      } catch {
        // The manager keeps the catalog it has.
      }
    })();
  }, [managerOpen]);

  /**
   * Runs a command of the catalog.
   *
   * The toolbar, the shortcuts and the palette all go through here, so a
   * command that cannot run does nothing everywhere.
   */
  const runCommand = useCallback((id: string) => {
    const command = commandsRef.current.find((entry) => entry.id === id);
    if (!command || command.disabledReason) return;
    command.run();
  }, []);

  /**
   * The catalog of the app.
   *
   * Every action that really exists has a label, a category and a real
   * handler. A command that needs a note and has none says so instead of
   * disappearing from the list.
   */
  const commands = useMemo<CommandAction[]>(
    () =>
      buildCommands(
        {
          hasActiveNote: vault.activeNoteId !== null,
          canUndo: undo !== null,
          openTabCount: tabIds.length,
          contextPanelToggleable: compact,
        },
        {
          createNote: handleCreate,
          renameNote: handleRenameActive,
          trashNote: handleTrashActive,
          undo: handleUndo,
          importMarkdown: handleImport,
          exportVault: handleExport,
          setViewMode: setView,
          openSwitcher: openSwitcher,
          focusSearch: requestSearch,
          openVaultManager: openVaultManager,
          toggleContextPanel: toggleContextPanel,
          closeTab: closeActiveTab,
          nextTab: () => handleStepTab(1),
          previousTab: () => handleStepTab(-1),
        },
      ),
    [
      compact,
      closeActiveTab,
      handleCreate,
      handleExport,
      handleImport,
      handleRenameActive,
      handleStepTab,
      handleTrashActive,
      handleUndo,
      openSwitcher,
      openVaultManager,
      requestSearch,
      tabIds.length,
      toggleContextPanel,
      undo,
      vault.activeNoteId,
    ],
  );
  commandsRef.current = commands;

  // A modal is open: a shortcut behind it would act on a note the user
  // cannot see.
  const modalOpen = paletteOpen || switcherOpen || managerOpen;

  // The palette, the quick switcher and the new note are reachable from
  // anywhere, including from the editor.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === 'p') {
        // The browser would print the page; the quick switcher takes the
        // shortcut, and the print dialog never opens.
        event.preventDefault();
        if (modalOpen) return;
        setSwitcherOpen(true);
        return;
      }
      if (key === 'k') {
        event.preventDefault();
        if (modalOpen) return;
        setPaletteOpen(true);
        return;
      }
      if (key === 'n') {
        if (modalOpen) return;
        event.preventDefault();
        runCommand('note.new');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, runCommand]);

  // The graph parses every body, so it follows the vault at background
  // priority instead of on every keystroke.
  const deferredVault = useDeferredValue(vault);
  const graph = useMemo(
    () => buildLocalGraph(deferredVault, deferredVault.activeNoteId ?? ''),
    [deferredVault],
  );
  // While the graph trails the vault it may be empty for the wrong reason.
  const graphPending = deferredVault !== vault;
  const noteNames = useMemo(
    () => new Set(activeNotes(vault).map((note) => normalizeNoteName(note.name).toLowerCase())),
    [vault],
  );

  if (phase === 'loading') {
    return (
      <main className="workspace-loading" aria-label="Opening the local vault">
        <p className="workspace-loading__text">Opening local vault…</p>
      </main>
    );
  }

  if (phase === 'onboarding') {
    return <Onboarding onCreate={handleOnboardingCreate} />;
  }

  return (
    <>
      <Workspace
        vault={vault}
        status={status}
        error={error}
        importError={importError}
        canUndo={undo !== null}
        focusNote={focusNote}
        graph={graph}
        noteNames={noteNames}
        graphPending={graphPending}
        vaultName={catalog && vaultId ? vaultName(catalog, vaultId) : null}
        searchInputRef={searchInputRef}
        editorRef={editorRef}
        previewRef={previewRef}
        searchRequest={searchRequest}
        focusContentRequest={focusContentRequest}
        focusContent={focusContent}
        tabIds={tabIds}
        tabFocus={tabFocus}
        view={view}
        onViewChange={setView}
        contextToggleRequest={contextToggleRequest}
        onCompactChange={setCompact}
        onOpenVaults={openVaultManager}
        onOpenPalette={openPalette}
        onRetry={() => {
          void handleRetry();
        }}
        onDismissImport={() => setImportError(null)}
        onSelect={handleSelect}
        onNavigate={handleNavigate}
        onCreate={() => runCommand('note.new')}
        onRename={handleRename}
        onDelete={handleDelete}
        onRestore={handleRestore}
        onChange={handleChange}
        onUndo={handleUndo}
        onWikiLink={handleWikiLink}
        onAnnounce={announce}
        onImport={handleImport}
        onExport={handleExport}
        onImportFiles={handleImportFiles}
        onSelectTab={handleSelect}
        onCloseTab={handleCloseTab}
        fileInputRef={fileInputRef}
      />
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
        onAnnounce={announce}
      />
      <QuickSwitcher
        open={switcherOpen}
        vault={vault}
        onClose={() => setSwitcherOpen(false)}
        onSelect={handleSelect}
        onAnnounce={announce}
      />
      {catalog && vaultId ? (
        <VaultManager
          open={managerOpen}
          catalog={catalog}
          activeVaultId={vaultId}
          onClose={() => setManagerOpen(false)}
          onOpen={(id) => {
            void switchVault(id);
          }}
          onRename={(id, name) => {
            void handleRenameVault(id, name);
          }}
          onArchive={(id) => {
            void handleArchiveVault(id);
          }}
          onRestore={(id) => {
            void handleRestoreVault(id);
          }}
          onCreate={(name) => {
            void handleCreateVault(name);
          }}
        />
      ) : null}
    </>
  );
}

/** The name of a vault in the catalog. */
function vaultName(catalog: VaultCatalog, id: string): string {
  return catalog.vaults.find((member) => member.id === id)?.name ?? 'this vault';
}

/**
 * The open notes of a vault, as the session that is stored with it.
 *
 * The ids are cleaned up first, so a note that is gone never stays in the
 * stored session and the note that is on the screen always has a tab.
 */
function sessionOf(openNoteIds: readonly string[], vault: Vault): VaultTabSession {
  return {
    version: 1,
    openNoteIds: sanitizeTabIds(openNoteIds, vault, vault.activeNoteId),
  };
}

/** True when two lists of ids hold the same ids in the same order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Merges a skip list into the summary one entry at a time.
 *
 * A spread would put every entry into the argument list of one call, and a
 * long list (an envelope far over the note ceiling) would overflow it. The
 * import would then fail instead of importing the notes it may.
 */
function mergeSkips(target: ImportSkip[], source: ImportSkip[]): void {
  for (const entry of source) target.push(entry);
}

/** The lower case extension of a file name, without the dot. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The note name of an imported Markdown file, without its extension. */
function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/** The one line summary of an import, for the polite live region. */
function describeImport(imported: number, skipped: ImportSkip[]): string {
  const parts = [`Imported ${imported} ${imported === 1 ? 'note' : 'notes'}`];
  if (skipped.length > 0) {
    // The live region is read out loud, so the list stays short.
    const shown = skipped
      .slice(0, 5)
      .map((entry) => `${entry.name} (${SKIP_REASONS[entry.reason]})`);
    const rest = skipped.length - shown.length;
    if (rest > 0) shown.push(`and ${rest} more`);
    parts.push(`skipped ${skipped.length}: ${shown.join(', ')}`);
  }
  return parts.join(', ');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'the storage could not be read.';
}
