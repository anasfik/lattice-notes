import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode, RefObject } from 'react';

import { activeNotes } from '../domain/vault';
import type { LocalGraph } from '../domain/vault';
import type { Vault } from '../domain/types';
import ContextRail from './ContextRail';
import Editor from './Editor';
import Explorer from './Explorer';
import type { FocusTarget } from './Explorer';
import Preview from './Preview';
import Search from './Search';

/** The ids of the two panels that the rail toggles on a narrow screen. */
const NOTES_PANEL_ID = 'workspace-notes-panel';
const CONTEXT_PANEL_ID = 'workspace-context-panel';
const COMPACT_QUERY = '(max-width: 48rem)';

export interface WorkspaceProps {
  vault: Vault;
  status: string;
  error: string | null;
  /** A failed import, with its own alert and its own dismiss action. */
  importError: string | null;
  canUndo: boolean;
  focusNote: FocusTarget | null;
  graph: LocalGraph | null;
  noteNames: ReadonlySet<string>;
  /** True while the graph still trails the vault. */
  graphPending?: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  editorRef?: RefObject<HTMLTextAreaElement | null>;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  /** Counts the requests to focus the search field, which opens the notes. */
  searchRequest?: number;
  paletteTrigger?: ReactNode;
  onRetry(): void;
  onDismissImport(): void;
  onSelect(id: string): void;
  /** Opens a note from a control the navigation replaces. */
  onNavigate(id: string): void;
  onCreate(): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onRestore(id: string): void;
  onChange(body: string): void;
  onUndo(): void;
  onWikiLink(target: string): void;
  onAnnounce(message: string): void;
  onImport(): void;
  onExport(): void;
  onImportFiles(event: ChangeEvent<HTMLInputElement>): void;
}

/**
 * The three pane shell: activity rail, explorer, editor with preview, and the
 * context rail. It owns the single polite live region, the storage warning
 * and the import alert; the app owns the data.
 *
 * The document order is rail, explorer, editor, context, so the desktop
 * visual order and the document order agree and the keyboard reads the
 * screen from left to right. On a narrow screen the explorer and the context
 * rail become explicit panels that the rail toggles, and the editor is the
 * first content below the rail.
 */
export default function Workspace(props: WorkspaceProps) {
  const notes = activeNotes(props.vault);
  const trashed = props.vault.notes.filter((note) => note.deletedAt !== null);
  const active = notes.find((note) => note.id === props.vault.activeNoteId) ?? null;

  const [compact, setCompact] = useState(isCompact);
  const [notesOpen, setNotesOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const notesToggleRef = useRef<HTMLButtonElement>(null);
  const contextToggleRef = useRef<HTMLButtonElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const searchPending = useRef(false);

  // The panels are always open on a wide screen and closed by default on a
  // narrow one, where the editor is the primary content.
  const notesExpanded = !compact || notesOpen;
  const contextExpanded = !compact || contextOpen;

  // The explorer asks for a focus target when a note is deleted, restored or
  // undone. The row that takes the focus lives inside the notes panel, so the
  // panel has to be open in the committed DOM before the explorer focuses it.
  // The explorer is a child and child effects run before the effects of this
  // component, so the panel is opened during the render instead.
  if (props.focusNote !== focusTarget) {
    setFocusTarget(props.focusNote);
    if (props.focusNote && compact) setNotesOpen(true);
  }

  // The panels follow the width of the window.
  useEffect(() => {
    const update = () => setCompact(isCompact());
    window.addEventListener('resize', update);
    const media =
      typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : null;
    media?.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      media?.removeEventListener('change', update);
    };
  }, []);

  // Escape closes the panel that holds the keyboard and gives it back to that
  // panel's toggle.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target;
      if (isEditable(target)) return;
      if (target instanceof Element && target.closest('dialog[open]')) return;

      const panel = target instanceof Element ? target.closest('aside') : null;
      if (panel?.id === CONTEXT_PANEL_ID && contextOpen) {
        setContextOpen(false);
        contextToggleRef.current?.focus();
        return;
      }
      if (notesOpen) {
        setNotesOpen(false);
        notesToggleRef.current?.focus();
        return;
      }
      if (contextOpen) {
        setContextOpen(false);
        contextToggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [contextOpen, notesOpen]);

  // The explorer focuses the row in a child effect. If that did not place the
  // keyboard, the editor takes it, so it never stays on the body.
  useEffect(() => {
    if (!props.focusNote) return;
    if (document.activeElement !== document.body) return;
    const editor = props.editorRef?.current;
    if (editor && !editor.disabled) editor.focus();
  }, [props.focusNote, props.editorRef]);

  // A request to focus the search field opens the notes panel first, because
  // a field inside a closed panel cannot take the focus.
  useEffect(() => {
    if (!props.searchRequest) return;
    searchPending.current = true;
    setNotesOpen(true);
  }, [props.searchRequest]);

  useEffect(() => {
    if (!searchPending.current) return;
    if (!notesExpanded) return;
    searchPending.current = false;
    props.searchInputRef?.current?.focus();
  }, [notesExpanded, props.searchRequest, props.searchInputRef]);

  return (
    <div className="workspace">
      <nav className="workspace__rail" aria-label="Workspace">
        <h1 className="workspace__mark" aria-label="Lattice Notes">
          LN
        </h1>
        <button
          type="button"
          className="workspace__rail-action"
          aria-label="New note"
          onClick={props.onCreate}
        >
          New
        </button>
        <button
          type="button"
          className="workspace__rail-action"
          ref={importButtonRef}
          aria-label="Import Markdown"
          title="Import Markdown"
          onClick={props.onImport}
        >
          Import
        </button>
        <button
          type="button"
          className="workspace__rail-action"
          aria-label="Export vault"
          title="Export vault"
          onClick={props.onExport}
        >
          Export
        </button>
        <button
          type="button"
          className="workspace__rail-action workspace__panel-toggle"
          ref={notesToggleRef}
          aria-expanded={notesExpanded}
          aria-controls={NOTES_PANEL_ID}
          onClick={() => setNotesOpen((open) => !open)}
        >
          Notes
        </button>
        <button
          type="button"
          className="workspace__rail-action workspace__panel-toggle"
          ref={contextToggleRef}
          aria-expanded={contextExpanded}
          aria-controls={CONTEXT_PANEL_ID}
          onClick={() => setContextOpen((open) => !open)}
        >
          Context
        </button>
        <input
          ref={props.fileInputRef}
          type="file"
          multiple
          accept=".md,.markdown,.txt,.json"
          className="workspace__file-input"
          tabIndex={-1}
          aria-label="Markdown or vault export files"
          onChange={props.onImportFiles}
        />
      </nav>

      <aside
        className="workspace__explorer"
        aria-label="Notes"
        id={NOTES_PANEL_ID}
        hidden={!notesExpanded}
      >
        <Explorer
          notes={notes}
          trashed={trashed}
          activeNoteId={props.vault.activeNoteId}
          focusNote={props.focusNote}
          onSelect={props.onSelect}
          onCreate={props.onCreate}
          onRename={props.onRename}
          onDelete={props.onDelete}
          onRestore={props.onRestore}
          tools={
            <Search
              vault={props.vault}
              onSelect={props.onSelect}
              onAnnounce={props.onAnnounce}
              inputRef={props.searchInputRef}
              action={props.paletteTrigger}
            />
          }
        />
      </aside>

      <main className="workspace__main" aria-label="Note workspace">
        <div className="workspace__statusbar">
          <p className="workspace__status" role="status">
            {props.status}
          </p>
          {props.canUndo ? (
            <button type="button" className="workspace__undo" onClick={props.onUndo}>
              Undo delete
            </button>
          ) : null}
        </div>

        {props.importError ? (
          <div className="workspace__warning" role="alert">
            <p className="workspace__warning-text">{props.importError}</p>
            <button
              type="button"
              className="workspace__warning-action"
              onClick={() => {
                props.onDismissImport();
                // The alert takes the focused button with it, so the keyboard
                // goes to the import control that is always there.
                importButtonRef.current?.focus();
              }}
            >
              Dismiss
            </button>
          </div>
        ) : props.error ? (
          <div className="workspace__warning" role="alert">
            <p className="workspace__warning-text">{props.error}</p>
            <button type="button" className="workspace__warning-action" onClick={props.onRetry}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="workspace__panes">
          <Editor note={active} textareaRef={props.editorRef} onChange={props.onChange} />
          <Preview
            body={active?.body ?? ''}
            onWikiLink={props.onWikiLink}
            existingNames={props.noteNames}
          />
        </div>
      </main>

      <aside
        className="workspace__context"
        aria-label="Context"
        id={CONTEXT_PANEL_ID}
        hidden={!contextExpanded}
      >
        <ContextRail
          note={active}
          graph={props.graph}
          noteNames={props.noteNames}
          graphPending={props.graphPending}
          onSelect={props.onSelect}
          onNavigate={props.onNavigate}
          onWikiLink={props.onWikiLink}
        />
      </aside>
    </div>
  );
}

/**
 * True on a narrow screen. jsdom has no matchMedia, so the width of the
 * window decides there.
 */
function isCompact(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(COMPACT_QUERY).matches
    : window.innerWidth <= 768;
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
