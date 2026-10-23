import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { toPlainText } from '../domain/markdown';
import { activeNotes, searchNotes } from '../domain/vault';
import type { Vault } from '../domain/types';
import Icon from './Icon';

export interface QuickSwitcherProps {
  open: boolean;
  vault: Vault;
  onClose(): void;
  onSelect(noteId: string): void;
  onAnnounce(message: string): void;
}

interface SwitcherResult {
  noteId: string;
  name: string;
  /** The text around the match, or the first line of the note. */
  snippet: string | null;
}

/**
 * The quick switcher: a dialog that finds a note by its title or its body.
 *
 * It never creates a note. The only way to open a note is to choose one, so
 * a query can never bring a new note into the vault. The search is the one of
 * the domain, so the switcher and the explorer never disagree about a query.
 */
export default function QuickSwitcher({
  open,
  vault,
  onClose,
  onSelect,
  onAnnounce,
}: QuickSwitcherProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const pendingAction = useRef<(() => void) | null>(null);

  const [query, setQuery] = useState('');
  const [rawIndex, setActiveIndex] = useState(0);

  const trimmed = query.trim();

  const matches = useMemo<SwitcherResult[]>(() => {
    if (!trimmed) {
      // An empty query lists the notes of the vault, so the switcher is
      // useful before anything is typed.
      return activeNotes(vault).map((note) => ({
        noteId: note.id,
        name: note.name,
        snippet: firstLine(note.body),
      }));
    }
    return searchNotes(vault, trimmed).map((match) => ({
      noteId: match.noteId,
      name: match.name,
      snippet: match.snippet,
    }));
  }, [trimmed, vault]);

  // A vault can hold thousands of notes; the list shows one screenful and
  // says how many more match, so the dialog never renders an unbounded list.
  const results = matches.slice(0, RESULT_LIMIT);

  const optionId = (index: number) => `${baseId}-option-${index}`;
  const activeIndex = Math.min(rawIndex, Math.max(0, results.length - 1));
  const activeId = results.length > 0 ? optionId(activeIndex) : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      setQuery('');
      setActiveIndex(0);
      if (!dialog.open) {
        restoreFocus.current = document.activeElement as HTMLElement | null;
        dialog.showModal();
      }
      inputRef.current?.focus();
      return;
    }

    if (dialog.open) dialog.close();

    // The platform gives the focus back to the element that had it before the
    // dialog opened, so a note that is opened runs after that.
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) {
      action();
      return;
    }
    const target = restoreFocus.current;
    if (target?.isConnected) target.focus();
  }, [open]);

  // The result count is announced in the one polite region of the app, so the
  // switcher never brings a second live region with it.
  useEffect(() => {
    if (!open) return;
    if (!trimmed) {
      onAnnounce(`${results.length} ${results.length === 1 ? 'note' : 'notes'}`);
      return;
    }
    onAnnounce(
      results.length === 0
        ? `No note matches “${trimmed}”`
        : `${results.length} ${results.length === 1 ? 'note matches' : 'notes match'} “${trimmed}”`,
    );
  }, [open, onAnnounce, results.length, trimmed]);

  const execute = (result: SwitcherResult) => {
    pendingAction.current = () => onSelect(result.noteId);
    onClose();
  };

  const move = (delta: number) => {
    setActiveIndex((index) => {
      const next = index + delta;
      if (next < 0) return 0;
      if (next > results.length - 1) return Math.max(0, results.length - 1);
      return next;
    });
  };

  return (
    <dialog
      ref={dialogRef}
      className="switcher"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // The platform would close the dialog as well; one path closes it.
        event.preventDefault();
        onClose();
      }}
    >
      <h2 className="switcher__title" id={titleId}>
        <Icon name="search" />
        Quick switcher
      </h2>
      <label className="switcher__label" htmlFor={inputId}>
        Search notes
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="switcher__input"
        type="text"
        role="combobox"
        aria-label="Search notes"
        aria-expanded={results.length > 0}
        aria-controls={results.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        placeholder="Search titles and bodies"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          // A composition is not a command: the text is still being written,
          // so no key moves the selection until the text is committed.
          if (isComposing(event)) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            move(1);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            move(-1);
            return;
          }
          if (event.key === 'Home') {
            event.preventDefault();
            setActiveIndex(0);
            return;
          }
          if (event.key === 'End') {
            event.preventDefault();
            setActiveIndex(Math.max(0, results.length - 1));
            return;
          }
          if (event.key !== 'Enter') return;
          const result = results[activeIndex];
          if (!result) return;
          event.preventDefault();
          execute(result);
        }}
      />
      {results.length > 0 ? (
        <ul className="switcher__list" id={listId} role="listbox" aria-label="Notes">
          {results.map((result, index) => (
            <li
              key={result.noteId}
              className="switcher__option"
              role="option"
              id={optionId(index)}
              aria-selected={index === activeIndex}
              onClick={() => execute(result)}
            >
              <span className="switcher__option-name">{result.name}</span>
              {result.snippet ? <span className="switcher__snippet">{result.snippet}</span> : null}
            </li>
          ))}
          {matches.length > results.length ? (
            <li className="switcher__more" role="presentation">
              {`${matches.length - results.length} more notes match — keep typing to narrow the list.`}
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="switcher__empty">
          {trimmed ? `No note matches “${trimmed}”.` : 'This vault has no notes yet.'}
        </p>
      )}
    </dialog>
  );
}

/** How many results the dialog renders at once. */
const RESULT_LIMIT = 50;

/** The first line of a body, so an empty query still shows something. */
function firstLine(body: string): string | null {
  const text = toPlainText(body).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/** True while the keyboard is writing a composition, not a command. */
function isComposing(event: ReactKeyboardEvent): boolean {
  const native = event.nativeEvent as KeyboardEvent;
  return native.isComposing || native.keyCode === 229;
}
