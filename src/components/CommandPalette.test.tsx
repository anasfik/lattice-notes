import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import CommandPalette from './CommandPalette';
import { buildCommands } from '../domain/commands';
import type { CommandAction } from '../domain/commands';

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

const RUN: string[] = [];

/** A small catalog with one command that cannot run. */
function commands(): CommandAction[] {
  return buildCommands(
    { hasActiveNote: false, canUndo: false, openTabCount: 0, contextPanelToggleable: true },
    {
      createNote: () => RUN.push('createNote'),
      renameNote: () => RUN.push('renameNote'),
      trashNote: () => RUN.push('trashNote'),
      undo: () => RUN.push('undo'),
      importMarkdown: () => RUN.push('importMarkdown'),
      exportVault: () => RUN.push('exportVault'),
      setViewMode: (mode) => RUN.push(`setViewMode:${mode}`),
      openSwitcher: () => RUN.push('openSwitcher'),
      focusSearch: () => RUN.push('focusSearch'),
      openVaultManager: () => RUN.push('openVaultManager'),
      toggleContextPanel: () => RUN.push('toggleContextPanel'),
      closeTab: () => RUN.push('closeTab'),
      nextTab: () => RUN.push('nextTab'),
      previousTab: () => RUN.push('previousTab'),
    },
  );
}

function dialog(): HTMLDialogElement {
  const found = container.querySelector<HTMLDialogElement>('dialog.palette');
  if (!found) throw new Error('no palette dialog');
  return found;
}

/**
 * The palette inside a parent that closes it, like the app does.
 *
 * The command runs after the dialog closed, so the platform cannot take the
 * keyboard back from the place the command moved it to.
 */
function PaletteHarness(props: {
  commands: CommandAction[];
  onClose?: () => void;
  onAnnounce(message: string): void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <CommandPalette
      open={open}
      commands={props.commands}
      onClose={() => {
        props.onClose?.();
        setOpen(false);
      }}
      onAnnounce={props.onAnnounce}
    />
  );
}

function input(): HTMLInputElement {
  const found = dialog().querySelector<HTMLInputElement>('input');
  if (!found) throw new Error('no palette input');
  return found;
}

function options(): HTMLElement[] {
  return Array.from(dialog().querySelectorAll<HTMLElement>('[role="option"]'));
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
  RUN.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('command palette', () => {
  it('lists the commands of the catalog with their shortcut', async () => {
    await render(
      <PaletteHarness commands={commands()} onAnnounce={() => {}} />,
    );

    const labels = options().map((option) => option.textContent ?? '');
    expect(labels.some((label) => label.includes('New note'))).toBe(true);
    expect(labels.some((label) => label.includes('Ctrl/Cmd+N'))).toBe(true);
    expect(labels.some((label) => label.includes('Note'))).toBe(true);
  });

  it('keeps a command that cannot run and says why', async () => {
    await render(
      <PaletteHarness commands={commands()} onAnnounce={() => {}} />,
    );

    const rename = options().find((option) => option.textContent?.includes('Rename note'));
    expect(rename?.textContent).toContain('Open a note first');
    expect(rename?.getAttribute('aria-disabled')).toBe('true');
  });

  it('runs the active command with Enter', async () => {
    await render(
      <PaletteHarness commands={commands()} onAnnounce={() => {}} />,
    );

    await fill(input(), 'New note');
    await pressKey(input(), 'Enter');

    expect(RUN).toEqual(['createNote']);
  });

  it('does not run a command while the text is composed', async () => {
    await render(
      <PaletteHarness commands={commands()} onAnnounce={() => {}} />,
    );

    await fill(input(), 'New note');
    await pressKey(input(), 'Enter', { isComposing: true });

    expect(RUN).toEqual([]);
  });

  it('does not run a command that cannot run', async () => {
    await render(
      <PaletteHarness commands={commands()} onAnnounce={() => {}} />,
    );

    await fill(input(), 'Rename note');
    await pressKey(input(), 'Enter');

    expect(RUN).toEqual([]);
  });

  it('says that nothing matches the query', async () => {
    await render(
      <PaletteHarness commands={commands()} onAnnounce={() => {}} />,
    );

    await fill(input(), 'zzz absent');

    expect(options()).toHaveLength(0);
    expect(dialog().querySelector('.palette__empty')?.textContent).toContain('zzz absent');
  });

  it('closes with Escape', async () => {
    let closed = false;
    await render(
      <PaletteHarness
        commands={commands()}
        onClose={() => {
          closed = true;
        }}
        onAnnounce={() => {}}
      />,
    );

    await pressKey(input(), 'Escape');

    expect(closed).toBe(true);
    expect(dialog().hasAttribute('open')).toBe(false);
  });
});
