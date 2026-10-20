import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type { VaultCatalog, VaultMetadata } from '../storage/vaultRepository';

export interface VaultManagerProps {
  open: boolean;
  catalog: VaultCatalog;
  /** The vault that is on the screen. */
  activeVaultId: string;
  /** Operation failures must remain visible in the modal top layer. */
  error?: string | null;
  onClose(): void;
  onOpen(id: string): void;
  onRename(id: string, name: string): void;
  onArchive(id: string): void;
  onRestore(id: string): void;
  onCreate(name: string): void;
}

/**
 * The manager of the vaults of this browser.
 *
 * A native modal dialog gives the top layer, the focus containment and the
 * Escape handling of the platform. Every vault of the catalog is listed with
 * its state, and the actions that are not possible carry their reason on the
 * screen, so nothing is refused without an explanation.
 */
export default function VaultManager({
  open,
  catalog,
  activeVaultId,
  error,
  onClose,
  onOpen,
  onRename,
  onArchive,
  onRestore,
  onCreate,
}: VaultManagerProps) {
  const baseId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

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

  const startRename = (member: VaultMetadata) => {
    setRenamingId(member.id);
    setDraft(member.name);
    setCreating(false);
  };

  const commitRename = (id: string) => {
    const name = draft.trim();
    setRenamingId(null);
    setDraft('');
    if (!name) return;
    onRename(id, name);
  };

  const commitCreate = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    setCreating(false);
    setNewName('');
    if (!name) return;
    onCreate(name);
  };

  return (
    <dialog
      ref={dialogRef}
      className="vaults"
      aria-labelledby={`${baseId}-title`}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 className="vaults__title" id={`${baseId}-title`}>
        Vaults
      </h2>
      <p className="vaults__intro">
        Every vault of this browser lives in the same local storage. Archiving keeps the notes and can be
        undone.
      </p>

      {open && error ? <p className="vaults__error" role="alert">{error}</p> : null}

      <ul className="vaults__list" role="list">
        {catalog.vaults.map((member) => {
          const isOpen = member.id === activeVaultId;
          const archived = member.archivedAt !== null;

          return (
            <li className="vaults__item" key={member.id}>
              {renamingId === member.id ? (
                <form
                  className="vaults__rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commitRename(member.id);
                  }}
                >
                  <input
                    className="vaults__rename-input"
                    aria-label={`New name of ${member.name}`}
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <button type="submit" className="vaults__action">
                    Save name
                  </button>
                  <button
                    type="button"
                    className="vaults__action"
                    onClick={() => setRenamingId(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div className="vaults__head">
                    <span className="vaults__name">{member.name}</span>
                    <span className="vaults__state">
                      {isOpen ? 'Open' : archived ? 'Archived' : 'Ready'}
                    </span>
                  </div>

                  <div className="vaults__actions">
                    <button
                      type="button"
                      className="vaults__action"
                      aria-label={`Open ${member.name}`}
                      aria-disabled={isOpen || archived}
                      onClick={() => {
                        if (isOpen || archived) return;
                        onOpen(member.id);
                      }}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="vaults__action"
                      aria-label={`Rename ${member.name}`}
                      onClick={() => startRename(member)}
                    >
                      Rename
                    </button>
                    {archived ? (
                      <button
                        type="button"
                        className="vaults__action"
                        aria-label={`Restore ${member.name}`}
                        onClick={() => onRestore(member.id)}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="vaults__action"
                        aria-label={`Archive ${member.name}`}
                        aria-disabled={isOpen}
                        onClick={() => {
                          if (isOpen) return;
                          onArchive(member.id);
                        }}
                      >
                        Archive
                      </button>
                    )}
                  </div>

                  {isOpen ? (
                    <p className="vaults__reason">
                      The open vault cannot be archived. Open another vault first.
                    </p>
                  ) : null}
                  {archived ? (
                    <p className="vaults__reason">
                      An archived vault cannot be opened. Restore it first.
                    </p>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div className="vaults__create">
        {creating ? (
          <form className="vaults__create-form" onSubmit={commitCreate}>
            <label className="vaults__label" htmlFor={`${baseId}-new-name`}>
              Name of the new vault
            </label>
            <input
              id={`${baseId}-new-name`}
              className="vaults__create-input"
              value={newName}
              autoFocus
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" className="vaults__action">
              Create vault
            </button>
            <button type="button" className="vaults__action" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="vaults__action"
            aria-label="New vault"
            onClick={() => {
              setCreating(true);
              setRenamingId(null);
            }}
          >
            New vault
          </button>
        )}
      </div>

      <button type="button" className="vaults__done" onClick={onClose}>
        Done
      </button>
    </dialog>
  );
}
