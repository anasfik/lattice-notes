import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GraphView from './GraphView';
import { createEmptyVault, createNote } from '../domain/vault';
import type { Vault } from '../domain/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom ships the dialog element without the modal behaviour, so the harness
 * stands in for the platform. The stand-in does not move the focus: the
 * component is responsible for that, and the test checks it.
 */
const dialogProto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
if (typeof dialogProto.showModal !== 'function') {
  dialogProto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialogProto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

let container: HTMLDivElement;
let root: Root;

/** A vault of `count` notes that link in a ring. */
function ringVault(count: number): Vault {
  let vault = createEmptyVault();
  for (let index = 0; index < count; index += 1) {
    const name = `note-${String(index).padStart(3, '0')}`;
    const next = `note-${String((index + 1) % count).padStart(3, '0')}`;
    const created = createNote(vault, name, `Next is [[${next}]].`);
    vault = created.vault;
  }
  return vault;
}

function dialog(): HTMLDialogElement {
  const found = container.querySelector<HTMLDialogElement>('dialog.graphview');
  if (!found) throw new Error('no graph dialog');
  return found;
}

function surface(): SVGSVGElement {
  const found = container.querySelector<SVGSVGElement>('.graphview__canvas');
  if (!found) throw new Error('no graph surface');
  return found;
}

function search(): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('.graphview__search');
  if (!found) throw new Error('no search field');
  return found;
}

function listButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.graphview__list button'));
}

function byLabel(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`no button named "${label}"`);
  return found;
}

function text(selector: string): string {
  return container.querySelector(selector)?.textContent?.trim() ?? '';
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

async function fill(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** A pointer event of the graph surface. */
async function pointer(type: string, target: Element, x: number, y: number): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  });
}

/** Renders the graph with the given vault. */
async function render(
  vault: Vault,
  overrides: Partial<{
    open: boolean;
    onOpenNote: (id: string) => void;
    onClose: () => void;
    onAnnounce: (message: string) => void;
  }> = {},
): Promise<void> {
  await act(async () => {
    root.render(
      <GraphView
        open={overrides.open ?? true}
        vault={vault}
        onOpenNote={overrides.onOpenNote ?? (() => {})}
        onClose={overrides.onClose ?? (() => {})}
        onAnnounce={overrides.onAnnounce ?? (() => {})}
      />,
    );
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
  vi.unstubAllGlobals();
});

describe('the fullscreen graph', () => {
  it('does not read note bodies until it opens, including edits made while closed', async () => {
    const original = ringVault(3);
    let reads = 0;
    const vault = {
      ...original,
      notes: original.notes.map((note) => ({
        ...note,
        get body() { reads += 1; return note.body; },
      })),
    };
    await render(vault, { open: false });
    await render({ ...vault, notes: [...vault.notes] }, { open: false });
    expect(reads).toBe(0);
    await render(vault);
    expect(reads).toBeGreaterThan(0);
    expect(text('.graphview__counts')).toBe('Drawing 3 of 3 notes');
  });

  it('fits the current vault each time it opens', async () => {
    const vault = ringVault(20);
    await render(vault, { open: false });
    await render(vault);
    const fitted = surface().getAttribute('data-camera-zoom');
    await pressKey(surface(), '+');
    expect(surface().getAttribute('data-camera-zoom')).not.toBe(fitted);
    await render(vault, { open: false });
    await render(vault);
    expect(surface().getAttribute('data-camera-zoom')).toBe(fitted);
  });

  it('does not release a pointer that is no longer captured', async () => {
    await render(ringVault(2));
    const release = vi.fn();
    Object.defineProperty(surface(), 'releasePointerCapture', { value: release });
    Object.defineProperty(surface(), 'hasPointerCapture', { value: () => false });
    await pointer('pointercancel', surface(), 100, 100);
    await pointer('pointerup', surface(), 100, 100);
    expect(release).not.toHaveBeenCalled();
  });

  it('opens as a modal dialog of the app', async () => {
    await render(ringVault(12));

    expect(dialog().hasAttribute('open')).toBe(true);
    expect(dialog().getAttribute('aria-modal')).toBe('true');
  });

  it('says how many notes are drawn and how many are not', async () => {
    await render(ringVault(400));

    expect(text('.graphview__counts')).toBe('Drawing 300 of 400 notes');
    expect(text('.graphview__omitted')).toBe('100 notes not drawn');
  });

  it('reaches a note that is not drawn through the list', async () => {
    await render(ringVault(400));

    for (let index = 0; index < 7; index += 1) {
      await click(byLabel('Next page'));
    }
    expect(text('.graphview__page')).toBe('Page 8 of 8');

    const item = listButtons().find((button) => button.textContent?.trim() === 'note-350');
    if (!item) throw new Error('the note of the last page is missing');
    const id = item.getAttribute('data-note-id');
    expect(surface().querySelector(`[data-node-id="${id}"]`)).toBeNull();

    await click(item);

    expect(surface().querySelector(`[data-node-id="${id}"]`)).not.toBeNull();
    expect(item.getAttribute('aria-pressed')).toBe('true');
  });

  it('narrows the list with the search field', async () => {
    await render(ringVault(400));

    await fill(search(), 'note-35');

    const names = listButtons().map((button) => button.textContent?.trim());
    expect(names).toHaveLength(10);
    expect(names.every((name) => name?.includes('note-35'))).toBe(true);
  });

  it('opens the selected note and closes', async () => {
    const opened: string[] = [];
    let closed = 0;
    await render(ringVault(20), {
      onOpenNote: (id) => opened.push(id),
      onClose: () => {
        closed += 1;
      },
    });

    await click(listButtons()[0] as HTMLButtonElement);
    await click(container.querySelector<HTMLButtonElement>('.graphview__open') as HTMLButtonElement);

    expect(opened).toHaveLength(1);
    expect(closed).toBe(1);
  });

  it('selects a note with a click and not with a drag', async () => {
    await render(ringVault(20));

    const node = surface().querySelector('[data-node-id]');
    if (!node) throw new Error('no node in the picture');

    await pointer('pointerdown', node, 100, 100);
    await pointer('pointermove', surface(), 260, 100);
    await pointer('pointerup', surface(), 260, 100);

    expect(container.querySelector('.graphview__detail')).toBeNull();

    await pointer('pointerdown', node, 100, 100);
    await pointer('pointerup', surface(), 100, 100);

    expect(container.querySelector('.graphview__detail')).not.toBeNull();
  });

  it('ends the gesture when the pointer is cancelled', async () => {
    await render(ringVault(20));

    const node = surface().querySelector('[data-node-id]');
    if (!node) throw new Error('no node in the picture');

    await pointer('pointerdown', node, 100, 100);
    await pointer('pointercancel', surface(), 100, 100);
    await pointer('pointerup', surface(), 100, 100);

    expect(container.querySelector('.graphview__detail')).toBeNull();
  });
});

describe('the keyboard of the graph', () => {
  it('moves the camera from the surface only', async () => {
    await render(ringVault(20));
    const before = surface().getAttribute('data-camera-yaw');

    await pressKey(surface(), 'ArrowRight');
    expect(surface().getAttribute('data-camera-yaw')).not.toBe(before);

    const after = surface().getAttribute('data-camera-yaw');
    await pressKey(search(), 'ArrowRight');
    expect(surface().getAttribute('data-camera-yaw')).toBe(after);
  });

  it('zooms, resets and fits from the surface', async () => {
    await render(ringVault(20));
    const before = Number(surface().getAttribute('data-camera-zoom'));

    await pressKey(surface(), '+');
    const zoomed = Number(surface().getAttribute('data-camera-zoom'));
    expect(zoomed).toBeGreaterThan(before);

    await pressKey(surface(), '-');
    expect(Number(surface().getAttribute('data-camera-zoom'))).toBeLessThan(zoomed);

    await pressKey(surface(), '0');
    expect(Number(surface().getAttribute('data-camera-zoom'))).toBe(1);

    await pressKey(surface(), 'f');
    expect(Number(surface().getAttribute('data-camera-zoom'))).toBeGreaterThan(0);
  });

  it('closes with Escape from the surface', async () => {
    let closed = 0;
    await render(ringVault(20), {
      onClose: () => {
        closed += 1;
      },
    });

    await pressKey(surface(), 'Escape');

    expect(closed).toBe(1);
  });

  it('closes with Escape even when the search field has focus', async () => {
    let closed = 0;
    await render(ringVault(20), {
      onClose: () => {
        closed += 1;
      },
    });

    await fill(search(), 'note-0');
    await pressKey(search(), 'Escape');

    expect(closed).toBe(1);
  });

  it('gives the keyboard back to the trigger when it closes', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const vault = ringVault(20);

    await render(vault);

    await click(byLabel('Close the graph'));
    await render(vault, { open: false });

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe('the frames of the graph', () => {
  /** A frame counter that never runs the frames on its own. */
  function fakeFrames(): { requests: number; cancels: number } {
    const counter = { requests: 0, cancels: 0 };
    vi.stubGlobal('requestAnimationFrame', () => {
      counter.requests += 1;
      return counter.requests;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      counter.cancels += 1;
    });
    return counter;
  }

  it('asks for one frame at a time and none while it is closed', async () => {
    const frames = fakeFrames();

    await render(ringVault(20));
    expect(frames.requests).toBe(0);

    await pressKey(surface(), 'ArrowRight');
    expect(frames.requests).toBe(1);

    await pressKey(surface(), 'ArrowRight');
    expect(frames.requests).toBe(1);
  });

  it('cancels the pending frame when it closes and when it goes away', async () => {
    const frames = fakeFrames();

    await render(ringVault(20));
    await pressKey(surface(), 'ArrowRight');
    expect(frames.requests).toBe(1);

    await render(ringVault(20), { open: false });
    expect(frames.cancels).toBe(1);

    await render(ringVault(20));
    await pressKey(surface(), 'ArrowRight');
    await act(async () => {
      root.unmount();
    });
    expect(frames.cancels).toBe(2);
  });

  it('moves the camera at once when the motion is reduced', async () => {
    const frames = fakeFrames();
    const media = { matches: true, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
    vi.stubGlobal('matchMedia', () => media);

    await render(ringVault(20));
    await pressKey(surface(), 'ArrowRight');

    expect(frames.requests).toBe(0);
    expect(Number(surface().getAttribute('data-camera-yaw'))).toBeGreaterThan(0);
  });
});
