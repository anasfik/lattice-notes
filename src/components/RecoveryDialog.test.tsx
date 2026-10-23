import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import RecoveryDialog from './RecoveryDialog';
import type { Snapshot } from '../domain/snapshots';
import type { Note } from '../domain/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom ships the dialog element without the modal behaviour, so the harness
// stands in for the platform: the open state, the focus moved into the
// dialog, and the focus restored to the element that had it before.
const dialogProto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
if (typeof dialogProto.showModal !== 'function') {
  const restore = new WeakMap<object, HTMLElement | null>();
  dialogProto.showModal = function showModal(this: HTMLDialogElement) {
    restore.set(this, document.activeElement as HTMLElement | null);
    this.setAttribute('open', '');
    this.querySelector<HTMLElement>('input, button')?.focus();
  };
  dialogProto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
    restore.get(this)?.focus();
  };
}

let container: HTMLDivElement;
let root: Root;

/** The snapshots that were restored, in the order they were restored. */
const RESTORED: Snapshot[] = [];

const NOTE: Note = {
  id: 'note-1',
  name: 'Roadmap',
  body: 'the current body',
  createdAt: 1,
  updatedAt: 2,
  deletedAt: null,
};

/** A snapshot of the note, as the storage would give it back. */
function snapshot(body: string, at: number): Snapshot {
  return { key: `key-${at}`, vaultId: 'current', noteId: NOTE.id, at, body };
}

function RecoveryHarness(props: { snapshots: Snapshot[]; error?: string | null; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open recovery
      </button>
      <RecoveryDialog
        open={open}
        note={NOTE}
        snapshots={props.snapshots}
        error={props.error}
        onClose={() => {
          props.onClose?.();
          setOpen(false);
        }}
        onRestore={(chosen) => {
          RESTORED.push(chosen);
          setOpen(false);
        }}
      />
    </>
  );
}

function dialog(): HTMLDialogElement {
  const found = container.querySelector<HTMLDialogElement>('dialog.recovery');
  if (!found) throw new Error('no recovery dialog');
  return found;
}

function items(): HTMLElement[] {
  return Array.from(dialog().querySelectorAll<HTMLElement>('.recovery__item'));
}

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
  });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function pressKey(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  RESTORED.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('the recovery dialog', () => {
  it('lists the snapshots of the note', async () => {
    await render(<RecoveryHarness snapshots={[snapshot('newer body', 2000), snapshot('older body', 1000)]} />);
    await click(container.querySelector('button') as Element);

    expect(items()).toHaveLength(2);
    expect(dialog().textContent).toContain('Roadmap');
  });

  it('says when there is no snapshot yet', async () => {
    await render(<RecoveryHarness snapshots={[]} />);
    await click(container.querySelector('button') as Element);

    expect(items()).toHaveLength(0);
    expect(dialog().textContent).toContain('No snapshot');
  });

  it('restores the chosen snapshot', async () => {
    await render(<RecoveryHarness snapshots={[snapshot('newer body', 2000), snapshot('older body', 1000)]} />);
    await click(container.querySelector('button') as Element);

    const restore = items()[1]?.querySelector<HTMLButtonElement>('button');
    await click(restore as Element);

    expect(RESTORED).toHaveLength(1);
    expect(RESTORED[0]?.body).toBe('older body');
  });

  it('names the note and the moment of every snapshot', async () => {
    await render(<RecoveryHarness snapshots={[snapshot('older body', 1000)]} />);
    await click(container.querySelector('button') as Element);

    const restore = items()[0]?.querySelector<HTMLButtonElement>('button');
    expect(restore?.getAttribute('aria-label')).toContain('Roadmap');
    expect(restore?.getAttribute('aria-label')).toContain('Restore');
  });

  it('shows how much a restore would change', async () => {
    await render(<RecoveryHarness snapshots={[snapshot('a\nb\nc', 1000)]} />);
    await click(container.querySelector('button') as Element);

    // The body on the screen has one line, the snapshot has three.
    expect(dialog().textContent).toContain('3 lines added');
    expect(dialog().textContent).toContain('1 line removed');
  });

  it('says when the history cannot be read', async () => {
    await render(<RecoveryHarness snapshots={[]} error="The recovery history of this note could not be read." />);
    await click(container.querySelector('button') as Element);

    expect(dialog().textContent).toContain('The recovery history of this note could not be read.');
  });

  it('closes with Escape and gives the keyboard back', async () => {
    let closed = false;
    await render(<RecoveryHarness snapshots={[]} onClose={() => { closed = true; }} />);
    const trigger = container.querySelector<HTMLButtonElement>('button');
    trigger?.focus();
    await click(trigger as Element);

    await pressKey(dialog(), 'Escape');

    expect(closed).toBe(true);
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
