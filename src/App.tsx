/**
 * Lattice Notes application shell.
 *
 * App owns the in-memory vault, persistence, undo, and status messages. The
 * components stay presentational so later waves can extend them without
 * rewriting the data flow.
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
import { createSeedVault, loadVault, saveVault } from './storage/vaultRepository';
import CommandPalette from './components/CommandPalette';
import Workspace, { isHidden } from './components/Workspace';
import type { FocusTarget } from './components/Explorer';

const SAVE_DEBOUNCE_MS = 200;

/** The Markdown extensions the import accepts, without the dot. */
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'txt'];

const SKIP_REASONS: Record<SkipReason, string> = {
  'unsupported-type': 'unsupported type',
  'too-large': 'too large',
  'batch-limit': 'over the batch limit',
  'unreadable-content': 'not readable',
};

type StorageMode = 'loading' | 'ready' | 'memory-only';

export default function App() {
  const [vault, setVault] = useState<Vault>(() => createEmptyVault());
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<StorageMode>('loading');
  const [retryKind, setRetryKind] = useState<'load' | 'save'>('load');
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const [focusNote, setFocusNote] = useState<FocusTarget | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [searchRequest, setSearchRequest] = useState(0);

  const vaultRef = useRef(vault);
  const baseRef = useRef<Vault | null>(null);
  const saveSeq = useRef(0);
  const bootedRef = useRef(false);
  const loadFailures = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const current = vaultRef.current;
    // An empty vault shows the create button instead of the list, so the
    // button is destroyed by the create and the keyboard needs a new home.
    // With notes in the vault the keyboard stays where it was, so
    // Ctrl/Cmd+N from the editor keeps the caret in the editor.
    const wasEmpty = activeNotes(current).length === 0;
    const { vault: next, note } = createNote(current);
    applyVault({ ...next, activeNoteId: note.id });
    setStatus(`Created ${note.name}`);
    if (wasEmpty) setFocusNote({ kind: 'note', id: note.id });
  }, [applyVault]);

  const handleSelect = useCallback((id: string) => {
    const current = vaultRef.current;
    const note = current.notes.find((candidate) => candidate.id === id);
    if (!note) return;
    if (current.activeNoteId !== id) applyVault({ ...current, activeNoteId: id });
    setStatus(`Opened ${note.name}`);
  }, [applyVault]);

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

  const handleDelete = useCallback((id: string) => {
    const current = vaultRef.current;
    const { vault: next, note } = deleteNote(current, id);
    if (!note || next === current) return;
    applyVault(next);
    // The deleted row disappears with the focus on it, so the keyboard is
    // handed to the note the vault selected, or to the empty state when the
    // last note is gone.
    setFocusNote(
      next.activeNoteId ? { kind: 'note', id: next.activeNoteId } : { kind: 'empty' },
    );
    setUndo({ id: note.id, name: note.name });
    setStatus(`Deleted ${note.name}`);
  }, [applyVault]);

  const handleRestore = useCallback((id: string): boolean => {
    const { vault: next, note } = restoreNote(vaultRef.current, id);
    if (!note) return false;
    applyVault({ ...next, activeNoteId: note.id });
    setFocusNote({ kind: 'note', id: note.id });
    // The undo slot holds the restored note, so the undo control would do
    // nothing. It goes when the note comes back.
    setUndo((current) => (current?.id === note.id ? null : current));
    setStatus(`Restored ${note.name}`);
    return true;
  }, [applyVault]);

  const handleUndo = useCallback(() => {
    if (!undo) return;
    handleRestore(undo.id);
  }, [handleRestore, undo]);

  /** Opens the hidden file picker behind the visible import control. */
  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Reads the selected files and merges them into the vault.
   *
   * The files are read first and merged afterwards, so a note that was
   * written while a file was being read is still there afterwards. The
   * limits are checked on the file size before the content is read, so an
   * oversized file is never pulled into memory.
   */
  const handleImportFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const files = Array.from(input.files ?? []);
      input.value = '';
      setImportError(null);
      if (files.length === 0) return;

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
        // The files are read one after the other, so a large selection does
        // not hold the text of every file in memory at once.
        const notes: { name: string; text: string }[] = [];
        for (const file of markdown) {
          notes.push({ name: stripExtension(file.name), text: await file.text() });
        }
        const envelopesText: string[] = [];
        for (const file of envelopes) {
          envelopesText.push(await file.text());
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
      setStatus(mode === 'ready' ? summary : `${summary} (not saved — use Export)`);
    },
    [applyVault, mode],
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
      setStatus(`Created ${note.name}`);
      focusContent();
    },
    [applyVault, focusContent, handleSelect],
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

  const handleRetry = useCallback(async () => {
    if (retryKind === 'save') {
      if (mode === 'memory-only') {
        // The recovery save may destroy the stored vault, so the store is
        // read again first and the write only happens when it is the only
        // way out.
        try {
          const stored = await loadVault();
          if (stored !== null) {
            if (baseRef.current === vaultRef.current) {
              // The tab changed nothing, so the stored vault is the truth.
              applyVault(stored);
              baseRef.current = stored;
              setMode('ready');
              setError(null);
              setStatus('Local vault restored');
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
        // The next retry re-reads the store and refuses to write over a
        // vault that is readable, so the message must not promise a save.
        setError(
          'Local storage is readable again. Export the notes of this tab, then reload the page to use the stored vault.',
        );
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
  }, [applyVault, mode, retryKind, save]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The palette is modal: a shortcut behind it would act on a note the
      // user cannot see.
      if (paletteOpen) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 'n') return;
      event.preventDefault();
      handleCreate();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCreate, paletteOpen]);

  // The palette and the search field are reachable from anywhere, including
  // from the editor.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (paletteOpen) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (key === 'p') {
        event.preventDefault();
        requestSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, requestSearch]);

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

  if (mode === 'loading') {
    return (
      <main className="workspace-loading" aria-label="Opening the local vault">
        <p className="workspace-loading__text">Opening local vault…</p>
      </main>
    );
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
        searchInputRef={searchInputRef}
        editorRef={editorRef}
        previewRef={previewRef}
        searchRequest={searchRequest}
        focusContent={focusContent}
        onOpenPalette={openPalette}
        onRetry={() => {
          void handleRetry();
        }}
        onDismissImport={() => setImportError(null)}
        onSelect={handleSelect}
        onNavigate={handleNavigate}
        onCreate={handleCreate}
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
        fileInputRef={fileInputRef}
      />
      <CommandPalette
        open={paletteOpen}
        vault={vault}
        onClose={() => setPaletteOpen(false)}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onFocusSearch={requestSearch}
        onAnnounce={announce}
      />
    </>
  );
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
  return error instanceof Error ? error.message : 'the file could not be read.';
}
