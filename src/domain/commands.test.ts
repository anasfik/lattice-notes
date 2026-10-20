import { describe, expect, it } from 'vitest';

import { buildCommands } from './commands';
import type { CommandAction, CommandAvailability, CommandHandlers } from './commands';

/** A catalog with every action available. */
function available(): CommandAvailability {
  return {
    hasActiveNote: true,
    canUndo: true,
    openTabCount: 2,
    contextPanelToggleable: true,
  };
}

/** Handlers that record what the catalog runs. */
function handlers(): CommandHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    createNote: () => calls.push('createNote'),
    renameNote: () => calls.push('renameNote'),
    trashNote: () => calls.push('trashNote'),
    undo: () => calls.push('undo'),
    importMarkdown: () => calls.push('importMarkdown'),
    exportVault: () => calls.push('exportVault'),
    setViewMode: (mode) => calls.push(`setViewMode:${mode}`),
    openSwitcher: () => calls.push('openSwitcher'),
    focusSearch: () => calls.push('focusSearch'),
    openVaultManager: () => calls.push('openVaultManager'),
    toggleContextPanel: () => calls.push('toggleContextPanel'),
    closeTab: () => calls.push('closeTab'),
    nextTab: () => calls.push('nextTab'),
    previousTab: () => calls.push('previousTab'),
  };
}

/** The command with the given id. */
function command(catalog: CommandAction[], id: string): CommandAction {
  const found = catalog.find((entry) => entry.id === id);
  if (!found) throw new Error(`no command with the id "${id}"`);
  return found;
}

describe('command catalog', () => {
  it('lists every action that really exists', () => {
    const catalog = buildCommands(available(), handlers());

    expect(catalog.map((entry) => entry.id).sort()).toEqual([
      'files.export',
      'files.import',
      'note.new',
      'note.rename',
      'note.switch',
      'note.trash',
      'note.undo',
      'search.workspace',
      'tab.close',
      'tab.next',
      'tab.previous',
      'vault.manager',
      'view.context',
      'view.read',
      'view.split',
      'view.write',
    ]);
  });

  it('gives every command a label and a category', () => {
    const catalog = buildCommands(available(), handlers());

    for (const entry of catalog) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.category.length).toBeGreaterThan(0);
    }
  });

  it('names the shortcut of the commands that have one', () => {
    const catalog = buildCommands(available(), handlers());

    expect(command(catalog, 'note.new').shortcut).toBe('Ctrl/Cmd+N');
    expect(command(catalog, 'note.switch').shortcut).toBe('Ctrl/Cmd+P');
    expect(command(catalog, 'files.import').shortcut).toBeUndefined();
  });

  it('explains why a note dependent command is not available', () => {
    const catalog = buildCommands(
      { ...available(), hasActiveNote: false, canUndo: false, openTabCount: 0 },
      handlers(),
    );

    expect(command(catalog, 'note.rename').disabledReason).toBe('Open a note first');
    expect(command(catalog, 'note.trash').disabledReason).toBe('Open a note first');
    expect(command(catalog, 'note.undo').disabledReason).toBe('Nothing to undo');
    expect(command(catalog, 'tab.close').disabledReason).toBe('No note is open');
    expect(command(catalog, 'tab.next').disabledReason).toBe('Only one note is open');
  });

  it('does not run a command that is not available', () => {
    const spies = handlers();
    const catalog = buildCommands({ ...available(), hasActiveNote: false }, spies);

    expect(() => command(catalog, 'note.rename').run()).not.toThrow();
    expect(spies.calls).toEqual([]);
  });

  it('runs the handler of an available command', () => {
    const spies = handlers();
    const catalog = buildCommands(available(), spies);

    command(catalog, 'note.new').run();
    command(catalog, 'view.read').run();
    command(catalog, 'note.switch').run();

    expect(spies.calls).toEqual(['createNote', 'setViewMode:read', 'openSwitcher']);
  });

  it('does not run the panel toggle on a wide screen', () => {
    const spies = handlers();
    const catalog = buildCommands({ ...available(), contextPanelToggleable: false }, spies);

    expect(command(catalog, 'view.context').disabledReason).toBeTruthy();
    command(catalog, 'view.context').run();
    expect(spies.calls).toEqual([]);
  });
});
