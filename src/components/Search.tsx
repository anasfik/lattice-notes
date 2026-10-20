import { useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { searchNotes } from '../domain/vault';
import type { Vault } from '../domain/types';

export interface SearchProps {
  vault: Vault;
  onSelect(noteId: string): void;
  onAnnounce(message: string): void;
  /** Lets the app focus the field for the Ctrl/Cmd+P shortcut. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** A control that belongs beside the field, such as the palette trigger. */
  action?: ReactNode;
}

/**
 * Title and body search over the active notes.
 *
 * Matching comes from the domain search so the explorer and the palette can
 * never disagree about what a query means. The query lives here; the app only
 * hears about the notes the user opens.
 */
export default function Search({ vault, onSelect, onAnnounce, inputRef, action }: SearchProps) {
  const [query, setQuery] = useState('');
  const fieldId = useId();
  const localInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? localInput;
  const resultButtons = useRef(new Map<string, HTMLButtonElement>());

  // ponytail: every query walks every body, O(notes x body). Add a domain
  // index when a vault grows past a few hundred notes.
  const results = useMemo(() => searchNotes(vault, query), [vault, query]);
  const trimmed = query.trim();

  const change = (value: string) => {
    setQuery(value);
    const wanted = value.trim();
    if (!wanted) return;
    const count = searchNotes(vault, wanted).length;
    if (count === 0) {
      onAnnounce(`No results for “${wanted}”`);
      return;
    }
    onAnnounce(count === 1 ? `1 result for “${wanted}”` : `${count} results for “${wanted}”`);
  };

  const clear = () => {
    setQuery('');
    onAnnounce('Search cleared');
    input.current?.focus();
  };

  return (
    <search className="search">
      <label className="search__label" htmlFor={fieldId}>
        Search notes
      </label>
      <div className="search__row">
        <input
          id={fieldId}
          ref={input}
          className="search__input"
          type="search"
          value={query}
          placeholder="Title or body"
          aria-keyshortcuts="Control+P Meta+P"
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              if (query) clear();
              else input.current?.blur();
              return;
            }
            if (event.key !== 'ArrowDown' || results.length === 0) return;
            const first = results[0];
            if (!first) return;
            event.preventDefault();
            resultButtons.current.get(first.noteId)?.focus();
          }}
        />
        {action}
      </div>

      {trimmed && results.length === 0 ? (
        <div className="search__empty">
          <p className="search__empty-text">No notes match “{trimmed}”</p>
          <button type="button" className="search__clear" onClick={clear}>
            Clear search
          </button>
        </div>
      ) : null}

      {results.length > 0 ? (
        <ul className="search__results" role="list">
          {results.map((result) => (
            <li key={result.noteId}>
              <button
                type="button"
                className="search__result"
                ref={(element) => {
                  if (element) resultButtons.current.set(result.noteId, element);
                  else resultButtons.current.delete(result.noteId);
                }}
                onClick={() => onSelect(result.noteId)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' || result !== results[0]) return;
                  event.preventDefault();
                  input.current?.focus();
                }}
              >
                <span className="search__result-name">{result.name}</span>
                {result.snippet ? (
                  <span className="search__snippet">{result.snippet}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </search>
  );
}
