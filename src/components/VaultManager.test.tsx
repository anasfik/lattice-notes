import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import VaultManager from './VaultManager';
import type { VaultCatalog } from '../storage/vaultRepository';

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

const CALLS: { action: string; id: string; name?: string }[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  CALLS.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function catalog(): VaultCatalog {
  return {
    version: 1,
    activeVaultId: 'a',
    vaults: [
      { id: 'a', name: 'My vault', createdAt: 1_700_000_000_000, archivedAt: null },
      { id: 'b', name: 'Second vault', createdAt: 1_700_000_100_000, archivedAt: null },
      {
        id: 'c',
        name: 'A very long vault name that has to reflow inside the dialog',
        createdAt: 1_700_000_200_000,
        archivedAt: 1_700_000_300_000,
      },
    ],
  };
}

async function renderManager(): Promise<void> {
  await act(async () => {
    root.render(
      <VaultManager
        open
        catalog={catalog()}
        activeVaultId="a"
        onClose={() => {}}
        onOpen={(id) => CALLS.push({ action: 'open', id })}
        onRename={(id, name) => CALLS.push({ action: 'rename', id, name })}
        onArchive={(id) => CALLS.push({ action: 'archive', id })}
        onRestore={(id) => CALLS.push({ action: 'restore', id })}
        onCreate={(name) => CALLS.push({ action: 'create', id: 'new', name })}
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

function rows(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.vaults__item'));
}

function buttonByName(name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim() === name,
  );
  if (!found) throw new Error(`no button named "${name}"`);
  return found;
}

describe('vault manager', () => {
  it('lists the vaults with their names and their state', async () => {
    await renderManager();

    expect(rows()).toHaveLength(3);
    expect(container.textContent).toContain('My vault');
    expect(container.textContent).toContain('Second vault');
    expect(container.textContent).toContain('Archived');
    // The open vault is marked, so the list says what is on the screen.
    expect(container.textContent).toContain('Open');
  });

  it('opens a vault', async () => {
    await renderManager();

    await click(buttonByName('Open Second vault'));

    expect(CALLS).toEqual([{ action: 'open', id: 'b' }]);
  });

  it('renames a vault', async () => {
    await renderManager();

    await click(buttonByName('Rename Second vault'));
    const input = container.querySelector<HTMLInputElement>('.vaults__rename-input');
    if (!input) throw new Error('no rename input');
    expect(document.activeElement).toBe(input);
    await fill(input, 'Renamed vault');
    await click(buttonByName('Save name'));

    expect(CALLS).toEqual([{ action: 'rename', id: 'b', name: 'Renamed vault' }]);
  });

  it('archives a vault that is not open', async () => {
    await renderManager();

    await click(buttonByName('Archive Second vault'));

    expect(CALLS).toEqual([{ action: 'archive', id: 'b' }]);
  });

  it('refuses to archive the open vault and says why', async () => {
    await renderManager();

    await click(buttonByName('Archive My vault'));

    expect(CALLS).toEqual([]);
    const reason = container.querySelector('.vaults__reason');
    expect(reason?.textContent).toContain('cannot be archived');
  });

  it('restores an archived vault', async () => {
    await renderManager();

    await click(buttonByName('Restore A very long vault name that has to reflow inside the dialog'));

    expect(CALLS).toEqual([{ action: 'restore', id: 'c' }]);
  });

  it('creates a vault with a name', async () => {
    await renderManager();

    await click(buttonByName('New vault'));
    const input = container.querySelector<HTMLInputElement>('.vaults__create-input');
    if (!input) throw new Error('no create input');
    expect(document.activeElement).toBe(input);
    await fill(input, 'Fresh vault');
    await click(buttonByName('Create vault'));

    expect(CALLS).toEqual([{ action: 'create', id: 'new', name: 'Fresh vault' }]);
  });

  it('gives the keyboard back to the trigger when it closes', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Vaults
          </button>
          <VaultManager
            open={open}
            catalog={catalog()}
            activeVaultId="a"
            onClose={() => setOpen(false)}
            onOpen={() => {}}
            onRename={() => {}}
            onArchive={() => {}}
            onRestore={() => {}}
            onCreate={() => {}}
          />
        </>
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });

    const trigger = container.querySelector<HTMLButtonElement>('button');
    if (!trigger) throw new Error('no trigger');
    trigger.focus();
    await click(trigger);

    const dialog = container.querySelector('dialog.vaults');
    expect(dialog?.hasAttribute('open')).toBe(true);

    await click(buttonByName('Done'));

    expect(container.querySelector('dialog.vaults')?.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('lets a long vault name reflow inside the dialog', async () => {
    await renderManager();

    const names = Array.from(container.querySelectorAll('.vaults__name')).map(
      (element) => element.textContent ?? '',
    );
    expect(names.some((name) => name.includes('A very long vault name'))).toBe(true);

    // The rule is in the stylesheet, because a name that is too long must
    // wrap inside the dialog and never push the row out of the window.
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const rule = css.slice(css.indexOf('.vaults__name'));
    expect(rule.slice(0, 400)).toContain('overflow-wrap');
    expect(rule.slice(0, 400)).toContain('min-width: 0');
  });
});
