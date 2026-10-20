/**
 * Lattice Notes application shell.
 *
 * App owns the in-memory vault, persistence, undo, and status messages. The
 * components stay presentational so later waves can extend them without
 * rewriting the data flow.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  activeNotes,
  createEmptyVault,
  createNote,
  deleteNote,
  normalizeNoteName,
  renameNote,
  restoreNote,
  updateNoteBody,
} from './domain/vault';
import type { Vault } from './domain/types';
import { createSeedVault, loadVault, saveVault } from './storage/vaultRepository';
import Workspace from './components/Workspace';

const SAVE_DEBOUNCE_MS = 200;

type StorageMode = 'loading' | 'ready' | 'memory-only';

export default function App() {
  const [vault, setVault] = useState<Vault>(() => createEmptyVault());
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<StorageMode>('loading');
  const [retryKind, setRetryKind] = useState<'load' | 'save'>('load');
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const [focusNote, setFocusNote] = useState<{ id: string } | null>(null);

  const vaultRef = useRef(vault);
  const baseRef = useRef<Vault | null>(null);
  const saveSeq = useRef(0);
  const bootedRef = useRef(false);
  const loadFailures = useRef(0);

  /** Applies the next vault to the state and to the ref the handlers read. */
  const applyVault = useCallback((next: Vault) => {
    vaultRef.current = next;
    setVault(next);
  }, []);

  // Load once. A genuinely empty storage is seeded; a failing storage leaves
  // the session in memory only so no work is lost and nothing is overwritten.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    void (async () => {
      try {
        const stored = await loadVault();
        if (stored === null) {
          const seeded = createSeedVault();
          applyVault(seeded);
          setMode('ready');
          setStatus('Local vault created');
          return;
        }
        applyVault(stored);
        baseRef.current = stored;
        setMode('ready');
        setStatus('Local vault restored');
      } catch {
        baseRef.current = vaultRef.current;
        loadFailures.current += 1;
        setMode('memory-only');
        setRetryKind('load');
        setError('Local storage could not be read, so this session runs in memory only. Notes are not saved yet.');
      }
    })();
  }, []);

  const save = useCallback(async (next: Vault): Promise<boolean> => {
    const seq = ++saveSeq.current;
    try {
      await saveVault(next);
      if (seq !== saveSeq.current) return true;
      baseRef.current = next;
      setError(null);
      setMode('ready');
      setStatus('Saved to local storage');
      return true;
    } catch {
      if (seq !== saveSeq.current) return false;
      setError('Local storage rejected the save. Your notes are still here in this tab.');
      setRetryKind('save');
      return false;
    }
  }, []);

  // Edits are applied immediately in memory and written after a short pause.
  useEffect(() => {
    if (mode !== 'ready') return;
    if (baseRef.current === vault) return;
    const timer = setTimeout(() => {
      void save(vault);
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [mode, save, vault]);

  const handleCreate = useCallback(() => {
    const { vault: next, note } = createNote(vaultRef.current);
    applyVault({ ...next, activeNoteId: note.id });
    setStatus(`Created ${note.name}`);
  }, [applyVault]);

  const handleSelect = useCallback((id: string) => {
    const current = vaultRef.current;
    const note = current.notes.find((candidate) => candidate.id === id);
    if (!note) return;
    if (current.activeNoteId !== id) applyVault({ ...current, activeNoteId: id });
    setStatus(`Opened ${note.name}`);
  }, [applyVault]);

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

  const handleDelete = useCallback((id: string) => {
    const current = vaultRef.current;
    const { vault: next, note } = deleteNote(current, id);
    if (!note || next === current) return;
    applyVault(next);
    // The deleted row disappears with the focus on it, so the keyboard is
    // handed to the note the vault selected instead.
    if (next.activeNoteId) setFocusNote({ id: next.activeNoteId });
    setUndo({ id: note.id, name: note.name });
    setStatus(`Deleted ${note.name}`);
  }, [applyVault]);

  const handleRestore = useCallback((id: string): boolean => {
    const { vault: next, note } = restoreNote(vaultRef.current, id);
    if (!note) return false;
    applyVault({ ...next, activeNoteId: note.id });
    setFocusNote({ id: note.id });
    setStatus(`Restored ${note.name}`);
    return true;
  }, [applyVault]);

  const handleUndo = useCallback(() => {
    if (!undo) return;
    if (handleRestore(undo.id)) setUndo(null);
  }, [handleRestore, undo]);

  const handleWikiLink = useCallback(
    (target: string) => {
      const wanted = normalizeNoteName(target).toLowerCase();
      const match = activeNotes(vaultRef.current).find((note) => note.name.toLowerCase() === wanted);
      if (!match) {
        setStatus(`No note named ${target} yet`);
        return;
      }
      handleSelect(match.id);
    },
    [handleSelect],
  );

  const handleRetry = useCallback(async () => {
    if (retryKind === 'save') {
      await save(vaultRef.current);
      return;
    }

    try {
      const stored = await loadVault();
      if (stored === null) {
        setRetryKind('save');
        setError('Local storage is readable but empty. Retry saves the notes of this tab to local storage.');
        return;
      }
      if (baseRef.current !== vaultRef.current) {
        setRetryKind('save');
        setError('Local storage is readable again. Retry saves the notes of this tab, replacing the stored vault.');
        return;
      }
      applyVault(stored);
      baseRef.current = stored;
      setMode('ready');
      setError(null);
      setStatus('Local vault restored');
    } catch {
      loadFailures.current += 1;
      if (loadFailures.current >= 2) {
        // The stored document stays unreadable, so retrying the read can only
        // loop. Offer the way out: write this tab's notes over it.
        setRetryKind('save');
        setError('Local storage still cannot be read. Retry replaces the unreadable vault with the notes of this tab.');
        return;
      }
      setError('Local storage could not be read, so this session runs in memory only. Notes are not saved yet.');
    }
  }, [applyVault, retryKind, save]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 'n') return;
      event.preventDefault();
      handleCreate();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCreate]);

  if (mode === 'loading') {
    return (
      <main className="workspace-loading" aria-label="Opening the local vault">
        <p className="workspace-loading__text">Opening local vault…</p>
      </main>
    );
  }

  return (
    <Workspace
      vault={vault}
      status={status}
      error={error}
      canUndo={undo !== null}
      focusNote={focusNote}
      onRetry={() => {
        void handleRetry();
      }}
      onSelect={handleSelect}
      onCreate={handleCreate}
      onRename={handleRename}
      onDelete={handleDelete}
      onRestore={handleRestore}
      onChange={handleChange}
      onUndo={handleUndo}
      onWikiLink={handleWikiLink}
    />
  );
}
