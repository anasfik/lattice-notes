import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { CommandAction } from '../domain/commands';

export interface CommandPaletteProps {
  open: boolean;
  /** The catalog of the app. The palette shows it as it is. */
  commands: CommandAction[];
  onClose(): void;
  onAnnounce(message: string): void;
}

/**
 * The keyboard command palette.
 *
 * A native modal dialog gives the top layer, the focus containment, the
 * backdrop, and the Escape handling of the platform. The list is a combobox:
 * the field keeps the focus and the active option is named by
 * `aria-activedescendant`. A command that cannot run keeps its place in the
 * list and says why, so it never disappears.
 */
export default function CommandPalette({ open, commands, onClose, onAnnounce }: CommandPaletteProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const pendingAction = useRef<(() => void) | null>(null);

  const [query, setQuery] = useState('');
  const [rawIndex, setActiveIndex] = useState(0);

  const trimmed = query.trim();

  const options = useMemo<CommandAction[]>(() => {
    const needle = trimmed.toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.category.toLowerCase().includes(needle),
    );
  }, [commands, trimmed]);

  // A command that cannot run is never the active one, so the keyboard always
  // lands on a command that does something.
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const activeIndex = Math.min(rawIndex, Math.max(0, options.length - 1));
  const activeId = options.length > 0 ? optionId(activeIndex) : undefined;

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

  const execute = (option: CommandAction) => {
    if (option.disabledReason) {
      // The reason belongs in the one polite region, so the reader hears why
      // the command did nothing.
      onAnnounce(`${option.label} is not available: ${option.disabledReason}`);
      return;
    }
    pendingAction.current = option.run;
    onClose();
  };

  /** Moves the active option to the next command that can run. */
  const move = (delta: number) => {
    setActiveIndex((index) => {
      for (let step = 1; step <= options.length; step += 1) {
        const next = index + delta * step;
        if (next < 0 || next > options.length - 1) return index;
        if (!options[next]?.disabledReason) return next;
      }
      return index;
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
        aria-label="Search commands"
        aria-expanded={options.length > 0}
        aria-controls={options.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        placeholder="Run a command"
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
        <ul className="palette__list" id={listId} role="listbox" aria-label="Commands">
          {options.map((option, index) => (
            <li
              key={option.id}
              className="palette__option"
              role="option"
              id={optionId(index)}
              aria-selected={index === activeIndex}
              aria-disabled={option.disabledReason ? 'true' : undefined}
              onClick={() => execute(option)}
            >
              <span className="palette__option-label">
                <span className="palette__option-category">{option.category}</span>
                {option.label}
              </span>
              <span className="palette__option-hint">
                {option.disabledReason ?? option.shortcut ?? ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="palette__empty">No command matches “{trimmed}”.</p>
      )}
      <p className="palette__count">{commands.length} commands</p>
    </dialog>
  );
}

/** True while the keyboard is writing a composition, not a command. */
function isComposing(event: ReactKeyboardEvent): boolean {
  const native = event.nativeEvent as KeyboardEvent;
  return native.isComposing || native.keyCode === 229;
}
