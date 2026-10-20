import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';

import { activeNotes } from '../domain/vault';
import type { LocalGraph } from '../domain/vault';
import type { ViewMode } from '../domain/commands';
import type { Note, Vault } from '../domain/types';
import ContextRail from './ContextRail';
import Editor from './Editor';
import Explorer from './Explorer';
import type { FocusTarget } from './Explorer';
import NoteTabs from './NoteTabs';
import Preview from './Preview';
import Search from './Search';

/** The ids of the two panels that the rail toggles on a narrow screen. */
const NOTES_PANEL_ID = 'workspace-notes-panel';
const CONTEXT_PANEL_ID = 'workspace-context-panel';
const COMPACT_QUERY = '(max-width: 48rem)';

/**
 * True when the element is hidden, by itself or by one of its ancestors.
 *
 * The inactive view stays mounted, so only the hidden attribute says that it
 * is not on the screen.
 */
export function isHidden(element: Element): boolean {
  return element.closest('[hidden]') !== null;
}

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: 'write', label: 'Write' },
  { value: 'split', label: 'Split' },
  { value: 'read', label: 'Read' },
];

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
  /** The name of the open vault, or null when there is none. */
  vaultName?: string | null;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  editorRef?: RefObject<HTMLTextAreaElement | null>;
  /** The visible preview, so the keyboard can go to the view that is shown. */
  previewRef?: RefObject<HTMLElement | null>;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  /** Counts the requests to focus the search field, which opens the notes. */
  searchRequest?: number;
  /** Counts the requests to put the keyboard on the visible content. */
  focusContentRequest?: number;
  /** Puts the keyboard on the content the reader can see. */
  focusContent?: () => void;
  /** The ids of the open notes, in the order of the tab strip. */
  tabIds: string[];
  /** Asks the tab strip to put the keyboard on one of its tabs. */
  tabFocus?: { id: string | null; request: number } | null;
  /** The way the note is shown next to the explorer. */
  view: ViewMode;
  onViewChange(mode: ViewMode): void;
  /** Counts the requests to fold the context panel away. */
  contextToggleRequest?: number;
  /** Tells the app that the screen is narrow or wide. */
  onCompactChange?: (compact: boolean) => void;
  onOpenVaults(): void;
  onOpenPalette(): void;
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
  /** Opens the note of a tab. */
  onSelectTab(id: string): void;
  /** Closes the tab of a note, without deleting the note. */
  onCloseTab(id: string): void;
}

/**
 * The workspace shell: a branded toolbar, the explorer, the note with its
 * view modes, and the context rail. It owns the single polite live region,
 * the storage warning and the import alert; the app owns the data.
 *
 * The document order is toolbar, explorer, note, context, so the desktop
 * visual order and the document order agree and the keyboard reads the
 * screen from left to right. On a narrow screen the explorer and the context
 * rail become explicit panels that the toolbar toggles, and the note is the
 * first content below the toolbar.
 */
export default function Workspace(props: WorkspaceProps) {
  const notes = activeNotes(props.vault);
  const trashed = props.vault.notes.filter((note) => note.deletedAt !== null);
  const active = notes.find((note) => note.id === props.vault.activeNoteId) ?? null;
  /** The open notes, in the order of the strip. */
  const tabNotes = props.tabIds
    .map((id) => props.vault.notes.find((note) => note.id === id))
    .filter((note): note is Note => note !== undefined);

  const [compact, setCompact] = useState(isCompact);
  const [notesOpen, setNotesOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  /** Counts the focus requests the workspace makes itself. */
  const [focusRevision, setFocusRevision] = useState(0);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const notesToggleRef = useRef<HTMLButtonElement>(null);
  const contextToggleRef = useRef<HTMLButtonElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const filesRef = useRef<HTMLDetailsElement>(null);
  const filesSummaryRef = useRef<HTMLElement>(null);
  const searchPending = useRef(false);
  const emptyNoteRef = useRef<HTMLButtonElement>(null);
  // The scroll offset of the two panes, one entry per note, so a change of
  // the view or of the note does not move the reader to another place. A ref
  // and not a state, so the typing never re-renders the workspace.
  const scrollRef = useRef<Record<string, { editor: number; preview: number }>>({});
  // The note that is on the screen. Its offsets are its own.
  const noteKey = props.vault.activeNoteId ?? '';
  const noteKeyRef = useRef(noteKey);
  noteKeyRef.current = noteKey;

  // The panels are always open on a wide screen and closed by default on a
  // narrow one, where the note is the primary content.
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
    const update = () => {
      const next = isCompact();
      setCompact(next);
      // The app needs to know, so a command can say that the context panel
      // cannot be folded away on a wide screen.
      props.onCompactChange?.(next);
    };
    update();
    window.addEventListener('resize', update);
    const media =
      typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : null;
    media?.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      media?.removeEventListener('change', update);
    };
  }, [props.onCompactChange]);

  // A command asks for the context panel to be folded away, or to come back.
  useEffect(() => {
    if (!props.contextToggleRequest) return;
    setContextOpen((open) => !open);
  }, [props.contextToggleRequest]);

  // The keyboard follows the note that took the place of a closed tab. When
  // the last tab closed, the empty panel takes the keyboard instead.
  useEffect(() => {
    if (!props.tabFocus) return;
    if (props.tabFocus.id) return;
    emptyNoteRef.current?.focus();
  }, [props.tabFocus]);

  // Escape closes the panel that holds the keyboard and gives it back to that
  // panel's toggle.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      // A native disclosure owns the keyboard while it is open. Escape
      // closes it and gives the keyboard back to its summary.
      const disclosure = target.closest('details[open]');
      if (disclosure instanceof HTMLDetailsElement) {
        event.preventDefault();
        disclosure.open = false;
        disclosure.querySelector('summary')?.focus();
        return;
      }

      if (isEditable(target)) return;
      if (target.closest('dialog[open]')) return;

      const panel = target.closest('aside');
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
  // keyboard, the visible content takes it, so it never stays on the body.
  useEffect(() => {
    if (!props.focusNote) return;
    if (document.activeElement !== document.body) return;
    props.focusContent?.();
  }, [props.focusNote, props.focusContent]);

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

  // A request to focus the content puts the keyboard on the pane that is on
  // the screen, so the reader can write at once. Creating a note from the
  // empty panel is such a request: the button that created it is gone.
  useEffect(() => {
    if (!props.focusContentRequest && !focusRevision) return;
    props.focusContent?.();
  }, [props.focusContentRequest, focusRevision, props.focusContent]);

  /** Closes the files disclosure and gives the keyboard back to its summary. */
  const closeFiles = () => {
    const details = filesRef.current;
    if (!details) return;
    details.open = false;
    filesSummaryRef.current?.focus();
  };

  /**
   * Remembers where the reader is in the note that is on the screen.
   *
   * The offset belongs to the note, so a note that is opened later starts at
   * its own place and never at the place of the note before it.
   */
  const captureScroll = useCallback(() => {
    const key = noteKeyRef.current;
    const entry = scrollRef.current[key] ?? { editor: 0, preview: 0 };
    const editor = props.editorRef?.current;
    if (editor && !isHidden(editor)) entry.editor = editor.scrollTop;
    const preview = props.previewRef?.current;
    if (preview && !isHidden(preview)) entry.preview = preview.scrollTop;
    scrollRef.current[key] = entry;
  }, [props.editorRef, props.previewRef]);

  /** Puts the reader back where they were in the note that is on the screen. */
  const restoreScroll = () => {
    const entry = scrollRef.current[noteKey] ?? { editor: 0, preview: 0 };
    const editor = props.editorRef?.current;
    if (editor && !isHidden(editor)) editor.scrollTop = entry.editor;
    const preview = props.previewRef?.current;
    if (preview && !isHidden(preview)) preview.scrollTop = entry.preview;
  };

  const changeView = (next: ViewMode) => {
    captureScroll();
    props.onViewChange(next);
  };

  // The panes report their own place, so the offset of a note belongs to it
  // and follows the reader from one note to the next.
  useEffect(() => {
    const editor = props.editorRef?.current;
    const preview = props.previewRef?.current;
    if (!editor && !preview) return;
    const onScroll = () => captureScroll();
    editor?.addEventListener('scroll', onScroll);
    preview?.addEventListener('scroll', onScroll);
    return () => {
      editor?.removeEventListener('scroll', onScroll);
      preview?.removeEventListener('scroll', onScroll);
    };
  }, [captureScroll, props.editorRef, props.previewRef]);

  // The panes are on the screen again, so the offset of the reader goes back
  // where it was. A note that has no offset of its own starts at the top.
  useLayoutEffect(() => {
    restoreScroll();
  }, [props.view, noteKey]);

  return (
    <div className="workspace">
      <header className="workspace__toolbar">
        <div className="workspace__toolbar-row">
          <div className="workspace__brand">
            <span className="workspace__mark" aria-hidden="true">
              LN
            </span>
            <h1 className="workspace__name">Lattice Notes</h1>
          </div>

          <div className="workspace__actions">
            {props.vaultName ? (
              <button
                type="button"
                className="workspace__vault"
                aria-haspopup="dialog"
                aria-label={`Vaults: ${props.vaultName}`}
                onClick={props.onOpenVaults}
              >
                {props.vaultName}
              </button>
            ) : null}
            <button type="button" className="workspace__new" onClick={props.onCreate}>
              New note
            </button>
            <button
              type="button"
              className="workspace__command"
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={props.onOpenPalette}
            >
              Commands
            </button>
            <details className="workspace__files" ref={filesRef}>
              <summary className="workspace__files-summary" ref={filesSummaryRef}>
                Files
              </summary>
              <div className="workspace__files-menu">
                <button
                  type="button"
                  className="workspace__file-action"
                  ref={importButtonRef}
                  onClick={() => {
                    // The keyboard is on the summary before the picker opens,
                    // so it is still there when the picker closes.
                    closeFiles();
                    props.onImport();
                  }}
                >
                  Import Markdown
                </button>
                <button
                  type="button"
                  className="workspace__file-action"
                  onClick={() => {
                    props.onExport();
                    closeFiles();
                  }}
                >
                  Export vault
                </button>
              </div>
            </details>
          </div>
        </div>

        <div className="workspace__panels">
          <button
            type="button"
            className="workspace__panel-toggle"
            ref={notesToggleRef}
            aria-expanded={notesExpanded}
            aria-controls={NOTES_PANEL_ID}
            onClick={() => setNotesOpen((open) => !open)}
          >
            Notes
          </button>
          <button
            type="button"
            className="workspace__panel-toggle"
            ref={contextToggleRef}
            aria-expanded={contextExpanded}
            aria-controls={CONTEXT_PANEL_ID}
            onClick={() => setContextOpen((open) => !open)}
          >
            Context
          </button>
        </div>

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
      </header>

      <aside
        className="workspace__explorer"
        aria-label="Notes"
        id={NOTES_PANEL_ID}
        hidden={!notesExpanded}
      >
        {props.vaultName ? (
          <p className="workspace__vault-label">{props.vaultName}</p>
        ) : null}
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
            />
          }
        />
      </aside>

      <main className="workspace__main" aria-label="Note workspace">
        <header className="workspace__doc-header">
          <h2 className="workspace__doc-title">{active ? active.name : 'No note selected'}</h2>
          <fieldset className="workspace__modes">
            <legend className="workspace__modes-legend">View</legend>
            {VIEW_MODES.map((mode) => (
              <label className="workspace__mode" key={mode.value}>
                <input
                  type="radio"
                  name="workspace-view"
                  value={mode.value}
                  checked={props.view === mode.value}
                  onChange={() => changeView(mode.value)}
                />
                <span>{mode.label}</span>
              </label>
            ))}
          </fieldset>
        </header>

        <NoteTabs
          notes={tabNotes}
          activeNoteId={props.vault.activeNoteId}
          onSelect={props.onSelectTab}
          onClose={props.onCloseTab}
          focusRequest={props.tabFocus}
        />

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
                // goes to the import control. Its disclosure opens first, or
                // the button would not be on the screen.
                if (filesRef.current) filesRef.current.open = true;
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

        {active ? null : (
          <div className="workspace__empty-note">
            <p className="workspace__empty-note-text">
              No note is open. The notes of this vault are still in the list.
            </p>
            <button
              type="button"
              className="workspace__empty-note-action"
              ref={emptyNoteRef}
              onClick={() => {
                props.onCreate();
                // The button goes away with the empty panel, so the keyboard
                // has to move to the note that replaces it.
                setFocusRevision((revision) => revision + 1);
              }}
            >
              New note
            </button>
            <p className="workspace__empty-note-hint">
              Press Ctrl/Cmd+P to open the quick switcher and pick a note.
            </p>
          </div>
        )}

        <div className="workspace__panes" data-view={props.view} hidden={!active}>
          <Editor
            note={active}
            textareaRef={props.editorRef}
            hidden={props.view === 'read'}
            onChange={props.onChange}
          />
          <Preview
            body={active?.body ?? ''}
            contentRef={props.previewRef}
            hidden={props.view === 'write'}
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
export function isCompact(): boolean {
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
