/**
 * The settings of the app.
 *
 * A native modal dialog gives the top layer, the focus containment, the
 * backdrop and the Escape handling of the platform. Every control carries a
 * label, so the reader never meets an unnamed field.
 *
 * The dialog holds a draft: the settings are written when the reader applies
 * them, and closing the dialog without applying leaves the stored settings
 * exactly as they were. A setting that the product does not honour yet has no
 * control here, so nothing on the screen can lie about what it changes.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { normalizeSettings } from '../domain/settings';
import type { AppSettings } from '../domain/settings';
import Icon from './Icon';

export interface SettingsDialogProps {
  open: boolean;
  /** The settings as they are stored right now. */
  settings: AppSettings;
  onClose(): void;
  /** Writes the settings and closes the dialog. */
  onApply(settings: AppSettings): void;
}

/** The themes the product can show. */
const THEMES: { value: AppSettings['theme']; label: string }[] = [
  { value: 'system', label: 'Follow the system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsDialog({ open, settings, onClose, onApply }: SettingsDialogProps) {
  const baseId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const openedRef = useRef(false);
  const [draft, setDraft] = useState<AppSettings>(settings);

  // The draft follows the stored settings when the dialog opens, and only
  // then: a change of the stored settings while the dialog is open is not
  // expected and would throw the edits of the reader away.
  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true;
      setDraft(settings);
    }
    if (!open) openedRef.current = false;
  }, [open, settings]);

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

  const numberOf = (value: string, fallback: number): number => {
    // A cleared field is "no value", not a snapshot gap of zero minutes.
    const parsed = value.trim() === '' ? NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onApply(normalizeSettings(draft));
  };

  return (
    <dialog
      ref={dialogRef}
      className="settings"
      aria-labelledby={field('title')}
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
      <h2 className="settings__title" id={field('title')}>
        <Icon name="settings" />
        Settings
      </h2>

      <form className="settings__form" onSubmit={submit}>
        <div className="settings__field">
          <label className="settings__label" htmlFor={field('confirm')}>
            <input
              id={field('confirm')}
              type="checkbox"
              checked={draft.confirmDelete}
              onChange={(event) => setDraft({ ...draft, confirmDelete: event.target.checked })}
            />
            Ask before trashing a note
          </label>
          <p className="settings__hint">
            A trashed note stays recoverable until it is deleted for good. This asks first.
          </p>
        </div>

        <div className="settings__field">
          <label className="settings__label" htmlFor={field('interval')}>
            Snapshot interval in minutes
          </label>
          <input
            id={field('interval')}
            className="settings__number"
            type="number"
            min={0}
            max={60}
            step={1}
            value={draft.snapshotIntervalMinutes}
            onChange={(event) =>
              setDraft({
                ...draft,
                snapshotIntervalMinutes: numberOf(event.target.value, draft.snapshotIntervalMinutes),
              })
            }
          />
          <p className="settings__hint">
            How long the app waits before it keeps a copy of a body. 0 turns the history off.
          </p>
        </div>

        <div className="settings__field">
          <label className="settings__label" htmlFor={field('retention')}>
            Snapshot retention in days
          </label>
          <input
            id={field('retention')}
            className="settings__number"
            type="number"
            min={1}
            max={90}
            step={1}
            value={draft.snapshotRetentionDays}
            onChange={(event) =>
              setDraft({
                ...draft,
                snapshotRetentionDays: numberOf(event.target.value, draft.snapshotRetentionDays),
              })
            }
          />
          <p className="settings__hint">How long a kept body stays recoverable. 1 to 90 days.</p>
        </div>

        <div className="settings__field">
          <label className="settings__label" htmlFor={field('spellcheck')}>
            <input
              id={field('spellcheck')}
              type="checkbox"
              checked={draft.spellcheck}
              onChange={(event) => setDraft({ ...draft, spellcheck: event.target.checked })}
            />
            Spell check in the editor
          </label>
          <p className="settings__hint">The editor marks the words the browser does not know.</p>
        </div>

        <div className="settings__field">
          <label className="settings__label" htmlFor={field('theme')}>
            Theme
          </label>
          <select
            id={field('theme')}
            className="settings__select"
            value={draft.theme}
            onChange={(event) =>
              setDraft({ ...draft, theme: event.target.value as AppSettings['theme'] })
            }
          >
            {THEMES.map((theme) => (
              <option key={theme.value} value={theme.value}>
                {theme.label}
              </option>
            ))}
          </select>
        </div>

        <p className="settings__hint">
          Daily notes are named after the local date, as {draft.dailyNoteFormat}.
        </p>

        <div className="settings__actions">
          <button type="submit" className="settings__action settings__action--primary">
            Save settings
          </button>
          <button type="button" className="settings__action" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
