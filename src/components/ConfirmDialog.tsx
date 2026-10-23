/**
 * The confirmation of an action that changes the vault.
 *
 * A native modal dialog gives the top layer, the focus containment, the
 * backdrop and the Escape handling of the platform.
 *
 * The irreversible action of the product asks for the name of the note
 * before it does anything: the destructive button stays closed until the name
 * is written out, so a stray click cannot remove a note. The reversible
 * action only asks whether it should happen.
 */

import { useEffect, useId, useRef, useState } from 'react';

import Icon from './Icon';

export interface ConfirmDialogProps {
  open: boolean;
  /** The heading of the dialog. */
  title: string;
  /** What the action does, in one sentence. */
  message: string;
  /** The label of the button that performs the action. */
  confirmLabel: string;
  /** When it is set, the reader has to write this text before the action is allowed. */
  requireText?: string;
  /** The label of the field of the confirmation. */
  fieldLabel?: string;
  /** True when the action cannot be undone. */
  danger?: boolean;
  /** An action that is offered next to the confirmation, such as a backup. */
  extra?: { label: string; run(): void };
  onClose(): void;
  onConfirm(): void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  requireText,
  fieldLabel,
  danger = false,
  extra,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const baseId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const openedRef = useRef(false);
  const [typed, setTyped] = useState('');

  // The field starts empty every time the dialog opens, so a name that was
  // typed for another note never confirms anything.
  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true;
      setTyped('');
    }
    if (!open) openedRef.current = false;
  }, [open]);

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
    const target = restoreFocus.current;
    if (target?.isConnected) target.focus();
  }, [open]);

  const field = (name: string) => `${baseId}-${name}`;
  const confirmed = requireText === undefined || (typed.length > 0 && typed === requireText);

  return (
    <dialog
      ref={dialogRef}
      className={danger ? 'confirm confirm--danger' : 'confirm'}
      aria-labelledby={field('title')}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <h2 className="confirm__title" id={field('title')}>
        <Icon name={danger ? 'trash' : 'move'} />
        {title}
      </h2>

      <p className="confirm__text">{message}</p>

      {requireText === undefined ? null : (
        <div className="confirm__field">
          <label className="confirm__label" htmlFor={field('confirm')}>
            {fieldLabel ?? 'Type the name to confirm'}
          </label>
          <input
            id={field('confirm')}
            className="confirm__input"
            type="text"
            value={typed}
            autoComplete="off"
            aria-describedby={field('hint')}
            onChange={(event) => setTyped(event.target.value)}
          />
          <p className="confirm__hint" id={field('hint')}>
            The name of the note is “{requireText}”.
          </p>
        </div>
      )}

      <div className="confirm__actions">
        {extra ? (
          <button type="button" className="confirm__action" onClick={extra.run}>
            {extra.label}
          </button>
        ) : null}
        <button
          type="button"
          className={danger ? 'confirm__action confirm__action--danger' : 'confirm__action'}
          disabled={!confirmed}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button type="button" className="confirm__action" onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
