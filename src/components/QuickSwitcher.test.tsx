import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import QuickSwitcher from './QuickSwitcher';
import { activeNotes, createEmptyVault, createNote } from '../domain/vault';
import type { Vault } from '../domain/types';

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

/** A vault with more notes than the switcher draws at once. */
function manyNotes(count: number): Vault {
  let vault = createEmptyVault();
  for (let index = 0; index < count; index += 1) {
    vault = createNote(vault, `Note ${index}`, `body ${index}`).vault;
  }
  return vault;
}

let container: HTMLDivElement;
let root: Root;

/** A vault with two notes. */
function vault(): Vault {
  const first = createNote(createEmptyVault(), 'Roadmap', 'Plan the release.');
  const second = createNote(first.vault, 'Backlog', 'Nothing here yet.');
  return second.vault;
}

function dialog(): HTMLDialogElement {
  const found = container.querySelector<HTMLDialogElement>('dialog.switcher');
  if (!found) throw new Error('no switcher dialog');
  return found;
}

function input(): HTMLInputElement {
  const found = dialog().querySelector<HTMLInputElement>('input');
  if (!found) throw new Error('no switcher input');
  return found;
}

function options(): HTMLElement[] {
  return Array.from(dialog().querySelectorAll<HTMLElement>('[role="option"]'));
}

/**
 * The switcher inside a parent that closes it, like the app does.
 *
 * The note opens after the dialog closed, so the platform cannot take the
 * keyboard back from the place the note was opened.
 */
function SwitcherHarness(props: {
  vault: Vault;
  onClose?: () => void;
  onSelect(noteId: string): void;
  onAnnounce(message: string): void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <QuickSwitcher
      open={open}
      vault={props.vault}
      onClose={() => {
        props.onClose?.();
        setOpen(false);
      }}
      onSelect={props.onSelect}
      onAnnounce={props.onAnnounce}
    />
  );
}

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
  });
}

async function fill(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pressKey(element: Element, key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('quick switcher', () => {
  it('lists the notes of the vault when the query is empty', async () => {
    await render(
      <QuickSwitcher open vault={vault()} onClose={() => {}} onSelect={() => {}} onAnnounce={() => {}} />,
    );

    expect(dialog().hasAttribute('open')).toBe(true);
    expect(options().map((option) => option.textContent)).toEqual([
      expect.stringContaining('Roadmap'),
      expect.stringContaining('Backlog'),
    ]);
  });

  it('names the query field', async () => {
    await render(
      <QuickSwitcher open vault={vault()} onClose={() => {}} onSelect={() => {}} onAnnounce={() => {}} />,
    );

    expect(input().getAttribute('aria-label')).toBe('Search notes');
    expect(dialog().querySelector('label')?.getAttribute('for')).toBe(input().id);
  });

  it('finds a note by its title and by its body', async () => {
    await render(
      <QuickSwitcher open vault={vault()} onClose={() => {}} onSelect={() => {}} onAnnounce={() => {}} />,
    );

    await fill(input(), 'Backlog');
    expect(options()).toHaveLength(1);
    expect(options()[0]?.textContent).toContain('Backlog');

    await fill(input(), 'release');
    expect(options()).toHaveLength(1);
    expect(options()[0]?.textContent).toContain('Roadmap');
    // The snippet of the body is shown with the name.
    expect(options()[0]?.querySelector('.switcher__snippet')?.textContent).toContain(
      'Plan the release',
    );
  });

  it('says that nothing matches the query', async () => {
    await render(
      <QuickSwitcher open vault={vault()} onClose={() => {}} onSelect={() => {}} onAnnounce={() => {}} />,
    );

    await fill(input(), 'zzz absent');

    expect(options()).toHaveLength(0);
    expect(dialog().querySelector('.switcher__empty')?.textContent).toContain('zzz absent');
  });

  it('announces the result count in the one live region', async () => {
    const announced: string[] = [];
    await render(
      <QuickSwitcher
        open
        vault={vault()}
        onClose={() => {}}
        onSelect={() => {}}
        onAnnounce={(message) => announced.push(message)}
      />,
    );

    await fill(input(), 'Roadmap');

    expect(announced.some((message) => message.includes('Roadmap'))).toBe(true);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  it('opens the note of the active result once', async () => {
    const opened: string[] = [];
    const notes = vault();
    await render(
      <SwitcherHarness
        vault={notes}
        onClose={() => {}}
        onSelect={(id) => opened.push(id)}
        onAnnounce={() => {}}
      />,
    );

    await fill(input(), 'Backlog');
    await pressKey(input(), 'Enter');

    expect(opened).toHaveLength(1);
    const openedNote = activeNotes(notes).find((note) => note.id === opened[0]);
    expect(openedNote?.name).toBe('Backlog');
  });

  it('moves the active result with the arrow keys', async () => {
    await render(
      <QuickSwitcher open vault={vault()} onClose={() => {}} onSelect={() => {}} onAnnounce={() => {}} />,
    );

    expect(input().getAttribute('aria-activedescendant')).toContain('option-0');
    await pressKey(input(), 'ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toContain('option-1');
    await pressKey(input(), 'End');
    expect(input().getAttribute('aria-activedescendant')).toContain('option-1');
    await pressKey(input(), 'Home');
    expect(input().getAttribute('aria-activedescendant')).toContain('option-0');
  });

  it('does not open a note while the text is composed', async () => {
    const opened: string[] = [];
    await render(
      <SwitcherHarness
        vault={vault()}
        onClose={() => {}}
        onSelect={(id) => opened.push(id)}
        onAnnounce={() => {}}
      />,
    );

    await pressKey(input(), 'Enter', { isComposing: true });

    expect(opened).toHaveLength(0);
  });

  it('never offers to create a note', async () => {
    await render(
      <QuickSwitcher open vault={vault()} onClose={() => {}} onSelect={() => {}} onAnnounce={() => {}} />,
    );

    await fill(input(), 'Ghost');

    expect(dialog().textContent).not.toContain('Create');
    expect(options()).toHaveLength(0);
  });

  it('closes with Escape', async () => {
    let closed = false;
    await render(
      <SwitcherHarness
        vault={vault()}
        onClose={() => {
          closed = true;
        }}
        onSelect={() => {}}
        onAnnounce={() => {}}
      />,
    );

    await pressKey(input(), 'Escape');

    expect(closed).toBe(true);
    expect(dialog().hasAttribute('open')).toBe(false);
  });

  it('caps the list and says how many notes are left', async () => {
    await render(
      <QuickSwitcher open vault={manyNotes(60)} onClose={() => {}} onSelect={() => {}} onAnnounce={() => {}} />,
    );

    expect(options()).toHaveLength(50);
    expect(dialog().textContent).toContain('10 more notes match');
  });

  it('keeps the arrows out of an input method composition', async () => {
    await render(
      <QuickSwitcher open vault={vault()} onClose={() => {}} onSelect={() => {}} onAnnounce={() => {}} />,
    );
    const first = dialog().querySelector('[aria-selected="true"]');

    await pressKey(input(), 'ArrowDown', { isComposing: true });

    expect(dialog().querySelector('[aria-selected="true"]')).toBe(first);
  });
});
