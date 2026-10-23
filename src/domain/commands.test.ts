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
    canGoBack: true,
    canGoForward: true,
  };
}

/** Handlers that record what the catalog runs. */
function handlers(): CommandHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    createNote: () => calls.push('createNote'),
    createFolder: () => calls.push('createFolder'),
    renameNote: () => calls.push('renameNote'),
    trashNote: () => calls.push('trashNote'),
    undo: () => calls.push('undo'),
    importMarkdown: () => calls.push('importMarkdown'),
    exportVault: () => calls.push('exportVault'),
    setViewMode: (mode) => calls.push(`setViewMode:${mode}`),
    openSwitcher: () => calls.push('openSwitcher'),
    openPalette: () => calls.push('openPalette'),
    openShortcutHelp: () => calls.push('openShortcutHelp'),
    focusSearch: () => calls.push('focusSearch'),
    openVaultManager: () => calls.push('openVaultManager'),
    toggleContextPanel: () => calls.push('toggleContextPanel'),
    closeTab: () => calls.push('closeTab'),
    nextTab: () => calls.push('nextTab'),
    previousTab: () => calls.push('previousTab'),
    openDailyNote: () => calls.push('openDailyNote'),
    openCalendar: () => calls.push('openCalendar'),
    openGraph: () => calls.push('openGraph'),
    openSettings: () => calls.push('openSettings'),
    openRecovery: () => calls.push('openRecovery'),
    deletePermanent: () => calls.push('deletePermanent'),
    goBack: () => calls.push('goBack'),
    goForward: () => calls.push('goForward'),
    toggleBookmark: () => calls.push('toggleBookmark'),
    toggleOutline: () => calls.push('toggleOutline'),
    toggleBookmarksPanel: () => calls.push('toggleBookmarksPanel'),
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
      'bookmarks.panel',
      'command.palette',
      'files.export',
      'files.import',
      'folder.new',
      'help.shortcuts',
      'history.back',
      'history.forward',
      'note.bookmark',
      'note.daily',
      'note.deletePermanent',
      'note.new',
      'note.recover',
      'note.rename',
      'note.switch',
      'note.trash',
      'note.undo',
      'search.workspace',
      'settings.open',
      'tab.close',
      'tab.next',
      'tab.previous',
      'vault.manager',
      'view.calendar',
      'view.context',
      'view.graph',
      'view.outline',
      'view.read',
      'view.split',
      'view.write',
    ]);
  });

  it('the catalog contains history.back, history.forward, note.bookmark and view.outline', () => {
    const catalog = buildCommands(available(), handlers());

    expect(command(catalog, 'history.back')).toBeDefined();
    expect(command(catalog, 'history.forward')).toBeDefined();
    expect(command(catalog, 'note.bookmark')).toBeDefined();
    expect(command(catalog, 'view.outline')).toBeDefined();
    expect(command(catalog, 'bookmarks.panel')).toBeDefined();
  });

  it('runs the handlers of the history, the bookmark and the panels', () => {
    const spies = handlers();
    const catalog = buildCommands(available(), spies);

    command(catalog, 'history.back').run();
    command(catalog, 'history.forward').run();
    command(catalog, 'note.bookmark').run();
    command(catalog, 'view.outline').run();
    command(catalog, 'bookmarks.panel').run();

    expect(spies.calls).toEqual([
      'goBack',
      'goForward',
      'toggleBookmark',
      'toggleOutline',
      'toggleBookmarksPanel',
    ]);
  });

  it('says when there is nowhere to go in the history', () => {
    const catalog = buildCommands(
      { ...available(), canGoBack: false, canGoForward: false },
      handlers(),
    );

    expect(command(catalog, 'history.back').disabledReason).toBe('There is nothing to go back to');
    expect(command(catalog, 'history.forward').disabledReason).toBe(
      'There is nothing to go forward to',
    );
  });

  it('keeps the settings open without a note', () => {
    const catalog = buildCommands(
      { ...available(), hasActiveNote: false, canUndo: false, openTabCount: 0 },
      handlers(),
    );

    expect(command(catalog, 'settings.open').disabledReason).toBeUndefined();
    expect(command(catalog, 'note.recover').disabledReason).toBe('Open a note first');
    expect(command(catalog, 'note.deletePermanent').disabledReason).toBe('Open a note first');
  });

  it('runs the handlers of the settings, the recovery and the permanent delete', () => {
    const spies = handlers();
    const catalog = buildCommands(available(), spies);

    command(catalog, 'settings.open').run();
    command(catalog, 'note.recover').run();
    command(catalog, 'note.deletePermanent').run();

    expect(spies.calls).toEqual(['openSettings', 'openRecovery', 'deletePermanent']);
  });

  it('keeps the graph available without a note', () => {
    const catalog = buildCommands(
      { ...available(), hasActiveNote: false, canUndo: false, openTabCount: 0 },
      handlers(),
    );

    expect(command(catalog, 'view.graph').disabledReason).toBeUndefined();
  });

  it('keeps the daily note and the calendar available without a note', () => {
    const catalog = buildCommands(
      { ...available(), hasActiveNote: false, canUndo: false, openTabCount: 0 },
      handlers(),
    );

    expect(command(catalog, 'note.daily').disabledReason).toBeUndefined();
    expect(command(catalog, 'view.calendar').disabledReason).toBeUndefined();
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
    expect(command(catalog, 'command.palette').shortcut).toBe('Ctrl/Cmd+K');
    expect(command(catalog, 'note.rename').shortcut).toBe('F2');
    expect(command(catalog, 'note.daily').shortcut).toBe('Alt+T');
    expect(command(catalog, 'view.calendar').shortcut).toBe('Alt+C');
    expect(command(catalog, 'view.graph').shortcut).toBe('Alt+G');
    expect(command(catalog, 'help.shortcuts').shortcut).toBe('?');
    expect(command(catalog, 'files.import').shortcut).toBeUndefined();
  });

  it('keeps the folders and the help in the catalog of the app', () => {
    const catalog = buildCommands(available(), handlers());

    expect(command(catalog, 'folder.new').category).toBe('Folders');
    expect(command(catalog, 'help.shortcuts').category).toBe('Help');
    expect(command(catalog, 'command.palette').category).toBe('Commands');
  });

  it('runs the handler of every command that has one', () => {
    const spies = handlers();
    const catalog = buildCommands(available(), spies);

    command(catalog, 'folder.new').run();
    command(catalog, 'command.palette').run();
    command(catalog, 'help.shortcuts').run();

    expect(spies.calls).toEqual(['createFolder', 'openPalette', 'openShortcutHelp']);
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
