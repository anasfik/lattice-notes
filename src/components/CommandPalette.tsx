import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { searchNotes } from '../domain/vault';
import type { Vault } from '../domain/types';

export interface CommandPaletteProps {
  open: boolean;
  vault: Vault;
  onClose(): void;
  onSelect(noteId: string): void;
  onCreate(): void;
  onFocusSearch(): void;
  onAnnounce(message: string): void;
}

interface PaletteOption {
  id: string;
  label: string;
  hint: string;
  run(): void;
}

const COMMANDS: { id: string; label: string; hint: string }[] = [
  { id: 'new', label: 'New note', hint: 'Create an empty note' },
  { id: 'search', label: 'Search notes', hint: 'Search titles and bodies' },
];

/**
 * The keyboard command palette.
 *
 * A native modal dialog gives the top layer, the focus containment, the
 * backdrop, and the Escape handling of the platform. The list is a combobox:
 * the field keeps the focus and the active option is named by
 * `aria-activedescendant`.
 */
export default function CommandPalette({
  open,
  vault,
  onClose,
  onSelect,
  onCreate,
  onFocusSearch,
  onAnnounce,
}: CommandPaletteProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const pendingAction = useRef<(() => void) | null>(null);

  const [query, setQuery] = useState('');
  const [rawIndex, setActiveIndex] = useState(0);

  const trimmed = query.trim();

  const options = useMemo<PaletteOption[]>(() => {
    const needle = trimmed.toLowerCase();
    const commands = COMMANDS.filter(
      (command) => !needle || command.label.toLowerCase().includes(needle),
    ).map<PaletteOption>((command) => ({
      id: `command-${command.id}`,
      label: command.label,
      hint: command.hint,
      run:
        command.id === 'new'
          ? onCreate
          : () => {
              onFocusSearch();
              onAnnounce('Search ready');
            },
    }));

    const matches = searchNotes(vault, trimmed);
    const notes = [
      ...matches.filter((match) => match.matchIn === 'title'),
      ...matches.filter((match) => match.matchIn === 'body'),
    ].map<PaletteOption>((match) => ({
      id: `note-${match.noteId}`,
      label: match.name,
      hint: match.snippet ?? 'Note',
      run: () => onSelect(match.noteId),
    }));

    return [...commands, ...notes];
  }, [trimmed, vault, onCreate, onFocusSearch, onSelect, onAnnounce]);

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
    // dialog opened, so a command that moves the focus runs after that.
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) {
      action();
      return;
    }
    const target = restoreFocus.current;
    if (target?.isConnected) target.focus();
  }, [open]);

  const optionId = (index: number) => `${baseId}-option-${index}`;
  const activeIndex = Math.min(rawIndex, Math.max(0, options.length - 1));
  const activeId = options.length > 0 ? optionId(activeIndex) : undefined;

  const execute = (option: PaletteOption) => {
    pendingAction.current = option.run;
    onClose();
  };

  const move = (delta: number) => {
    setActiveIndex((index) => {
      const next = index + delta;
      if (next < 0) return 0;
      if (next > options.length - 1) return Math.max(0, options.length - 1);
      return next;
    });
  };

  return (
    <dialog
      ref={dialogRef}
      className="palette"
      aria-labelledby={`${baseId}-title`}
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
      <h2 className="palette__title" id={`${baseId}-title`}>
        Command palette
      </h2>
      <input
        ref={inputRef}
        className="palette__input"
        type="text"
        role="combobox"
        aria-label="Search commands and notes"
        aria-expanded={options.length > 0}
        aria-controls={options.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        placeholder="Run a command or find a note"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
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
            setActiveIndex(Math.max(0, options.length - 1));
            return;
          }
          if (event.key !== 'Enter') return;
          const option = options[activeIndex];
          if (!option) return;
          event.preventDefault();
          execute(option);
        }}
      />
      {options.length > 0 ? (
        <ul className="palette__list" id={listId} role="listbox" aria-label="Commands and notes">
          {options.map((option, index) => (
            <li
              key={option.id}
              className="palette__option"
              role="option"
              id={optionId(index)}
              aria-selected={index === activeIndex}
              onClick={() => execute(option)}
            >
              <span className="palette__option-label">{option.label}</span>
              <span className="palette__option-hint">{option.hint}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="palette__empty">No command or note matches “{trimmed}”.</p>
      )}
    </dialog>
  );
}
