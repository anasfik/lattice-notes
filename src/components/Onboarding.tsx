import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { activeNotes, createEmptyVault } from '../domain/vault';
import { MAX_ENVELOPE_BYTES, importEnvelope } from '../domain/transfer';
import type { Vault } from '../domain/types';
import { createSeedVault } from '../storage/vaultRepository';

export interface OnboardingProps {
  /** Creates the vault and enters the workspace. */
  onCreate(name: string, vault: Vault): Promise<void>;
}

/** What the new vault starts with. */
type Choice = 'blank' | 'example' | 'restore';

/**
 * The first use of the app.
 *
 * The vault is created once, from a name and a choice: an empty vault, the
 * example notes, or a backup that was exported before. A backup is read and
 * checked with the rules of the transfer format before anything is created,
 * so a broken file leaves the form as it is and creates nothing.
 */
export default function Onboarding({ onCreate }: OnboardingProps) {
  const [name, setName] = useState('My vault');
  const [choice, setChoice] = useState<Choice>('blank');
  const [backup, setBackup] = useState<Vault | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The ref guards the second click, the state only shows the button as
  // taken. A state alone would let a second submit through before the
  // first render.
  const busyRef = useRef(false);

  /**
   * Reads the chosen backup and checks it.
   *
   * The file is read here and nowhere else, and it is checked with the rules
   * of the export format. A file that cannot be read, that is too large or
   * that is not an export of this app creates nothing.
   */
  const handleBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    setBackup(null);
    setBackupError(null);
    if (!file) return;

    if (file.size > MAX_ENVELOPE_BYTES) {
      setBackupError('That file is too large to be a Lattice Notes export.');
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      setBackupError('That file could not be read.');
      return;
    }

    try {
      const result = importEnvelope(createEmptyVault(), text);
      if (result.report.skipped.length > 0) {
        setBackupError(
          `The backup holds ${result.report.skipped.length} notes that cannot be read, so it was not used.`,
        );
        return;
      }
      setBackup(result.vault);
    } catch (error) {
      setBackupError(`That file is not a usable Lattice Notes export: ${message(error)}`);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the vault a name.');
      return;
    }
    if (choice === 'restore' && !backup) {
      setError(backupError ?? 'Choose the backup file first.');
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const next =
        choice === 'example'
          ? createSeedVault()
          : choice === 'restore'
            ? (backup as Vault)
            : createEmptyVault();
      await onCreate(trimmed, next);
    } catch (error) {
      setError(`The vault could not be created: ${message(error)}`);
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="onboarding" aria-label="Welcome to Lattice Notes">
      <div className="onboarding__panel">
        <h1 className="onboarding__title">Lattice Notes</h1>
        <p className="onboarding__intro">
          Your notes stay in this browser. There is no account and no server, and nothing is uploaded.
          Clearing the browser data deletes them, so export a backup now and then.
        </p>

        <form className="onboarding__form" onSubmit={handleSubmit}>
          <label className="onboarding__label" htmlFor="onboarding-name">
            Vault name
          </label>
          <input
            id="onboarding-name"
            className="onboarding__name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <fieldset className="onboarding__choices">
            <legend className="onboarding__legend">What should the vault hold?</legend>
            <label className="onboarding__choice">
              <input
                type="radio"
                name="onboarding-kind"
                value="blank"
                checked={choice === 'blank'}
                onChange={() => setChoice('blank')}
              />
              <span>Start with an empty vault</span>
            </label>
            <label className="onboarding__choice">
              <input
                type="radio"
                name="onboarding-kind"
                value="example"
                checked={choice === 'example'}
                onChange={() => setChoice('example')}
              />
              <span>Start with the example notes</span>
            </label>
            <label className="onboarding__choice">
              <input
                type="radio"
                name="onboarding-kind"
                value="restore"
                checked={choice === 'restore'}
                onChange={() => setChoice('restore')}
              />
              <span>Restore a backup from a JSON export</span>
            </label>
          </fieldset>

          {choice === 'restore' ? (
            <div className="onboarding__restore">
              <label className="onboarding__label" htmlFor="onboarding-backup">
                Lattice Notes export file
              </label>
              <input
                id="onboarding-backup"
                className="onboarding__file"
                type="file"
                accept=".json,application/json"
                onChange={handleBackup}
              />
              {backupError ? (
                <p className="onboarding__error" role="alert">
                  {backupError}
                </p>
              ) : null}
              {backup ? (
                <p className="onboarding__note">
                  The backup holds {activeNotes(backup).length} notes and is ready to restore.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="onboarding__error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="onboarding__create" disabled={busy}>
            {busy ? 'Creating…' : 'Create vault'}
          </button>
        </form>
      </div>
    </main>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'the storage could not be written.';
}
