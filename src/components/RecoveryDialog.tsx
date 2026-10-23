/**
 * The recovery history of a note.
 *
 * The dialog lists the bodies the app kept before it replaced them, newest
 * first, with the size of the change each one would bring. Restoring one puts
 * that body back; the body that is on the screen is kept as well, so a
 * restore is reversible too.
 *
 * The history is empty until the app has written a snapshot, and the dialog
 * says so instead of showing an empty list.
 */

import { useEffect, useId, useRef } from 'react';

import { diffCounts } from '../domain/snapshots';
import type { Snapshot } from '../domain/snapshots';
import type { Note } from '../domain/types';
import Icon from './Icon';

export interface RecoveryDialogProps {
  open: boolean;
  /** The note the history belongs to. */
  note: Note | null;
  /** The snapshots of the note, the newest first. */
  snapshots: Snapshot[];
  /** True while the history is being read. */
  loading?: boolean;
  /** Why the history of the note cannot be shown, or nothing when it can. */
  error?: string | null;
  onClose(): void;
  /** Puts the body of the snapshot back into the note. */
  onRestore(snapshot: Snapshot): void;
}

export default function RecoveryDialog({
  open,
  note,
  snapshots,
  loading = false,
  error = null,
  onClose,
  onRestore,
}: RecoveryDialogProps) {
  const baseId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

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
  const body = note?.body ?? '';

  return (
    <dialog
      ref={dialogRef}
      className="recovery"
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
      <h2 className="recovery__title" id={field('title')}>
        <Icon name="restore" />
        Recovery history
      </h2>

      {note ? (
        <p className="recovery__note">The kept bodies of “{note.name}”.</p>
      ) : (
        <p className="recovery__note">No note is open.</p>
      )}

      {loading ? (
        <p className="recovery__empty">The history of this note is being read…</p>
      ) : error ? (
        <p className="recovery__empty">{error}</p>
      ) : snapshots.length === 0 ? (
        <p className="recovery__empty">
          No snapshot of this note yet. A body is kept before it is replaced, and only then.
        </p>
      ) : (
        <ul className="recovery__list" role="list">
          {snapshots.map((snapshot) => {
            const change = diffCounts(body, snapshot.body);
            return (
              <li className="recovery__item" key={snapshot.key}>
                <div className="recovery__facts">
                  <span className="recovery__time">{formatTime(snapshot.at)}</span>
                  <span className="recovery__change">
                    {change.added} line{change.added === 1 ? '' : 's'} added, {change.removed} line
                    {change.removed === 1 ? '' : 's'} removed
                  </span>
                </div>
                <button
                  type="button"
                  className="recovery__restore"
                  aria-label={`Restore the body of ${note?.name ?? 'the note'} from ${formatTime(snapshot.at)}`}
                  onClick={() => onRestore(snapshot)}
                >
                  Restore
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="recovery__actions">
        <button type="button" className="recovery__action" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/** The moment of a snapshot, in the language of the reader. */
function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return new Date(at).toISOString();
  }
}
