import { useEffect, useRef } from 'react';

import type { Note } from '../domain/types';
import Icon from './Icon';

export interface NoteTabsProps {
  /** The open notes, in the order of the strip. */
  notes: Note[];
  /** The note that is on the screen. */
  activeNoteId: string | null;
  onSelect(id: string): void;
  onClose(id: string): void;
  /** Asks the strip to put the keyboard on one of its tabs. */
  focusRequest?: { id: string | null; request: number } | null;
}

/**
 * The strip of the open notes.
 *
 * A tab is a plain button with the name of its note, so the strip never needs
 * the arrow keys of a tab widget. The close control is a sibling of the tab
 * and never a child of it, so a click on it cannot open the note as well.
 * The strip holds names only: the bodies stay in the vault.
 */
export default function NoteTabs({
  notes,
  activeNoteId,
  onSelect,
  onClose,
  focusRequest,
}: NoteTabsProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  // The keyboard follows the note that took the place of a closed tab.
  useEffect(() => {
    if (!focusRequest?.id) return;
    buttons.current.get(focusRequest.id)?.focus();
  }, [focusRequest]);

  if (notes.length === 0) return null;

  return (
    <div className="tabs" role="group" aria-label="Open notes">
      {notes.map((note) => (
        <div className="tabs__tab" key={note.id}>
          <button
            type="button"
            className="tabs__label"
            ref={(element) => {
              if (element) buttons.current.set(note.id, element);
              else buttons.current.delete(note.id);
            }}
            aria-current={note.id === activeNoteId ? 'true' : undefined}
            onClick={() => onSelect(note.id)}
          >
            {note.name}
          </button>
          <button
            type="button"
            className="tabs__close"
            aria-label={`Close ${note.name}`}
            onClick={() => onClose(note.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
