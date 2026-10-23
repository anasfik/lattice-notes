import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import SettingsDialog from './SettingsDialog';
import { DEFAULT_SETTINGS } from '../domain/settings';
import type { AppSettings } from '../domain/settings';

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

/** The settings that were applied, in the order they were applied. */
const APPLIED: AppSettings[] = [];

/** The dialog inside a parent that opens it and closes it again. */
function SettingsHarness(props: { onClose?: () => void; onApply?: (settings: AppSettings) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <SettingsDialog
        open={open}
        settings={DEFAULT_SETTINGS}
        onClose={() => {
          props.onClose?.();
          setOpen(false);
        }}
        onApply={(settings) => {
          APPLIED.push(settings);
          props.onApply?.(settings);
          setOpen(false);
        }}
      />
    </>
  );
}

function dialog(): HTMLDialogElement {
  const found = container.querySelector<HTMLDialogElement>('dialog.settings');
  if (!found) throw new Error('no settings dialog');
  return found;
}

function control<T extends HTMLElement>(selector: string): T {
  const found = dialog().querySelector<T>(selector);
  if (!found) throw new Error(`no control matching "${selector}"`);
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

async function change(element: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const prototype =
      element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Ticks a box, the way a reader does. */
async function tick(element: HTMLInputElement): Promise<void> {
  await act(async () => {
    element.click();
  });
}

/** Submits the form of the dialog, without the check of the browser. */
async function submit(): Promise<void> {
  await act(async () => {
    const form = dialog().querySelector('form');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function pressKey(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/** The name a reader hears for a control. */
function accessibleName(element: Element): string {
  const label = element.getAttribute('aria-label');
  if (label) return label.trim();
  const id = element.getAttribute('id');
  if (id) {
    const text = dialog().querySelector(`label[for="${id}"]`)?.textContent ?? '';
    if (text.trim()) return text.trim();
  }
  const wrapping = element.closest('label')?.textContent ?? '';
  if (wrapping.trim()) return wrapping.trim();
  return (element.textContent ?? '').trim();
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  APPLIED.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('the settings dialog', () => {
  it('opens from the app menu and closes with Escape', async () => {
    let closed = false;
    await render(<SettingsHarness onClose={() => { closed = true; }} />);
    const trigger = container.querySelector<HTMLButtonElement>('button');
    trigger?.focus();

    await click(trigger as Element);
    expect(dialog().hasAttribute('open')).toBe(true);

    await pressKey(dialog(), 'Escape');

    expect(closed).toBe(true);
    expect(dialog().hasAttribute('open')).toBe(false);
    // The keyboard goes back to the control that opened the dialog.
    expect(document.activeElement).toBe(trigger);
  });

  it('gives every control an accessible name', async () => {
    await render(<SettingsHarness />);
    await click(container.querySelector('button') as Element);

    const controls = Array.from(
      dialog().querySelectorAll<HTMLElement>('input, select, button'),
    );
    expect(controls.length).toBeGreaterThan(4);
    for (const element of controls) {
      expect(accessibleName(element), element.outerHTML).not.toBe('');
    }
  });

  it('writes the settings and announces the change', async () => {
    await render(<SettingsHarness />);
    await click(container.querySelector('button') as Element);

    await tick(control<HTMLInputElement>('input[type="checkbox"]'));
    const numbers = Array.from(dialog().querySelectorAll<HTMLInputElement>('input[type="number"]'));
    await change(numbers[0] as HTMLInputElement, '15');

    await click(button('Save settings'));

    expect(APPLIED).toHaveLength(1);
    expect(APPLIED[0]?.confirmDelete).toBe(true);
    expect(APPLIED[0]?.snapshotIntervalMinutes).toBe(15);
    expect(dialog().hasAttribute('open')).toBe(false);
  });

  it('keeps the theme, the spell check and the retention of the settings', async () => {
    await render(<SettingsHarness />);
    await click(container.querySelector('button') as Element);

    const select = control<HTMLSelectElement>('select');
    await change(select, 'dark');
    const boxes = Array.from(dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    await tick(boxes[1] as HTMLInputElement);

    await click(button('Save settings'));

    expect(APPLIED[0]?.theme).toBe('dark');
    expect(APPLIED[0]?.spellcheck).toBe(false);
    expect(APPLIED[0]?.snapshotRetentionDays).toBe(DEFAULT_SETTINGS.snapshotRetentionDays);
  });

  it('clamps the interval and the retention when they are written', async () => {
    await render(<SettingsHarness />);
    await click(container.querySelector('button') as Element);

    const numbers = Array.from(dialog().querySelectorAll<HTMLInputElement>('input[type="number"]'));
    await change(numbers[0] as HTMLInputElement, '900');
    await change(numbers[1] as HTMLInputElement, '0');

    await submit();

    expect(APPLIED[0]?.snapshotIntervalMinutes).toBe(60);
    expect(APPLIED[0]?.snapshotRetentionDays).toBe(1);
  });

  it('keeps the stored interval when a field is cleared', async () => {
    await render(<SettingsHarness />);
    await click(container.querySelector('button') as Element);

    const numbers = Array.from(dialog().querySelectorAll<HTMLInputElement>('input[type="number"]'));
    await change(numbers[0] as HTMLInputElement, '');

    await submit();

    expect(APPLIED[0]?.snapshotIntervalMinutes).toBe(DEFAULT_SETTINGS.snapshotIntervalMinutes);
  });

  it('states the daily note format instead of offering a control for it', async () => {
    await render(<SettingsHarness />);
    await click(container.querySelector('button') as Element);

    const text = dialog().textContent ?? '';
    expect(text).toContain('YYYY-MM-DD');
    const named = Array.from(dialog().querySelectorAll<HTMLInputElement>('input')).map((input) =>
      accessibleName(input).toLowerCase(),
    );
    expect(named.some((name) => name.includes('daily'))).toBe(false);
  });

  it('writes nothing when the dialog is cancelled', async () => {
    await render(<SettingsHarness />);
    await click(container.querySelector('button') as Element);

    await tick(control<HTMLInputElement>('input[type="checkbox"]'));
    await click(button('Cancel'));

    expect(APPLIED).toHaveLength(0);
  });
});
