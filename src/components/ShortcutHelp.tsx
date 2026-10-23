import { useEffect, useRef } from 'react';

import type { CommandAction } from '../domain/commands';
import Icon from './Icon';

export interface ShortcutHelpProps {
  /** True when the list of the shortcuts is on the screen. */
  open: boolean;
  /** The catalog of the app, so the list never drifts from the commands. */
  commands: CommandAction[];
  onClose(): void;
}

/**
 * The list of the shortcuts of the app.
 *
 * The panel is a native modal dialog, so it lives in the top layer of the
 * page and the platform owns its focus and its Escape. The list is read from
 * the catalog of the commands, so a shortcut that changes is a shortcut that
 * changes here as well.
 */
export default function ShortcutHelp({ open, commands, onClose }: ShortcutHelpProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const shortcuts = commands.filter((command) => command.shortcut);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        restoreFocus.current = document.activeElement as HTMLElement | null;
        dialog.showModal();
      }
      return;
    }

    if (dialog.open) dialog.close();
    // The platform gives the keyboard back to the element that had it before
    // the dialog opened.
    const target = restoreFocus.current;
    if (target?.isConnected) target.focus();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="shortcuts"
      aria-labelledby="shortcuts-title"
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
      <div className="shortcuts__panel">
        <header className="shortcuts__head">
          <h2 className="shortcuts__title" id="shortcuts-title">
            <Icon name="shortcuts" />
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            className="shortcuts__close"
            aria-label="Close the list of the shortcuts"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <ul className="shortcuts__list" role="list">
          {shortcuts.map((command) => (
            <li className="shortcuts__item" key={command.id}>
              <span className="shortcuts__label">{command.label}</span>
              <kbd className="shortcuts__keys">{command.shortcut}</kbd>
            </li>
          ))}
        </ul>

        <p className="shortcuts__note">
          A shortcut waits while you are writing, while a panel of the app is open and while the
          keyboard is writing a composition.
        </p>
      </div>
    </dialog>
  );
}
