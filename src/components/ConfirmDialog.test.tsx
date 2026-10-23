import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import ConfirmDialog from './ConfirmDialog';

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

/** What the reader asked for, in the order they asked for it. */
const ACTIONS: string[] = [];

function ConfirmHarness(props: {
  requireText?: string;
  extra?: { label: string; run(): void };
  danger?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open the confirmation
      </button>
      <ConfirmDialog
        open={open}
        title="Delete note permanently"
        message="“Roadmap” is removed for good."
        confirmLabel="Delete permanently"
        requireText={props.requireText}
        fieldLabel="Type the name of the note to confirm"
        danger={props.danger}
        extra={props.extra}
        onClose={() => {
          props.onClose?.();
          setOpen(false);
        }}
        onConfirm={() => {
          ACTIONS.push('confirm');
          setOpen(false);
        }}
      />
    </>
  );
}

function dialog(): HTMLDialogElement {
  const found = container.querySelector<HTMLDialogElement>('dialog.confirm');
  if (!found) throw new Error('no confirm dialog');
  return found;
}

function button(name: string): HTMLButtonElement {
  const found = Array.from(dialog().querySelectorAll<HTMLButtonElement>('button')).find(
    (element) => (element.textContent ?? '').trim() === name,
  );
  if (!found) throw new Error(`no button named "${name}"`);
  return found;
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

async function type(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  ACTIONS.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('the confirmation dialog', () => {
  it('names the action and the note', async () => {
    await render(<ConfirmHarness />);
    await click(container.querySelector('button') as Element);

    expect(dialog().textContent).toContain('Delete note permanently');
    expect(dialog().textContent).toContain('Roadmap');
  });

  it('confirms a reversible action without a name', async () => {
    await render(<ConfirmHarness />);
    await click(container.querySelector('button') as Element);

    expect(button('Delete permanently').disabled).toBe(false);
    await click(button('Delete permanently'));

    expect(ACTIONS).toEqual(['confirm']);
  });

  it('waits for the name of the note before it deletes anything', async () => {
    await render(<ConfirmHarness requireText="Roadmap" />);
    await click(container.querySelector('button') as Element);

    expect(button('Delete permanently').disabled).toBe(true);

    await type(dialog().querySelector('input') as HTMLInputElement, 'Roadmap');

    expect(button('Delete permanently').disabled).toBe(false);
  });

  it('refuses a name that is not the name of the note', async () => {
    await render(<ConfirmHarness requireText="Roadmap" />);
    await click(container.querySelector('button') as Element);

    await type(dialog().querySelector('input') as HTMLInputElement, 'roadmap');

    expect(button('Delete permanently').disabled).toBe(true);
  });

  it('deletes the note only after the name was written', async () => {
    await render(<ConfirmHarness requireText="Roadmap" />);
    await click(container.querySelector('button') as Element);

    await click(button('Delete permanently'));
    expect(ACTIONS).toEqual([]);

    await type(dialog().querySelector('input') as HTMLInputElement, 'Roadmap');
    await click(button('Delete permanently'));

    expect(ACTIONS).toEqual(['confirm']);
  });

  it('offers a backup before the note is removed', async () => {
    await render(
      <ConfirmHarness requireText="Roadmap" extra={{ label: 'Export backup', run: () => ACTIONS.push('export') }} />,
    );
    await click(container.querySelector('button') as Element);

    await click(button('Export backup'));

    expect(ACTIONS).toEqual(['export']);
  });

  it('closes with Escape and gives the keyboard back', async () => {
    let closed = false;
    await render(<ConfirmHarness onClose={() => { closed = true; }} />);
    const trigger = container.querySelector<HTMLButtonElement>('button');
    trigger?.focus();
    await click(trigger as Element);

    await act(async () => {
      dialog().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    expect(closed).toBe(true);
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
