import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Onboarding from './Onboarding';
import { MAX_ENVELOPE_BYTES } from '../domain/transfer';
import { activeNotes } from '../domain/vault';
import type { Vault } from '../domain/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const CREATED: { name: string; vault: Vault }[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  CREATED.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function renderOnboarding(): Promise<void> {
  await act(async () => {
    root.render(
      <Onboarding
        onCreate={async (name, vault) => {
          CREATED.push({ name, vault });
        }}
      />,
    );
  });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function fill(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Hands a file to the backup control of the form. */
async function selectBackup(files: unknown[]): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no backup input');
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submit(): Promise<void> {
  const form = container.querySelector('form');
  if (!form) throw new Error('no form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function radio(value: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!found) throw new Error(`no radio ${value}`);
  return found;
}

function nameField(): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('#onboarding-name');
  if (!found) throw new Error('no name field');
  return found;
}

function errorText(): string {
  return container.querySelector('[role="alert"]')?.textContent?.trim() ?? '';
}

function text(): string {
  return container.textContent ?? '';
}

describe('onboarding', () => {
  it('names the vault field and explains where the notes live', async () => {
    await renderOnboarding();

    const label = container.querySelector('label[for="onboarding-name"]');
    expect(label?.textContent).toContain('Vault name');
    expect(nameField().tagName).toBe('INPUT');

    // The copy is honest: browser local, no account, no server.
    expect(text()).toContain('browser');
    expect(text()).toContain('no account');
    expect(text()).toContain('server');
  });

  it('offers a blank vault, the example and a restore from an export', async () => {
    await renderOnboarding();

    const values = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(
      (input) => input.value,
    );
    expect(values).toEqual(['blank', 'example', 'restore']);
  });

  it('creates a blank vault once', async () => {
    await renderOnboarding();

    await fill(nameField(), 'Journal');
    await submit();
    await submit();

    expect(CREATED).toHaveLength(1);
    expect(CREATED[0]?.name).toBe('Journal');
    expect(activeNotes(CREATED[0]!.vault)).toHaveLength(0);
  });

  it('creates the example vault when it is asked for', async () => {
    await renderOnboarding();

    await click(radio('example'));
    await fill(nameField(), 'Examples');
    await submit();

    expect(CREATED).toHaveLength(1);
    expect(CREATED[0]?.name).toBe('Examples');
    expect(activeNotes(CREATED[0]!.vault).map((note) => note.name)).toContain(
      'Welcome to Lattice Notes',
    );
  });

  it('restores a backup and keeps the names, the bodies and the timestamps', async () => {
    await renderOnboarding();

    const envelope = JSON.stringify({
      app: 'lattice-notes',
      formatVersion: 1,
      notes: [
        {
          name: 'Kept',
          body: '# kept body',
          createdAt: '2024-01-02T03:04:05.000Z',
          updatedAt: '2024-02-03T04:05:06.000Z',
        },
      ],
    });

    await click(radio('restore'));
    await selectBackup([new File([envelope], 'vault.json', { type: 'application/json' })]);
    await fill(nameField(), 'Restored');
    await submit();

    expect(CREATED).toHaveLength(1);
    expect(CREATED[0]?.name).toBe('Restored');
    const notes = activeNotes(CREATED[0]!.vault);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.name).toBe('Kept');
    expect(notes[0]?.body).toBe('# kept body');
    expect(notes[0]?.createdAt).toBe(Date.parse('2024-01-02T03:04:05.000Z'));
    expect(notes[0]?.updatedAt).toBe(Date.parse('2024-02-03T04:05:06.000Z'));
  });

  it('refuses a malformed backup, creates nothing and keeps the form', async () => {
    await renderOnboarding();

    await click(radio('restore'));
    await fill(nameField(), 'My notes');
    await selectBackup([new File(['not json at all'], 'vault.json', { type: 'application/json' })]);
    await submit();

    expect(CREATED).toHaveLength(0);
    expect(errorText()).not.toBe('');
    expect(nameField().value).toBe('My notes');
  });

  it('refuses a backup that is too large and creates nothing', async () => {
    await renderOnboarding();

    await click(radio('restore'));
    await selectBackup([
      { name: 'huge.json', size: MAX_ENVELOPE_BYTES + 1, text: async () => '{}' },
    ]);
    await submit();

    expect(CREATED).toHaveLength(0);
    expect(errorText()).toContain('too large');
  });

  it('refuses a backup that cannot be read and creates nothing', async () => {
    await renderOnboarding();

    await click(radio('restore'));
    await selectBackup([{ name: 'gone.json', size: 12, text: () => Promise.reject(new Error('gone')) }]);
    await submit();

    expect(CREATED).toHaveLength(0);
    expect(errorText()).not.toBe('');
  });

  it('refuses a backup that is not a Lattice Notes export', async () => {
    await renderOnboarding();

    await click(radio('restore'));
    await selectBackup([
      new File([JSON.stringify({ app: 'other', formatVersion: 1, notes: [] })], 'vault.json', {
        type: 'application/json',
      }),
    ]);
    await submit();

    expect(CREATED).toHaveLength(0);
    expect(errorText()).not.toBe('');
  });

  it('asks for a name before it creates anything', async () => {
    await renderOnboarding();

    await fill(nameField(), '   ');
    await submit();

    expect(CREATED).toHaveLength(0);
    expect(errorText()).not.toBe('');
  });

  it('reports a failed creation and lets the form be used again', async () => {
    const failures = vi.fn().mockRejectedValue(new Error('the storage refused the write'));
    await act(async () => {
      root.render(<Onboarding onCreate={failures} />);
    });

    await fill(nameField(), 'Journal');
    await submit();

    expect(errorText()).toContain('the storage refused the write');
    expect(nameField().value).toBe('Journal');
  });
});
