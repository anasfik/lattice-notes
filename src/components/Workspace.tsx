import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, RefObject } from 'react';

import { activeNotes } from '../domain/vault';
import type { LocalGraph } from '../domain/vault';
import type { ViewMode } from '../domain/commands';
import type { CommandAction } from '../domain/commands';
import { validateFolderPath } from '../domain/folders';
import type { Bookmark } from '../domain/bookmarks';
import { parseNote } from '../domain/markdown';
import { buildOutline } from '../domain/outline';
import type { Note, Vault } from '../domain/types';
import BookmarksPanel from './BookmarksPanel';
import BrandMark from './BrandMark';
import ContextRail from './ContextRail';
import Editor from './Editor';
import Explorer from './Explorer';
import type { FocusTarget } from './Explorer';
import Icon from './Icon';
import type { IconName } from './Icon';
import NoteTabs from './NoteTabs';
import OutlinePanel from './OutlinePanel';
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

const VIEW_MODES: { value: ViewMode; label: string; icon: IconName }[] = [
  { value: 'write', label: 'Write', icon: 'write' },
  { value: 'split', label: 'Split', icon: 'split' },
  { value: 'read', label: 'Read', icon: 'read' },
];

/** The places the sidebar leads to. */
const NAVIGATION: { id: string; label: string; icon: IconName }[] = [
  { id: 'search.workspace', label: 'Search', icon: 'search' },
  { id: 'note.daily', label: 'Today', icon: 'today' },
  { id: 'view.calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'view.graph', label: 'Graph', icon: 'graph' },
];

/** The commands of the menu of the app, the layer that is global. */
const APP_MENU: { id: string; icon: IconName }[] = [
  { id: 'command.palette', icon: 'command-palette' },
  { id: 'view.outline', icon: 'disclosure' },
  { id: 'bookmarks.panel', icon: 'link' },
  { id: 'vault.manager', icon: 'vaults' },
  { id: 'settings.open', icon: 'settings' },
  { id: 'note.recover', icon: 'restore' },
  { id: 'files.import', icon: 'import' },
  { id: 'files.export', icon: 'export' },
  { id: 'help.shortcuts', icon: 'shortcuts' },
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
  /**
   * Asks the list of the notes to open its rename field on a note.
   *
   * The command that renames the note of the screen asks for this.
   */
  renameRequest?: { id: string; request: number } | null;
  /** Puts the keyboard on the content the reader can see. */
  focusContent?: () => void;
  /** The ids of the open notes, in the order of the tab strip. */
  tabIds: string[];
  /** Asks the tab strip to put the keyboard on one of its tabs. */
  tabFocus?: { id: string | null; request: number } | null;
  /** The way the note is shown next to the explorer. */
  view: ViewMode;
  onViewChange(mode: ViewMode): void;
  /** True when the editor marks the words the browser does not know. */
  spellcheck?: boolean;
  /** Counts the requests to fold the context panel away. */
  contextToggleRequest?: number;
  /** True while the outline of the note is on the screen. */
  outlineOpen?: boolean;
  /** True while the bookmarks are on the screen. */
  bookmarksOpen?: boolean;
  /** The bookmarks of the vault on the screen. */
  bookmarks?: Bookmark[];
  /** True while the bookmarks are being read. */
  bookmarksLoading?: boolean;
  onRetryBookmarks?: () => void;
  /** Why the bookmarks could not be read, or nothing when they could. */
  bookmarkError?: string | null;
  /** True when the note on the screen is a bookmark already. */
  activeBookmarked?: boolean;
  /** Adds the note on the screen to the bookmarks, or takes it off. */
  onToggleBookmark?: () => void;
  /** Opens the note a bookmark points at. */
  onOpenBookmark?: (bookmark: Bookmark) => void;
  /** Takes a bookmark off. */
  onRemoveBookmark?: (bookmark: Bookmark) => void;
  /** Jumps to a heading of the note on the screen. */
  onJumpHeading?: (id: string) => void;
  /** Tells the app that the screen is narrow or wide. */
  onCompactChange?: (compact: boolean) => void;
  /**
   * Counts the requests to open the form of a new folder.
   *
   * The command that creates a folder asks the sidebar for the form, the way
   * the command that renames a note asks the list of the notes.
   */
  folderRequest?: number;
  /**
   * The catalog of the app.
   *
   * The menus read their labels and their shortcuts from it, so a name never
   * drifts between the sidebar, the menu of the app and the palette.
   */
  commands: CommandAction[];
  /**
   * Runs a command of the catalog of the app.
   *
   * Every menu of the product goes through here, so a label, a shortcut and
   * a handler can never drift between the sidebar, the menu of the app and
   * the palette.
   */
  onRunCommand(id: string): void;
  /** Creates the first note of a new folder. */
  onCreateFolder(path: string): void;
  /** The trigger of the graph, so the keyboard can go back to it. */
  graphTriggerRef?: RefObject<HTMLButtonElement | null>;
  onRetry(): void;
  onDismissImport(): void;
  onSelect(id: string): void;
  /** Opens a note from a control the navigation replaces. */
  onNavigate(id: string): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onRestore(id: string): void;
  onChange(body: string): void;
  onWikiLink(target: string): void;
  onAnnounce(message: string): void;
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

  /** The headings of the note on the screen, in the order of the document. */
  const outline = useMemo(
    () => (active ? buildOutline(parseNote(active.body).headings) : []),
    [active],
  );

  const [compact, setCompact] = useState(isCompact);
  const [panel, setPanel] = useState<'notes' | 'context' | null>(null);
  const notesOpen = panel === 'notes';
  const contextOpen = panel === 'context';
  /** The name of the group of the views, carried by the label beside it. */
  const viewLabelId = useId();
  /** Counts the focus requests the workspace makes itself. */
  const [focusRevision, setFocusRevision] = useState(0);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  /** True while the form of a new folder is open. */
  const [folderOpen, setFolderOpen] = useState(false);
  /** The path the reader is writing in the form of a new folder. */
  const [folderDraft, setFolderDraft] = useState('');
  /** Why the path of the new folder was refused. */
  const [folderError, setFolderError] = useState<string | null>(null);
  /** Counts the requests to put the keyboard on the list of the notes. */
  const [listFocusRequest, setListFocusRequest] = useState(0);
  const notesToggleRef = useRef<HTMLButtonElement>(null);
  const contextToggleRef = useRef<HTMLButtonElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const menuSummaryRef = useRef<HTMLElement>(null);
  const folderFieldRef = useRef<HTMLInputElement>(null);
  const folderButtonRef = useRef<HTMLButtonElement>(null);
  const searchPending = useRef(false);
  const documentRequested = useRef(false);
  const emptyNoteRef = useRef<HTMLButtonElement>(null);
  // The scroll offset of the two panes, one entry per note, so a change of
  // the view or of the note does not move the reader to another place. A ref
  // and not a state, so the typing never re-renders the workspace.
  const scrollRef = useRef<Record<string, { editor: number; preview: number }>>({});
  // The note that is on the screen. Its offsets are its own.
  const noteKey = props.vault.activeNoteId ?? '';
  const [shownNote, setShownNote] = useState(noteKey);
  const noteKeyRef = useRef(noteKey);
  noteKeyRef.current = noteKey;

  // The panels are always open on a wide screen and closed by default on a
  // narrow one, where the note is the primary content.
  const notesExpanded = !compact || notesOpen;
  const contextExpanded = !compact || contextOpen;
  const documentExpanded = !compact || panel === null;

  // Keep the editor mounted while a supporting panel occupies the compact
  // viewport. A selection from the switcher or a new note reveals it again.
  if (shownNote !== noteKey) {
    setShownNote(noteKey);
    if (compact) setPanel(null);
  }

  // The path the form of a new folder shows, so the reader sees the name of
  // the note the folder will hold.
  const folderPreview = folderDraft.trim() || 'Projects';

  /** The label of a command of the catalog, so a menu never drifts. */
  const labelOf = (id: string, fallback: string): string =>
    props.commands.find((command) => command.id === id)?.label ?? fallback;

  /** The shortcut of a command of the catalog, so a menu never drifts. */
  const shortcutOf = (id: string): string | undefined =>
    props.commands.find((command) => command.id === id)?.shortcut;

  // The explorer asks for a focus target when a note is deleted, restored or
  // undone. The row that takes the focus lives inside the notes panel, so the
  // panel has to be open in the committed DOM before the explorer focuses it.
  // The explorer is a child and child effects run before the effects of this
  // component, so the panel is opened during the render instead.
  if (props.focusNote !== focusTarget) {
    setFocusTarget(props.focusNote);
    if (props.focusNote && compact) setPanel('notes');
  }
  // A document action wins over the explorer's fallback focus request when
  // creating the first note. Resolve both before children try to focus.
  if (documentRequested.current) {
    documentRequested.current = false;
    setPanel(null);
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
    setPanel((open) => open === 'context' ? null : 'context');
  }, [props.contextToggleRequest]);

  // The outline and the bookmarks live in the rail of the context, so the rail
  // opens on a narrow screen when one of them is asked for.
  useEffect(() => {
    if (!props.outlineOpen && !props.bookmarksOpen) return;
    if (compact) setPanel('context');
  }, [compact, props.bookmarksOpen, props.outlineOpen]);

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
        setPanel(null);
        contextToggleRef.current?.focus();
        return;
      }
      if (notesOpen) {
        setPanel(null);
        notesToggleRef.current?.focus();
        return;
      }
      if (contextOpen) {
        setPanel(null);
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
    setPanel('notes');
  }, [props.searchRequest]);

  // A rename is asked for in the list of the notes, so the panel of the notes
  // opens first on a narrow screen.
  const renameOpened = useRef(0);
  useEffect(() => {
    const request = props.renameRequest;
    if (!request?.id || request.request <= renameOpened.current) return;
    renameOpened.current = request.request;
    if (compact) setPanel('notes');
  }, [compact, props.renameRequest]);

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

  // The command that creates a folder asks the sidebar for the form.
  useEffect(() => {
    if (!props.folderRequest) return;
    setPanel('notes');
    setFolderOpen(true);
    setFolderDraft('');
    setFolderError(null);
  }, [props.folderRequest]);

  // The form of a new folder takes the keyboard when it opens.
  useEffect(() => {
    if (!folderOpen) return;
    folderFieldRef.current?.focus();
  }, [folderOpen]);

  /** Closes the menu of the app and gives the keyboard back to its summary. */
  const closeMenu = () => {
    const details = menuRef.current;
    if (!details) return;
    details.open = false;
    menuSummaryRef.current?.focus();
  };

  /** Runs a command of the menu of the app. */
  const runFromMenu = (id: string) => {
    // The keyboard is on the summary before the command runs, so it is still
    // there when the command opens a layer of its own.
    closeMenu();
    props.onRunCommand(id);
  };

  /**
   * Creates the folder of the path in the form.
   *
   * A folder is a path in the name of a note, so the form says what the
   * first note will be called. A path that is refused is explained in the
   * form and in the polite region of the app.
   */
  const submitFolder = (event: FormEvent) => {
    event.preventDefault();
    const result = validateFolderPath(folderDraft);
    if (!result.ok) {
      setFolderError(result.reason);
      props.onAnnounce(result.reason);
      return;
    }
    setFolderError(null);
    setFolderOpen(false);
    props.onCreateFolder(result.path);
    showDocument();
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

  const showDocument = () => {
    if (!compact) return;
    documentRequested.current = true;
    setPanel(null);
    setFocusRevision((revision) => revision + 1);
  };

  const selectNote = (id: string) => {
    props.onSelect(id);
    showDocument();
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
  }, [props.view, noteKey, documentExpanded]);

  return (
    <main className="workspace" aria-label="Lattice Notes workspace">
      <header className="workspace__toolbar">
        <div className="workspace__toolbar-row">
          <div className="workspace__brand">
            <BrandMark className="workspace__mark" />
            <h1 className="workspace__name">Lattice Notes</h1>
            {props.vaultName ? (
              <button
                type="button"
                className="workspace__vault"
                aria-haspopup="dialog"
                aria-label={`Vaults: ${props.vaultName}`}
                onClick={() => props.onRunCommand('vault.manager')}
              >
                {props.vaultName}
              </button>
            ) : null}
          </div>

          <div className="workspace__panels">
            <button
              type="button"
              className="workspace__panel-toggle"
              ref={notesToggleRef}
              aria-expanded={notesExpanded}
              aria-controls={NOTES_PANEL_ID}
              onClick={() => setPanel((open) => open === 'notes' ? null : 'notes')}
            >
              <Icon name="notes-panel" />
              Index
            </button>
            <button
              type="button"
              className="workspace__panel-toggle"
              ref={contextToggleRef}
              aria-expanded={contextExpanded}
              aria-controls={CONTEXT_PANEL_ID}
              onClick={() => setPanel((open) => open === 'context' ? null : 'context')}
            >
              <Icon name="context-panel" />
              Context
            </button>
          </div>

          <div className="workspace__actions">
            <details className="workspace__menu" ref={menuRef}>
              <summary
                className="workspace__tool workspace__menu-summary"
                ref={menuSummaryRef}
                aria-label="Menu of the app"
              >
                <Icon name="app-menu" />
                Menu
              </summary>
              <div className="workspace__menu-list">
                {APP_MENU.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="workspace__menu-action"
                    aria-label={labelOf(item.id, item.id)}
                    ref={item.id === 'files.import' ? importButtonRef : undefined}
                    onClick={() => runFromMenu(item.id)}
                  >
                    <Icon name={item.icon} />
                    <span className="workspace__menu-label">
                      {labelOf(item.id, item.id)}
                    </span>
                    {shortcutOf(item.id) ? (
                      <kbd className="workspace__menu-hint" aria-hidden="true">
                        {shortcutOf(item.id)}
                      </kbd>
                    ) : null}
                  </button>
                ))}
              </div>
            </details>
          </div>
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
        aria-label="Index"
        id={NOTES_PANEL_ID}
        hidden={!notesExpanded}
      >
        <nav className="sidebar__nav" aria-label="Go to">
          <h2 className="sidebar__heading">Go to</h2>
          <ul className="sidebar__nav-list" role="list">
            <li className="sidebar__nav-item">
              <button
                type="button"
                className="sidebar__action"
                onClick={() => setListFocusRequest((request) => request + 1)}
              >
                <Icon name="note" />
                <span className="sidebar__action-label">Notes</span>
              </button>
            </li>
            {NAVIGATION.map((item) => (
              <li className="sidebar__nav-item" key={item.id}>
                <button
                  type="button"
                  className="sidebar__action"
                  aria-label={labelOf(item.id, item.label)}
                  ref={item.id === 'view.graph' ? props.graphTriggerRef : undefined}
                  onClick={() => props.onRunCommand(item.id)}
                >
                  <Icon name={item.icon} />
                  <span className="sidebar__action-label">{item.label}</span>
                  {shortcutOf(item.id) ? (
                    <kbd className="sidebar__hint" aria-hidden="true">
                      {shortcutOf(item.id)}
                    </kbd>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="sidebar__create" aria-label="Create">
          <h2 className="sidebar__heading">Create</h2>
          <div className="sidebar__create-actions">
            <button
              type="button"
              className="sidebar__action sidebar__action--primary"
              aria-label={labelOf('note.new', 'New note')}
              onClick={() => props.onRunCommand('note.new')}
            >
              <Icon name="new-note" />
              <span className="sidebar__action-label">New note</span>
              {shortcutOf('note.new') ? (
                <kbd className="sidebar__hint" aria-hidden="true">
                  {shortcutOf('note.new')}
                </kbd>
              ) : null}
            </button>
            <button
              type="button"
              className="sidebar__action"
              aria-label={labelOf('folder.new', 'New folder')}
              ref={folderButtonRef}
              onClick={() => props.onRunCommand('folder.new')}
            >
              <Icon name="new-folder" />
              <span className="sidebar__action-label">New folder</span>
            </button>
          </div>

          {folderOpen ? (
            <form className="sidebar__folder" onSubmit={submitFolder}>
              <label className="sidebar__folder-label" htmlFor="workspace-folder-path">
                Path of the new folder
              </label>
              <input
                id="workspace-folder-path"
                ref={folderFieldRef}
                className="sidebar__folder-input"
                value={folderDraft}
                aria-describedby="workspace-folder-hint"
                onChange={(event) => {
                  setFolderDraft(event.target.value);
                  setFolderError(null);
                }}
              />
              <p className="sidebar__folder-hint" id="workspace-folder-hint">
                A folder is a path in the name of a note. Creating it makes a first note named “
                {folderPreview}/Untitled”.
              </p>
              {folderError ? (
                <p className="sidebar__folder-error" role="alert">
                  {folderError}
                </p>
              ) : null}
              <div className="sidebar__folder-actions">
                <button type="submit" className="sidebar__action sidebar__action--primary">
                  Create folder
                </button>
                <button
                  type="button"
                  className="sidebar__action"
                  onClick={() => {
                    setFolderOpen(false);
                    setFolderError(null);
                    folderButtonRef.current?.focus();
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </section>

        <Explorer
          notes={notes}
          trashed={trashed}
          activeNoteId={props.vault.activeNoteId}
          focusNote={props.focusNote}
          renameRequest={notesExpanded ? props.renameRequest : null}
          focusRequest={listFocusRequest}
          onSelect={selectNote}
          onCreate={() => props.onRunCommand('note.new')}
          onRename={props.onRename}
          onDelete={props.onDelete}
          onRestore={props.onRestore}
          tools={
            <Search
              vault={props.vault}
              onSelect={selectNote}
              onAnnounce={props.onAnnounce}
              inputRef={props.searchInputRef}
            />
          }
        />
      </aside>

      <section className="workspace__main" aria-label="Note workspace" hidden={!documentExpanded}>
        <header className="workspace__doc-header">
          <div className="workspace__doc-heading">
            <h2 className="workspace__doc-title">{active ? active.name : 'No note selected'}</h2>
            <div className="workspace__doc-actions">
              <button
                type="button"
                className="workspace__doc-action"
                aria-label={labelOf('note.rename', 'Rename note')}
                onClick={() => props.onRunCommand('note.rename')}
              >
                <Icon name="rename" />
                <span className="workspace__doc-action-label">Rename</span>
              </button>
              <button
                type="button"
                className="workspace__doc-action"
                aria-label={labelOf('note.trash', 'Move note to trash')}
                onClick={() => props.onRunCommand('note.trash')}
              >
                <Icon name="trash" />
                <span className="workspace__doc-action-label">Trash</span>
              </button>
              {props.canUndo ? (
                <button
                  type="button"
                  className="workspace__undo"
                  onClick={() => props.onRunCommand('note.undo')}
                >
                  <Icon name="undo" />
                  <span>Undo delete</span>
                </button>
              ) : null}
            </div>
          </div>
          <div
            className="workspace__modes"
            role="radiogroup"
            aria-labelledby={viewLabelId}
          >
            <span className="workspace__modes-legend" id={viewLabelId}>
              View
            </span>
            <div className="workspace__modes-group">
              {VIEW_MODES.map((mode) => (
                <label className="workspace__mode" key={mode.value}>
                  <input
                    type="radio"
                    name="workspace-view"
                    value={mode.value}
                    checked={props.view === mode.value}
                    onChange={() => changeView(mode.value)}
                  />
                  <Icon name={mode.icon} />
                  <span>{mode.label}</span>
                </label>
              ))}
            </div>
          </div>
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
                // goes to the import control. Its menu opens first, or the
                // button would not be on the screen.
                if (menuRef.current) menuRef.current.open = true;
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
                props.onRunCommand('note.new');
                // The button goes away with the empty panel, so the keyboard
                // has to move to the note that replaces it.
                if (compact) showDocument();
                else setFocusRevision((revision) => revision + 1);
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
            spellcheck={props.spellcheck}
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
      </section>

      <aside
        className="workspace__context"
        aria-label="Context"
        id={CONTEXT_PANEL_ID}
        hidden={!contextExpanded}
      >
        {props.outlineOpen ? (
          <OutlinePanel items={outline} onJump={(id) => {
            setPanel(null);
            props.onJumpHeading?.(id);
          }} />
        ) : null}

        {props.bookmarksOpen ? (
          <BookmarksPanel
            bookmarks={props.bookmarks ?? []}
            activeBookmarked={props.activeBookmarked ?? false}
            hasActiveNote={active !== null}
            loading={props.bookmarksLoading ?? false}
            onRetry={props.onRetryBookmarks}
            error={props.bookmarkError ?? null}
            onToggleActive={() => props.onToggleBookmark?.()}
            onOpen={(bookmark) => {
              if (bookmark.kind === 'note') showDocument();
              else if (bookmark.kind === 'heading') setPanel(null);
              props.onOpenBookmark?.(bookmark);
            }}
            onRemove={(bookmark) => props.onRemoveBookmark?.(bookmark)}
          />
        ) : null}

        <ContextRail
          note={active}
          graph={props.graph}
          noteNames={props.noteNames}
          graphPending={props.graphPending}
          onNavigate={(id) => { props.onNavigate(id); showDocument(); }}
          onWikiLink={(name) => { props.onWikiLink(name); showDocument(); }}
          onOpenGraph={() => props.onRunCommand('view.graph')}
        />
      </aside>
    </main>
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
