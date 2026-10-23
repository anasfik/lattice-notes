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
  purgeNote,
  renameNote,
  restoreNote,
  updateNoteBody,
} from './domain/vault';
import { buildCommands } from './domain/commands';
import type { CommandAction, ViewMode } from './domain/commands';
import { formatLocalDate, openDailyNote } from './domain/dailyNotes';
import { firstNoteName, splitNotePath } from './domain/folders';
import { toggleBookmark as toggleBookmarkEntry } from './domain/bookmarks';
import type { Bookmark } from './domain/bookmarks';
import { goBack, goForward, pushHistory } from './domain/history';
import type { HistoryState } from './domain/history';
import { closeTab, sanitizeTabIds, stepTab } from './domain/tabs';
import { DEFAULT_SETTINGS } from './domain/settings';
import type { AppSettings } from './domain/settings';
import { retentionCutoff, shouldCapture } from './domain/snapshots';
import type { Snapshot } from './domain/snapshots';
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
  listSnapshots,
  loadBookmarks,
  loadCatalog,
  loadSettings,
  loadVault,
  loadVaultSession,
  openStoredVault,
  pruneSnapshots,
  purgeStoredNote,
  reclaimSnapshotSpace,
  renameStoredVault,
  restoreStoredVault,
  saveBookmarks,
  saveSettings,
  saveVault,
  writeSnapshot,
} from './storage/vaultRepository';
import type { VaultCatalog, VaultTabSession } from './storage/vaultRepository';
import CommandPalette from './components/CommandPalette';
import Calendar from './components/Calendar';
import ConfirmDialog from './components/ConfirmDialog';
import GraphView from './components/GraphView';
import Onboarding from './components/Onboarding';
import QuickSwitcher from './components/QuickSwitcher';
import RecoveryDialog from './components/RecoveryDialog';
import SettingsDialog from './components/SettingsDialog';
import ShortcutHelp from './components/ShortcutHelp';
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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  /** The settings of the app, as they are stored right now. */
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  /** True while the settings dialog is on the screen. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** True while the recovery history of the note is on the screen. */
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  /** True while the history of the note is being read. */
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  /** The note the history on the screen belongs to. */
  const [recoveryNoteId, setRecoveryNoteId] = useState<string | null>(null);
  /** The reason the history could not be read, if it could not be read. */
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  /** The kept bodies of the note that is on the screen. */
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  /** The note that waits for the confirmation of the move to the trash. */
  const [trashTarget, setTrashTarget] = useState<string | null>(null);
  /** The note that waits for the confirmation of the permanent delete. */
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  /**
   * Counts the requests to open the form of a new folder.
   *
   * The form lives in the sidebar, so the command that opens it asks the
   * sidebar for it, the way the command that renames a note asks the list of
   * the notes.
   */
  const [folderRequest, setFolderRequest] = useState(0);
  const [searchRequest, setSearchRequest] = useState(0);
  const [focusContentRequest, setFocusContentRequest] = useState(0);
  /**
   * Asks the list of the notes to open its rename field on a note.
   *
   * The command renames the note of the screen in the place where the reader
   * can see the name, so the list of the notes opens the field itself.
   */
  const [renameRequest, setRenameRequest] = useState<{ id: string; request: number } | null>(
    null,
  );
  /** The open notes of the vault on the screen, in the order of the strip. */
  const [openNoteIds, setOpenNoteIds] = useState<string[]>([]);
  /**
   * The trail of the notes of this tab.
   *
   * The trail lives in memory: it is gone when the tab is reloaded, and it
   * starts again with every vault.
   */
  const [history, setHistory] = useState<HistoryState>(() => ({ past: [], future: [] }));
  /** The bookmarks of the vault on the screen. */
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  /** True while the bookmarks of the vault are being read. */
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  /** Why the bookmarks could not be read, or nothing when they could. */
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const [bookmarkReadRequest, setBookmarkReadRequest] = useState(0);
  /** True while the outline of the note is on the screen. */
  const [outlineOpen, setOutlineOpen] = useState(false);
  /** True while the bookmarks are on the screen. */
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  /**
   * The heading the reader wants to see.
   *
   * The jump waits for the preview to be on the screen, so the request keeps
   * the heading until it can be shown.
   */
  const [headingJump, setHeadingJump] = useState<{ id: string; request: number } | null>(null);
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
  /** The latest settings, so callbacks that never rerun read the retention. */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
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
  /**
   * The vault the catalog points at.
   *
   * It is remembered as soon as the catalog was read, because the recovery
   * needs the vault of the session even when opening it failed and the
   * session never got an identity of its own.
   */
  const activeVaultIdRef = useRef<string | null>(null);
  const saveSeqRef = useRef(0);
  /** Counts the requests to rename a note, so every one of them is a new one. */
  const renameSeqRef = useRef(0);
  const lastSaveSeqRef = useRef(new Map<string, number>());
  const bootedRef = useRef(false);
  const loadFailuresRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<boolean> | null>(null);
  const switchRef = useRef<{ promise: Promise<void> } | null>(null);
  const queuedSwitchRef = useRef<string | null>(null);
  const creatingRef = useRef(false);
  /** The moment of the last kept body of every note, so the history is calm. */
  const snapshotAtRef = useRef(new Map<string, number>());
  /** The trail of the notes, so a handler reads the trail of this moment. */
  const historyRef = useRef<HistoryState>({ past: [], future: [] });
  /** The bookmarks of the vault, so a handler reads the list of this moment. */
  const bookmarksRef = useRef<Bookmark[]>([]);
  /** The vault whose bookmarks the list holds, or nothing while it is being read. */
  const bookmarksVaultRef = useRef<string | null>(null);
  /** Counts the changes of the list, so a read in flight is not written over. */
  const bookmarkChangeRef = useRef(0);
  /** The catalog of the app, so a shortcut always runs the current command. */
  const commandsRef = useRef<CommandAction[]>([]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const graphTriggerRef = useRef<HTMLButtonElement>(null);
  /** True while the graph closed because a note was opened from it. */
  const graphOpenedNote = useRef(false);
  /** True while the graph was on the screen, so the close is only handled once. */
  const graphWasOpen = useRef(false);

  /** The undo slot of the vault that is on the screen. */
  const undoKey = vaultId ?? '';
  const undo = undoSlots[undoKey] ?? null;

  /** The trail and the bookmarks of this moment, for the handlers that read them. */
  historyRef.current = history;
  bookmarksRef.current = bookmarks;

  /** The open notes that may be shown as tabs. */
  const tabIds = useMemo(
    () => sanitizeTabIds(openNoteIds, vault, vault.activeNoteId),
    [openNoteIds, vault],
  );

  /** The notes of the vault that are not in the trash. */
  const activeNoteList = useMemo(() => activeNotes(vault), [vault]);

  /** The ids of the notes the trail may still open. */
  const liveNoteIds = useMemo(
    () => new Set(activeNoteList.map((note) => note.id)),
    [activeNoteList],
  );

  /** The note that waits for the confirmation of the move to the trash. */
  const trashNote = useMemo(
    () => vault.notes.find((note) => note.id === trashTarget) ?? null,
    [trashTarget, vault],
  );

  /** The note that waits for the confirmation of the permanent delete. */
  const permanentNote = useMemo(
    () => vault.notes.find((note) => note.id === deleteTarget) ?? null,
    [deleteTarget, vault],
  );

  /** The note the recovery history on the screen belongs to. */
  const recoveryNote = useMemo(
    () => vault.notes.find((note) => note.id === recoveryNoteId) ?? null,
    [recoveryNoteId, vault],
  );

  /** True when the note on the screen is a bookmark already. */
  const activeBookmarked = useMemo(
    () =>
      bookmarks.some(
        (bookmark) => bookmark.kind === 'note' && bookmark.target === vault.activeNoteId,
      ),
    [bookmarks, vault.activeNoteId],
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
   * notes come with the vault, so two vaults never share a tab list. The trail
   * of the notes starts again with the vault, because it belongs to it.
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
      const active = next.activeNoteId;
      setHistory(active ? { past: [{ noteId: active, at: Date.now() }], future: [] } : { past: [], future: [] });
    },
    [],
  );

  /**
   * Keeps the trail of the notes.
   *
   * The note on the screen is the last entry of the trail, so a note that is
   * opened twice in a row is one entry. A note that is opened after a step
   * back clears the future, because the trail no longer leads there.
   */
  useEffect(() => {
    const id = vault.activeNoteId;
    if (!id) return;
    setHistory((state) => pushHistory(state, id, Date.now()));
  }, [vault.activeNoteId]);

  /**
   * Reads the bookmarks of the vault on the screen.
   *
   * A broken record is dropped and reported, so it never stops the notes from
   * loading. The bookmarks of another vault are never in the list. A list
   * that the reader changed while it was being read is not written over.
   */
  useEffect(() => {
    const id = vaultId;
    if (!id) {
      setBookmarks([]);
      setBookmarksLoading(false);
      bookmarksRef.current = [];
      bookmarksVaultRef.current = null;
      setBookmarkError(null);
      return;
    }
    const changes = bookmarkChangeRef.current;
    let cancelled = false;
    // No list can be replaced until the current vault's read has succeeded.
    bookmarksRef.current = [];
    bookmarksVaultRef.current = null;
    setBookmarks([]);
    setBookmarkError(null);
    setBookmarksLoading(true);
    void (async () => {
      try {
        const read = await loadBookmarks(id);
        if (cancelled) return;
        if (bookmarkChangeRef.current !== changes) return;
        setBookmarks(read.bookmarks);
        bookmarksRef.current = read.bookmarks;
        bookmarksVaultRef.current = id;
        setBookmarkError(null);
        if (read.dropped > 0) {
          setStatus(
            `${read.dropped} broken bookmark${read.dropped === 1 ? '' : 's'} could not be read and ${
              read.dropped === 1 ? 'was' : 'were'
            } ignored.`,
          );
        }
      } catch {
        if (cancelled) return;
        if (bookmarkChangeRef.current !== changes) return;
        setBookmarkError('The bookmarks of this vault could not be read.');
        setStatus('The bookmarks of this vault could not be read.');
        // Keep writes disabled: replacing an unread list would lose bookmarks.
        bookmarksVaultRef.current = null;
      } finally {
        if (!cancelled) setBookmarksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vaultId, bookmarkReadRequest]);

  /**
   * Keeps the bodies that a save replaces.
   *
   * The body of the last save is the one a reader would want back, so it is
   * written to the history before the new body is stored. A history that
   * cannot be written is a message and never a lost note, so the failure is
   * returned and the save carries on. One note that cannot be kept does not
   * stop the others: the first failure is the one that is reported.
   */
  const captureHistory = useCallback(
    async (before: Vault, after: Vault, target: string): Promise<string | null> => {
      if (settings.snapshotIntervalMinutes <= 0) return null;
      const now = Date.now();
      const cutoff = retentionCutoff(now, settings.snapshotRetentionDays);
      let failure: string | null = null;
      // The bodies of the last save, read in one pass, so a vault with many
      // notes does not turn every keystroke into a scan of the vault.
      const oldBodies = new Map(before.notes.map((note) => [note.id, note.body]));
      for (const note of after.notes) {
        const old = oldBodies.get(note.id);
        if (old === undefined || old === note.body) continue;
        const last = snapshotAtRef.current.get(note.id) ?? 0;
        if (!shouldCapture(last, now, settings.snapshotIntervalMinutes)) continue;
        try {
          // The write is bounded: the bodies of the vault share a byte budget
          // and the bodies that are too old are swept in the same transaction.
          await writeSnapshot(target, note.id, old, { cutoff });
        } catch {
          if (!failure) failure = 'The recovery history of this note could not be written.';
          continue;
        }
        snapshotAtRef.current.set(note.id, now);
      }
      return failure;
    },
    [settings.snapshotIntervalMinutes, settings.snapshotRetentionDays],
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
        // The body that is replaced is kept first, so the reader can get it
        // back. The history never stops the note.
        const history = await captureHistory(baseRef.current, next, target);
        // A session that was never read is left out of the write, so the
        // stored tab list cannot be replaced by an empty strip.
        const writeVault = () => saveVault(next, target, session ?? undefined);
        try {
          await writeVault();
        } catch (error) {
          if (!isQuotaError(error)) {
            if (isCurrent(identity)) {
              setError('Local storage rejected the save. Your notes are still here in this tab.');
              setRetryKind('save');
            }
            return false;
          }
          // The storage is full. The history gives way so the notes of the
          // reader can be stored, and the save is tried once more. The draft
          // stays in this tab either way.
          try {
            await reclaimSnapshotSpace(target);
            await writeVault();
          } catch {
            if (isCurrent(identity)) {
              setError('Local storage is full. Your notes are still here in this tab.');
              setRetryKind('save');
            }
            return false;
          }
        }
        // A newer write to the same slot wins, and a write of a vault that
        // is not on the screen any more is dropped.
        if (lastSaveSeqRef.current.get(target) !== seq) return true;
        if (!isCurrent(identity)) return true;
        baseRef.current = next;
        if (session) baseSessionRef.current = session.openNoteIds;
        setError(null);
        setStorageMode('ready');
        setStatus(history ?? 'Saved to local storage');
        return true;
      })();
      pendingSaveRef.current = write;
      try {
        return await write;
      } finally {
        if (pendingSaveRef.current === write) pendingSaveRef.current = null;
      }
    },
    [captureHistory, isCurrent],
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

      // The catalog was read, so the vault it points at is known even when
      // opening it fails. The recovery replaces that vault, not the legacy
      // one.
      activeVaultIdRef.current = stored.activeVaultId;

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
    void (async () => {
      // The settings are read before the vault, so the app knows how it
      // behaves before the first note is on the screen. A settings record
      // that cannot be read is a message, never a broken vault.
      let settingsFailed = false;
      try {
        setSettings(await loadSettings());
      } catch {
        settingsFailed = true;
        setSettings(DEFAULT_SETTINGS);
      }
      await boot();
      if (settingsFailed) setStatus('The settings could not be read, so the defaults are used.');
    })();
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

  /** Asks the sidebar for the form of a new folder. */
  const requestFolderForm = useCallback(() => {
    setFolderRequest((request) => request + 1);
  }, []);

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
   * Asks for the search field. The workspace opens the notes panel first when
   * the search field sits inside a closed panel.
   */
  const requestSearch = useCallback(() => {
    setSearchRequest((request) => request + 1);
  }, []);

  /**
   * Opens a note of the trail and says where the reader came from.
   *
   * A note that is gone is not opened again: the trail keeps its place and
   * the reader is told what happened.
   */
  const openNoteFromHistory = useCallback(
    (id: string, message: string) => {
      const current = vaultRef.current;
      const note = current.notes.find((candidate) => candidate.id === id);
      // A note in the trash is not a note on the screen, so the trail stops
      // there and says where the note went.
      if (!note || note.deletedAt !== null) {
        setStatus(note ? 'The note of the history is in the trash.' : 'The note of the history is gone.');
        return;
      }
      if (current.activeNoteId !== id) applyVault({ ...current, activeNoteId: id });
      rememberTab(id);
      setStatus(`${message} ${note.name}`);
    },
    [applyVault, rememberTab],
  );

  /**
   * Goes back to the note the reader came from.
   *
   * The trail lives in this tab, so a reload starts without one and there is
   * nothing to go back to.
   */
  const handleHistoryBack = useCallback(() => {
    const result = goBack(historyRef.current);
    if (!result.noteId) {
      setStatus('There is nothing to go back to.');
      return;
    }
    setHistory(result.state);
    openNoteFromHistory(result.noteId, 'Back to');
  }, [openNoteFromHistory]);

  /** Goes forward to the note the reader left. */
  const handleHistoryForward = useCallback(() => {
    const result = goForward(historyRef.current);
    if (!result.noteId) {
      setStatus('There is nothing to go forward to.');
      return;
    }
    setHistory(result.state);
    openNoteFromHistory(result.noteId, 'Forward to');
  }, [openNoteFromHistory]);

  /**
   * Writes the bookmarks of the vault.
   *
   * The write carries the identity of the vault it belongs to, so a write
   * that lands after a switch never puts the bookmarks of one vault into
   * another. A write that fails is a message in the status line.
   */
  const writeBookmarkList = useCallback(
    (list: Bookmark[], message: string) => {
      const identity = identityRef.current;
      const target = identity.id;
      if (!target) {
        setStatus(`${message} (only in this tab)`);
        return;
      }
      setStatus(message);
      void (async () => {
        try {
          await saveBookmarks(target, list);
        } catch {
          if (!isCurrent(identity)) return;
          setStatus('The bookmarks could not be saved, so they are only used in this tab.');
        }
      })();
    },
    [isCurrent],
  );

  /**
   * Adds the note on the screen to the bookmarks, or takes it off.
   *
   * The bookmarks belong to the vault, so they are there after a reload and
   * they never mix with the bookmarks of another vault.
   */
  const handleToggleBookmark = useCallback(() => {
    const current = vaultRef.current;
    const id = current.activeNoteId;
    if (!id) {
      setStatus('Open a note first to bookmark it.');
      return;
    }
    const note = current.notes.find((candidate) => candidate.id === id);
    if (!note) return;
    if (bookmarksVaultRef.current !== identityRef.current.id) {
      setStatus('The bookmarks have not been read. Wait, or retry in the Bookmarks panel.');
      return;
    }
    const candidate = {
      kind: 'note' as const,
      target: note.id,
      title: note.name,
      group: bookmarkGroup(note.name),
    };
    const list = toggleBookmarkEntry(bookmarksRef.current, candidate);
    const added = list.length > bookmarksRef.current.length;
    bookmarksRef.current = list;
    bookmarkChangeRef.current += 1;
    setBookmarks(list);
    writeBookmarkList(
      list,
      added ? `Bookmarked ${note.name}` : `Removed the bookmark of ${note.name}`,
    );
  }, [writeBookmarkList]);

  /** Takes a bookmark off the list of the vault. */
  const handleRemoveBookmark = useCallback(
    (bookmark: Bookmark) => {
      if (bookmarksVaultRef.current !== identityRef.current.id) {
        setStatus('The bookmarks are still being read. Try again in a moment.');
        return;
      }
      const list = bookmarksRef.current.filter((entry) => entry.id !== bookmark.id);
      bookmarksRef.current = list;
      bookmarkChangeRef.current += 1;
      setBookmarks(list);
      writeBookmarkList(list, `Removed the bookmark of ${bookmark.title}`);
    },
    [writeBookmarkList],
  );

  /**
   * Jumps to a heading of the note on the screen.
   *
   * The preview has to be on the screen, so the view turns to the split mode
   * when the reader is writing. The jump itself happens when the preview
   * shows the heading.
   */
  const jumpToHeading = useCallback(
    (id: string) => {
      setHeadingJump((request) => ({ id, request: (request?.request ?? 0) + 1 }));
      if (view === 'write') setView('split');
    },
    [view],
  );

  /**
   * Opens the note a bookmark points at.
   *
   * A bookmark of a heading opens the note of the heading and then the place
   * in it. A bookmark of a search asks for the search field, because the
   * query of a search belongs to the field.
   */
  const handleOpenBookmark = useCallback(
    (bookmark: Bookmark) => {
      if (bookmark.kind === 'search') {
        requestSearch();
        setStatus(`Search for “${bookmark.title}”`);
        return;
      }
      const noteId =
        bookmark.kind === 'heading' ? (bookmark.target.split('#')[0] ?? '') : bookmark.target;
      const note = vaultRef.current.notes.find((candidate) => candidate.id === noteId);
      if (!note) {
        setStatus('The note of that bookmark is gone.');
        return;
      }
      if (note.deletedAt !== null) {
        // A note in the trash is not on the screen, so the bookmark does not
        // open it. The reader can restore it from the trash.
        setStatus('The note of that bookmark is in the trash.');
        return;
      }
      handleSelect(note.id);
      if (bookmark.kind === 'heading') {
        const heading = bookmark.target.slice(noteId.length + 1);
        if (heading) jumpToHeading(heading);
      }
    },
    [handleSelect, jumpToHeading, requestSearch],
  );

  // The jump waits for the preview to be on the screen.
  useEffect(() => {
    const request = headingJump;
    if (!request) return;
    if (view === 'write') return;
    const target = document.getElementById(request.id);
    if (!target) {
      setStatus('That heading is not on the screen.');
      setHeadingJump(null);
      return;
    }
    target.scrollIntoView({ block: 'start' });
    // The keyboard follows the heading, so the reader can go on from there.
    (target as HTMLElement).focus({ preventScroll: true });
    setHeadingJump(null);
  }, [headingJump, view]);

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

  /**
   * Creates the first note of a new folder.
   *
   * A folder is a path in the name of a note, so a new folder is a new note
   * whose name starts with the path of the folder. The note is opened at
   * once, because it is the note the reader is there for.
   */
  const handleCreateFolder = useCallback(
    (path: string) => {
      const current = vaultRef.current;
      const { vault: next, note } = createNote(current, firstNoteName(path));
      applyVault({ ...next, activeNoteId: note.id });
      rememberTab(note.id);
      setStatus(`Created the folder ${path} with the note ${note.name}`);
      focusContent();
    },
    [applyVault, focusContent, rememberTab],
  );

  const handleRename = useCallback((id: string, name: string) => {
    const current = vaultRef.current;
    const { vault: next, note } = renameNote(current, id, name);
    if (!note || next === current) return;
    applyVault(next);
    setStatus(`Renamed to ${note.name}`);
  }, [applyVault]);

  /**
   * Moves a note to the trash.
   *
   * The trash keeps the note, so the delete is reversible. The undo slot
   * belongs to the vault the note was deleted in.
   */
  const deleteNoteNow = useCallback(
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

  /**
   * Moves a note to the trash, asking first when the reader wants to be asked.
   *
   * The setting is about the moment of the delete, not about the outcome:
   * a trashed note stays recoverable either way.
   */
  const handleDelete = useCallback(
    (id: string) => {
      if (!settings.confirmDelete) {
        deleteNoteNow(id);
        return;
      }
      setTrashTarget(id);
    },
    [deleteNoteNow, settings.confirmDelete],
  );

  /** Moves the note that waits for the confirmation to the trash. */
  const handleConfirmTrash = useCallback(() => {
    const id = trashTarget;
    setTrashTarget(null);
    if (!id) return;
    deleteNoteNow(id);
  }, [deleteNoteNow, trashTarget]);

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

  /**
   * Opens the recovery history of the note that is on the screen.
   *
   * The history belongs to the note and to the vault it is in, so a note of
   * another vault never shows the bodies of this one. The note the history
   * belongs to is remembered, so the dialog keeps talking about that note
   * even when the reader opens another one while it is on the screen.
   */
  const openRecovery = useCallback(() => {
    const id = vaultRef.current.activeNoteId;
    const target = identityRef.current.id;
    if (!id) {
      setStatus('Open a note first to see its history.');
      return;
    }
    if (!target) {
      setStatus('The note is not in a vault, so it has no history.');
      return;
    }
    setSnapshots([]);
    setRecoveryError(null);
    setRecoveryNoteId(id);
    setRecoveryLoading(true);
    setRecoveryOpen(true);
    void (async () => {
      try {
        // The retention window applies even when capturing is off: a body
        // past it is neither listed here nor left in the storage.
        const cutoff = retentionCutoff(Date.now(), settingsRef.current.snapshotRetentionDays);
        const stored = await listSnapshots(target, id);
        const kept = stored.filter((snapshot) => snapshot.at >= cutoff);
        if (kept.length !== stored.length) {
          try {
            await pruneSnapshots(target, cutoff);
          } catch {
            // A history that cannot be swept is still hidden on the screen.
          }
        }
        setSnapshots(kept);
      } catch {
        // A history that cannot be read is an error, not an empty history.
        setRecoveryError('The recovery history of this note could not be read.');
        setStatus('The recovery history of this note could not be read.');
      } finally {
        setRecoveryLoading(false);
      }
    })();
  }, []);

  /** Closes the history of a note that is gone. */
  const closeRecoveryOf = useCallback(
    (noteId: string) => {
      if (recoveryNoteId !== noteId) return;
      setRecoveryOpen(false);
      setSnapshots([]);
      setRecoveryNoteId(null);
      setRecoveryError(null);
    },
    [recoveryNoteId],
  );

  /**
   * Puts an earlier body back into the note.
   *
   * The body that is on the screen is kept first, so the restore can be
   * undone the same way. A body that cannot be kept is a message, and
   * nothing is restored.
   *
   * The identity of the vault is taken before the body is kept and checked
   * again afterwards, so a restore that runs while another vault takes the
   * screen never writes into that vault. A body that changed in the meantime
   * is not replaced either: the reader wrote it and it is not ours to drop.
   */
  const handleRestoreSnapshot = useCallback(
    async (snapshot: Snapshot) => {
      const identity = identityRef.current;
      const target = identity.id;
      if (!target || snapshot.vaultId !== target) {
        setStatus('The note of that history is not in this vault.');
        return;
      }
      const note = vaultRef.current.notes.find((candidate) => candidate.id === snapshot.noteId);
      if (!note) {
        setStatus('The note of that history is not in this vault.');
        return;
      }
      const body = note.body;
      try {
        await writeSnapshot(target, note.id, body);
      } catch {
        setStatus('The body on the screen could not be kept, so nothing was restored.');
        return;
      }
      // Another vault took the screen while the body was kept.
      if (!isCurrent(identity)) return;
      const current = vaultRef.current;
      const live = current.notes.find((candidate) => candidate.id === note.id);
      if (!live) {
        setStatus('The note of that history is not in this vault.');
        return;
      }
      // The reader wrote something while the body was kept, so the body on the
      // screen is not the one that was here before.
      if (live.body !== body) {
        setStatus('The note changed while the history was read, so the body was not replaced.');
        return;
      }
      snapshotAtRef.current.set(note.id, Date.now());
      const { vault: next } = updateNoteBody(current, note.id, snapshot.body);
      applyVault({ ...next, activeNoteId: note.id });
      setRecoveryOpen(false);
      setStatus(`Restored an earlier body of ${note.name}`);
    },
    [applyVault, isCurrent],
  );

  /** Asks for the confirmation of the permanent delete of the note on the screen. */
  const openDeletePermanent = useCallback(() => {
    const id = vaultRef.current.activeNoteId;
    if (!id) return;
    setDeleteTarget(id);
  }, []);

  /**
   * Removes a note and its history for good.
   *
   * This is the only action of the product that cannot be undone, so the
   * dialog asked for the name of the note first. The note leaves the vault
   * only when the storage says so: the document, the tab list and the kept
   * bodies of the note are written and removed in one transaction, so a
   * refused write leaves the note and its history exactly as they were.
   */
  const handleDeletePermanent = useCallback(async () => {
    const id = deleteTarget;
    setDeleteTarget(null);
    const current = vaultRef.current;
    const note = current.notes.find((candidate) => candidate.id === id);
    if (!note) return;
    const identity = identityRef.current;
    const target = identity.id;

    if (!target) {
      // The notes only live in this tab, so the delete is a delete in memory.
      const { vault: next } = purgeNote(current, note.id);
      applyVault(next);
      setOpenNoteIds((ids) => ids.filter((candidate) => candidate !== note.id));
      setFocusNote(next.activeNoteId ? { kind: 'note', id: next.activeNoteId } : { kind: 'empty' });
      setUndoSlots((slots) => {
        if (slots[undoKey]?.id !== note.id) return slots;
        const rest = { ...slots };
        delete rest[undoKey];
        return rest;
      });
      closeRecoveryOf(note.id);
      setStatus(`Deleted ${note.name} for good (not saved — use Export)`);
      return;
    }

    // A write that is still running would put the note back after the
    // deletion, so it is finished first.
    const flushed = await flushPendingSave();
    if (!flushed) {
      setStatus(`The notes of this vault could not be saved, so ${note.name} was not deleted.`);
      return;
    }
    // Another vault took the screen while the save was flushed. The note
    // belongs to the vault that was captured above, so this screen keeps its
    // own notes and writes nothing.
    if (!isCurrent(identity)) return;
    const before = vaultRef.current;
    if (!before.notes.some((candidate) => candidate.id === note.id)) return;

    const ids = openNoteIds.filter((candidate) => candidate !== note.id);
    const purged = purgeNote(before, note.id).vault;
    // A tab list that was never read is left out of the write, so the stored
    // one cannot be replaced by an empty strip.
    const session = sessionKnownRef.current ? sessionOf(ids, purged) : undefined;
    try {
      await purgeStoredNote(target, purged, note.id, session);
    } catch {
      if (isCurrent(identity)) {
        setError(
          `${note.name} could not be deleted: the local storage refused the write. The note and its history are unchanged.`,
        );
        setRetryKind('save');
        setStatus('The note was not deleted');
      }
      return;
    }
    // Another vault took the screen while the note was deleted: the deletion
    // landed in the vault it belongs to, and this screen says nothing about
    // it.
    if (!isCurrent(identity)) return;

    // The notes that were written while the deletion was running stay in the
    // vault, so they are never lost by the deletion.
    const next = purgeNote(vaultRef.current, note.id).vault;
    const unchanged = vaultRef.current === before;
    applyVault(next);
    setOpenNoteIds(ids);
    setFocusNote(next.activeNoteId ? { kind: 'note', id: next.activeNoteId } : { kind: 'empty' });
    setUndoSlots((slots) => {
      if (slots[undoKey]?.id !== note.id) return slots;
      const rest = { ...slots };
      delete rest[undoKey];
      return rest;
    });
    closeRecoveryOf(note.id);
    // The storage holds this vault and this tab list now, so the debounced
    // save has nothing left to write. When the reader wrote something in the
    // meantime, the stored vault is older than the screen and the debounced
    // save writes the difference.
    if (unchanged) {
      baseRef.current = next;
      if (session) baseSessionRef.current = session.openNoteIds;
    }
    setStatus(`Deleted ${note.name} for good`);
  }, [applyVault, deleteTarget, flushPendingSave, isCurrent, openNoteIds, undoKey]);

  /** Opens the settings of the app. */
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  /**
   * Writes the settings of the app.
   *
   * The settings are used in this tab right away, and the write to the
   * storage never touches the notes. A write that fails is a message in the
   * status line.
   */
  const handleApplySettings = useCallback((next: AppSettings) => {
    setSettings(next);
    setSettingsOpen(false);
    void (async () => {
      try {
        await saveSettings(next);
        setStatus('Settings saved');
      } catch {
        setStatus('The settings could not be saved, so they are only used in this tab.');
      }
    })();
  }, []);

  /**
   * Shows the theme of the app.
   *
   * The theme follows the system until the reader picks another one, and the
   * page follows the reader's system when it changes.
   */
  useEffect(() => {
    const root = document.documentElement;
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media?.matches === true);
      root.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    media?.addEventListener('change', apply);
    return () => {
      media?.removeEventListener('change', apply);
    };
  }, [settings.theme]);

  /** Renames the note that is on the screen. */
  const handleRenameActive = useCallback(() => {
    const current = vaultRef.current;
    const id = current.activeNoteId;
    if (!id) return;
    const note = current.notes.find((candidate) => candidate.id === id);
    if (!note) return;
    // The list of the notes owns the field of the name, so the command asks
    // for that field instead of opening a prompt of the platform.
    renameSeqRef.current += 1;
    setRenameRequest({ id, request: renameSeqRef.current });
  }, []);

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

  /**
   * Opens the note of a day.
   *
   * The note of a day is the one whose title is the date, so a day is never
   * written twice. The note goes through the same path as every other note,
   * so the tab, the selection and the save follow it.
   */
  const handleOpenDailyNote = useCallback(
    (dateKey: string) => {
      const { vault: next, note } = openDailyNote(vaultRef.current, dateKey);
      applyVault(next);
      rememberTab(note.id);
      setStatus(`Opened the daily note for ${dateKey}`);
      focusContent();
    },
    [applyVault, focusContent, rememberTab],
  );

  /** Opens the note of today, the day read from the local clock. */
  const handleOpenTodaysNote = useCallback(() => {
    handleOpenDailyNote(formatLocalDate(new Date()));
  }, [handleOpenDailyNote]);

  /** Opens the calendar of the daily notes. */
  const handleOpenCalendar = useCallback(() => {
    setCalendarOpen(true);
  }, []);

  /** Opens the fullscreen graph of the vault. */
  const handleOpenGraph = useCallback(() => {
    setGraphOpen(true);
  }, []);

  /** Closes the fullscreen graph. */
  const handleCloseGraph = useCallback(() => {
    setGraphOpen(false);
  }, []);

  /**
   * Opens a note of the graph.
   *
   * The graph closes first and the keyboard goes to the content that is on
   * the screen, so the note is not opened behind a panel that is still there.
   */
  const handleOpenGraphNote = useCallback(
    (id: string) => {
      handleSelect(id);
      graphOpenedNote.current = true;
      setGraphOpen(false);
    },
    [handleSelect],
  );

  /**
   * The keyboard after the graph closed.
   *
   * The graph gives the keyboard back to the element that opened it. When
   * that element is gone (the command palette closed with it), the trigger
   * of the toolbar takes the keyboard, or the content when a note was opened
   * from the graph.
   */
  useEffect(() => {
    if (graphOpen) {
      graphWasOpen.current = true;
      return;
    }
    if (!graphWasOpen.current) return;
    graphWasOpen.current = false;
    if (graphOpenedNote.current) {
      graphOpenedNote.current = false;
      focusContent();
      return;
    }
    if (document.activeElement === document.body) graphTriggerRef.current?.focus();
  }, [focusContent, graphOpen]);

  const openPalette = useCallback(() => {
    setPaletteOpen(true);
  }, []);

  /** Opens the list of the shortcuts. */
  const openShortcutHelp = useCallback(() => {
    setHelpOpen(true);
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
      // The recovery belongs to the vault the user is in: the identity while
      // the session works on a vault, the vault of the catalog when the
      // session never managed to open one, and the legacy vault only when
      // there is nothing else.
      const target = identityRef.current.id ?? activeVaultIdRef.current ?? LEGACY_VAULT_ID;
      if (storageMode === 'memory-only') {
        // The recovery save may destroy the stored vault, so the store is
        // read again first and the write only happens when it is the only
        // way out.
        try {
          const stored = await loadVault(target);
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
      const saved = await save(vaultRef.current, target, identity, session);
      if (saved && identity.id === null) {
        // The notes are stored again, so the vault needs an identity before
        // the next keystroke can be written. The catalog stays as it is: a
        // broken catalog must not take the storage away again.
        identityRef.current = { id: target, generation: identityRef.current.generation + 1 };
        setVaultId(target);
        // The catalog is read again, so the name of the vault and the manager
        // are back instead of waiting for a reload.
        try {
          const fresh = await loadCatalog();
          if (fresh) setCatalog(fresh);
        } catch {
          // The catalog is still unreadable, so the manager stays out of
          // reach. The notes of this tab are stored all the same.
        }
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
   * The toolbar, the sidebar, the shortcuts and the palette all go through
   * here, so a command that cannot run does nothing everywhere. A command
   * that cannot run says why in the one polite region, so a control that is
   * pressed never pretends to have done something.
   */
  const runCommand = useCallback((id: string) => {
    const command = commandsRef.current.find((entry) => entry.id === id);
    if (!command) return;
    if (command.disabledReason) {
      setStatus(`${command.label} is not available: ${command.disabledReason}`);
      return;
    }
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
          canGoBack:
            history.past.length > 1 &&
            // A trail entry that only holds notes of the vault that left, or
            // notes in the trash, is nothing to go back to.
            history.past
              .slice(0, -1)
              .some((entry) => entry.noteId !== null && liveNoteIds.has(entry.noteId)),
          canGoForward: history.future.length > 0,
        },
        {
          createNote: handleCreate,
          createFolder: requestFolderForm,
          renameNote: handleRenameActive,
          trashNote: handleTrashActive,
          undo: handleUndo,
          importMarkdown: handleImport,
          exportVault: handleExport,
          setViewMode: setView,
          openSwitcher: openSwitcher,
          openPalette,
          openShortcutHelp,
          focusSearch: requestSearch,
          openVaultManager: openVaultManager,
          toggleContextPanel: toggleContextPanel,
          closeTab: closeActiveTab,
          nextTab: () => handleStepTab(1),
          previousTab: () => handleStepTab(-1),
          openDailyNote: handleOpenTodaysNote,
          openCalendar: handleOpenCalendar,
          openGraph: handleOpenGraph,
          openSettings,
          openRecovery,
          deletePermanent: openDeletePermanent,
          goBack: handleHistoryBack,
          goForward: handleHistoryForward,
          toggleBookmark: handleToggleBookmark,
          toggleOutline: () => setOutlineOpen((open) => !open),
          toggleBookmarksPanel: () => setBookmarksOpen((open) => !open),
        },
      ),
    [
      compact,
      closeActiveTab,
      handleCreate,
      handleExport,
      handleHistoryBack,
      handleHistoryForward,
      handleImport,
      handleOpenCalendar,
      handleOpenGraph,
      handleOpenTodaysNote,
      handleRenameActive,
      handleStepTab,
      handleToggleBookmark,
      handleTrashActive,
      handleUndo,
      history.future.length,
      history.past.length,
      openDeletePermanent,
      openPalette,
      openRecovery,
      openSettings,
      openShortcutHelp,
      openSwitcher,
      openVaultManager,
      requestFolderForm,
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
  const modalOpen =
    paletteOpen ||
    switcherOpen ||
    managerOpen ||
    calendarOpen ||
    graphOpen ||
    helpOpen ||
    settingsOpen ||
    recoveryOpen ||
    trashTarget !== null ||
    deleteTarget !== null;

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

  /**
   * The shortcuts of the app that stand on their own.
   *
   * A shortcut never reaches the app while a composition is still being
   * written, or while a layer of its own is open: in those moments the key
   * belongs to the text or to the layer. The shortcuts of the browser, such
   * as Ctrl+W or Ctrl+Tab, are never touched.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      if (isComposing(event)) return;
      if (modalOpen) return;

      // The rename of the note of the screen. The key never writes a
      // character, so it works everywhere.
      if (event.key === 'F2') {
        event.preventDefault();
        runCommand('note.rename');
        return;
      }

      // The list of the shortcuts. The question mark writes a character, so
      // it only works when the reader is not writing.
      if (event.key === '?') {
        if (isEditable(event.target)) return;
        event.preventDefault();
        runCommand('help.shortcuts');
        return;
      }

      // The brackets are the keys of the shell history, and no browser takes
      // them with Alt. The key never writes a character, so it works in the
      // editor as well. A modifier that turned the bracket into a character
      // (the Option key of the Mac does) is a reader's key, not ours.
      if (event.altKey && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
        const bracket = event.code === 'BracketLeft' ? '[' : ']';
        if (isEditable(event.target) && event.key !== bracket) return;
        event.preventDefault();
        runCommand(event.code === 'BracketLeft' ? 'history.back' : 'history.forward');
        return;
      }

      if (!event.altKey) return;
      const letter = letterOf(event);
      if (!letter) return;
      // A modifier can turn a key into another character, as the Option key
      // of the Mac does. The shortcut only runs when the key is still the
      // letter, so it never takes a character away from the reader.
      if (isEditable(event.target) && event.key.toLowerCase() !== letter) return;

      if (letter === 't') {
        event.preventDefault();
        runCommand('note.daily');
        return;
      }
      if (letter === 'c') {
        event.preventDefault();
        runCommand('view.calendar');
        return;
      }
      if (letter === 'g') {
        event.preventDefault();
        runCommand('view.graph');
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
        error={managerOpen ? null : error}
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
        renameRequest={renameRequest}
        focusContent={focusContent}
        tabIds={tabIds}
        tabFocus={tabFocus}
        view={view}
        onViewChange={setView}
        spellcheck={settings.spellcheck}
        contextToggleRequest={contextToggleRequest}
        onCompactChange={setCompact}
        outlineOpen={outlineOpen}
        bookmarksOpen={bookmarksOpen}
        bookmarks={bookmarks}
        bookmarkError={bookmarkError}
        bookmarksLoading={bookmarksLoading}
        onRetryBookmarks={() => setBookmarkReadRequest((request) => request + 1)}
        activeBookmarked={activeBookmarked}
        onToggleBookmark={handleToggleBookmark}
        onOpenBookmark={handleOpenBookmark}
        onRemoveBookmark={handleRemoveBookmark}
        onJumpHeading={jumpToHeading}
        commands={commands}
        folderRequest={folderRequest}
        onRunCommand={runCommand}
        onCreateFolder={handleCreateFolder}
        graphTriggerRef={graphTriggerRef}
        onRetry={() => {
          void handleRetry();
        }}
        onDismissImport={() => setImportError(null)}
        onSelect={handleSelect}
        onNavigate={handleNavigate}
        onRename={handleRename}
        onDelete={handleDelete}
        onRestore={handleRestore}
        onChange={handleChange}
        onWikiLink={handleWikiLink}
        onAnnounce={announce}
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
      <Calendar
        open={calendarOpen}
        notes={activeNoteList}
        compact={compact}
        onClose={() => setCalendarOpen(false)}
        onOpenDate={(dateKey) => {
          handleOpenDailyNote(dateKey);
          setCalendarOpen(false);
        }}
        onFocusContent={focusContent}
      />
      <GraphView
        open={graphOpen}
        vault={vault}
        onOpenNote={handleOpenGraphNote}
        onClose={handleCloseGraph}
        onAnnounce={announce}
      />
      <QuickSwitcher
        open={switcherOpen}
        vault={vault}
        onClose={() => setSwitcherOpen(false)}
        onSelect={handleSelect}
        onAnnounce={announce}
      />
      <ShortcutHelp
        open={helpOpen}
        commands={commands}
        onClose={() => setHelpOpen(false)}
      />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onApply={handleApplySettings}
      />
      <RecoveryDialog
        open={recoveryOpen}
        note={recoveryNote}
        snapshots={snapshots}
        loading={recoveryLoading}
        error={recoveryError}
        onClose={() => setRecoveryOpen(false)}
        onRestore={(snapshot) => {
          void handleRestoreSnapshot(snapshot);
        }}
      />
      <ConfirmDialog
        open={trashTarget !== null}
        title="Move note to trash"
        message={`“${trashNote?.name ?? 'the note'}” stays in the trash until it is deleted for good.`}
        confirmLabel="Move to trash"
        onClose={() => setTrashTarget(null)}
        onConfirm={handleConfirmTrash}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        danger
        title="Delete note permanently"
        message={`“${permanentNote?.name ?? 'the note'}” and its recovery history are removed for good. There is no undo for this.`}
        confirmLabel="Delete permanently"
        requireText={permanentNote?.name ?? ''}
        fieldLabel="Type the name of the note to confirm"
        extra={{ label: 'Export backup', run: handleExport }}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          void handleDeletePermanent();
        }}
      />
      {catalog && vaultId ? (
        <VaultManager
          open={managerOpen}
          catalog={catalog}
          activeVaultId={vaultId}
          error={error}
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
 * The group a bookmark of a note is listed under.
 *
 * The group is the folder of the note, so the bookmarks of a project are
 * together, and a note without a folder is a bookmark of its own.
 */
function bookmarkGroup(name: string): string {
  const { folders } = splitNotePath(name);
  return folders.length > 0 ? folders[0]! : 'Notes';
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

/**
 * True for a save that failed because the storage refused more bytes.
 * Only that kind of failure gives the history away: the history exists for
 * this case, and no other failure may empty it.
 */
function isQuotaError(error: unknown): boolean {
  return error instanceof Error && error.name === 'QuotaExceededError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'the storage could not be read.';
}

/** True for a field the keyboard is typing into. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/** True while the keyboard is writing a composition, not a command. */
function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/**
 * The letter of a key.
 *
 * A modifier can change the key itself, so the letter is taken from the place
 * of the key on the keyboard when there is one, and from the key otherwise.
 */
function letterOf(event: KeyboardEvent): string {
  if (event.code.startsWith('Key')) return event.code.slice(3).toLowerCase();
  return event.key.length === 1 ? event.key.toLowerCase() : '';
}
