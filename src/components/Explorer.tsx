import { useEffect, useRef, useState } from 'react';

import type { Note } from '../domain/types';

export interface ExplorerProps {
  notes: Note[];
  trashed: Note[];
  activeNoteId: string | null;
  /** Set by the app after a restore so the keyboard keeps its place. */
  focusNote: { id: string } | null;
  onSelect(id: string): void;
  onCreate(): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onRestore(id: string): void;
}

/** The note list with inline create, rename, delete, and restore actions. */
export default function Explorer({
  notes,
  trashed,
  activeNoteId,
  focusNote,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onRestore,
}: ExplorerProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const noteButtons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!focusNote) return;
    noteButtons.current.get(focusNote.id)?.focus();
  }, [focusNote]);

  const startRename = (note: Note) => {
    setRenamingId(note.id);
    setDraft(note.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setDraft('');
  };

  const commitRename = (id: string) => {
    onRename(id, draft);
    cancelRename();
  };

  return (
    <div className="explorer">
      <header className="explorer__header">
        <h2 className="explorer__title">Notes</h2>
        <span className="explorer__count">{notes.length}</span>
      </header>

      {notes.length === 0 ? (
        <div className="explorer__empty">
          <p className="explorer__empty-text">
            No notes yet. This vault lives in this browser only, and nothing leaves the device.
          </p>
          <button type="button" className="explorer__create" onClick={onCreate}>
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
                    Restore {note.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <ul className="explorer__list" role="list">
          {notes.map((note) => (
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
                    aria-label="Note name"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitRename(note.id);
                      }
                      if (event.key === 'Escape') cancelRename();
                    }}
                  />
                  <button type="submit" className="explorer__action">
                    Save name
                  </button>
                  <button type="button" className="explorer__action" onClick={cancelRename}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="explorer__note"
                    title={note.name}
                    ref={(element) => {
                      if (element) noteButtons.current.set(note.id, element);
                      else noteButtons.current.delete(note.id);
                    }}
                    aria-current={note.id === activeNoteId ? 'true' : undefined}
                    onClick={() => onSelect(note.id)}
                  >
                    {note.name}
                  </button>
                  <button
                    type="button"
                    className="explorer__action"
                    aria-label={`Rename ${note.name}`}
                    onClick={() => startRename(note)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="explorer__action explorer__action--danger"
                    aria-label={`Delete ${note.name}`}
                    onClick={() => onDelete(note.id)}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
