import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { buildNoteIndex, splitNotePath } from '../domain/folders';
import type { FolderGroup } from '../domain/folders';
import type { Note } from '../domain/types';
import Icon from './Icon';

/** Where the keyboard goes after a control that the navigation replaces. */
export type FocusTarget = { kind: 'note'; id: string } | { kind: 'empty' };

export interface ExplorerProps {
  notes: Note[];
  trashed: Note[];
  activeNoteId: string | null;
  /** Set by the app after a restore so the keyboard keeps its place. */
  focusNote: FocusTarget | null;
  /**
   * Asks the list to open its rename field on a note.
   *
   * The command that renames the note of the screen asks for this, so the
   * name is changed in the list where the reader can see it.
   */
  renameRequest?: { id: string; request: number } | null;
  /** Counts the requests to put the keyboard on the list of the notes. */
  focusRequest?: number;
  /** Controls that belong above the note list, such as the search field. */
  tools?: ReactNode;
  onSelect(id: string): void;
  onCreate(): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onRestore(id: string): void;
}

/**
 * The note list with the note title, a per-note disclosure with the rename
 * and the delete, and the empty state.
 *
 * The notes are read by their names, so a name with a slash in it puts the
 * note in a folder of the index. The title keeps the whole name, so the row
 * never has to be cut short, and the actions live behind a native disclosure,
 * so they are there for the keyboard and for a finger and not only for a
 * hovering mouse.
 */
export default function Explorer({
  notes,
  trashed,
  activeNoteId,
  focusNote,
  renameRequest,
  focusRequest,
  tools,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onRestore,
}: ExplorerProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const noteButtons = useRef(new Map<string, HTMLButtonElement>());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusId = useRef<string | null>(null);
  /** The last request the list answered, so a request is answered once. */
  const renameHandled = useRef(0);
  /** The last request of the keyboard that was answered. */
  const focusHandled = useRef(0);

  /** The folders of the notes and the notes that have no folder. */
  const index = useMemo(() => buildNoteIndex(notes), [notes]);

  useEffect(() => {
    if (!focusNote) return;
    if (focusNote.kind === 'empty') {
      // The last note is gone, so the empty state takes the keyboard.
      createButtonRef.current?.focus();
      return;
    }
    noteButtons.current.get(focusNote.id)?.focus();
  }, [focusNote]);

  // Opening the rename field moves the keyboard into it; closing it gives the
  // keyboard back to the note it came from.
  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      return;
    }
    const id = returnFocusId.current;
    if (!id) return;
    returnFocusId.current = null;
    noteButtons.current.get(id)?.focus();
  }, [renamingId]);

  // The command that renames the note of the screen opens the field of that
  // note, so the name is changed where the reader can see it.
  useEffect(() => {
    const request = renameRequest;
    if (!request) return;
    if (request.request <= renameHandled.current) return;
    const note = notes.find((candidate) => candidate.id === request.id);
    // A note that is not in the list cannot be renamed here, so the request
    // is not marked as answered and it can be asked again.
    if (!note) return;
    renameHandled.current = request.request;
    setRenamingId(note.id);
    setDraft(note.name);
  }, [notes, renameRequest]);

  // The sidebar asks for the keyboard to go to the list of the notes.
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest <= focusHandled.current) return;
    focusHandled.current = focusRequest;
    const first = notes[0];
    if (first) {
      noteButtons.current.get(first.id)?.focus();
      return;
    }
    createButtonRef.current?.focus();
  }, [focusRequest, notes]);

  const startRename = (note: Note) => {
    setRenamingId(note.id);
    setDraft(note.name);
  };

  const closeRename = (id: string) => {
    returnFocusId.current = id;
    setRenamingId(null);
    setDraft('');
  };

  const commitRename = (id: string) => {
    onRename(id, draft);
    closeRename(id);
  };

  /** Closes the disclosure of the action that was taken. */
  const closeActions = (element: Element) => {
    const details = element.closest('details');
    if (details instanceof HTMLDetailsElement) details.open = false;
  };

  /** The row of a note, with the name and the actions of the note. */
  const row = (note: Note) => {
    const title = splitNotePath(note.name).title;
    const inFolder = title !== note.name;

    return (
      <li className="explorer__item" key={note.id}>
        {renamingId === note.id ? (
          <form
            className="explorer__rename"
            onSubmit={(event) => {
              event.preventDefault();
              commitRename(note.id);
            }}
          >
            <input
              className="explorer__rename-input"
              ref={renameInputRef}
              aria-label="Note name"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRename(note.id);
                }
                if (event.key === 'Escape') closeRename(note.id);
              }}
            />
            <button type="submit" className="explorer__action">
              Save name
            </button>
            <button type="button" className="explorer__action" onClick={() => closeRename(note.id)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              className="explorer__note"
              ref={(element) => {
                if (element) noteButtons.current.set(note.id, element);
                else noteButtons.current.delete(note.id);
              }}
              // The name of a note in a folder keeps its path, so two notes
              // of the same title in two folders are never the same name.
              aria-label={inFolder ? note.name : undefined}
              aria-current={note.id === activeNoteId ? 'true' : undefined}
              onClick={() => onSelect(note.id)}
            >
              {title}
            </button>
            <details className="explorer__actions">
              <summary
                className="explorer__actions-summary"
                aria-label={`Actions for ${note.name}`}
              >
                <Icon name="actions" size={14} />
                <span className="visually-hidden">Actions</span>
              </summary>
              <div className="explorer__menu">
                <button
                  type="button"
                  className="explorer__action"
                  aria-label={`Rename ${note.name}`}
                  onClick={(event) => {
                    closeActions(event.currentTarget);
                    startRename(note);
                  }}
                >
                  <Icon name="rename" size={14} />
                  Rename
                </button>
                <button
                  type="button"
                  className="explorer__action explorer__action--danger"
                  aria-label={`Delete ${note.name}`}
                  onClick={(event) => {
                    closeActions(event.currentTarget);
                    onDelete(note.id);
                  }}
                >
                  <Icon name="trash" size={14} />
                  Delete
                </button>
              </div>
            </details>
          </>
        )}
      </li>
    );
  };

  /** A folder of the index, with the notes that live in it. */
  const folder = (group: FolderGroup) => (
    <section className="explorer__folder" key={group.path}>
      <h3 className="explorer__folder-name">
        <Icon name="folder" size={14} />
        <span>{group.name}</span>
        <span className="explorer__count">{group.notes.length}</span>
      </h3>
      {group.notes.length > 0 ? (
        <ul className="explorer__list" role="list">
          {group.notes.map(row)}
        </ul>
      ) : null}
      {group.children.map(folder)}
    </section>
  );

  return (
    <div className="explorer">
      <header className="explorer__header">
        <h2 className="explorer__title">Notes</h2>
        <span className="explorer__count">{notes.length}</span>
      </header>

      {tools}

      {notes.length === 0 ? (
        <div className="explorer__empty">
          <p className="explorer__empty-text">
            No notes yet. This vault lives in this browser only, and nothing leaves the device.
          </p>
          <button type="button" className="explorer__create" ref={createButtonRef} onClick={onCreate}>
            Create first note
          </button>
          {trashed.length > 0 ? (
            <ul className="explorer__trashed" role="list">
              {trashed.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className="explorer__action"
                    aria-label={`Restore ${note.name}`}
                    onClick={() => onRestore(note.id)}
                  >
                    <Icon name="restore" size={14} />
                    Restore {note.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="explorer__tree">
          {index.folders.map(folder)}
          {index.loose.length > 0 ? (
            <ul className="explorer__list" role="list">
              {index.loose.map(row)}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
