/**
 * The one catalog of the actions of the app.
 *
 * The toolbar, the keyboard shortcuts and the command palette all read this
 * list, so a label, a shortcut or a handler can never drift between them. A
 * command that cannot run right now keeps its place in the list and says why
 * it is not available, instead of disappearing.
 */

/** The ways a note can be shown next to the explorer. */
export type ViewMode = 'write' | 'split' | 'read';

export interface CommandAction {
  /** A stable id, so a shortcut and a test can name the command. */
  id: string;
  /** What the reader sees. */
  label: string;
  /** The group the command belongs to. */
  category: string;
  /** The keys that run the command, when it has one. */
  shortcut?: string;
  /** Why the command cannot run right now. */
  disabledReason?: string;
  /** Does the work. Never runs while the command is not available. */
  run(): void;
}

/** What the app can do right now. */
export interface CommandAvailability {
  /** True when a note is on the screen. */
  hasActiveNote: boolean;
  /** True when there is something to undo. */
  canUndo: boolean;
  /** The number of open notes. */
  openTabCount: number;
  /** True when the context panel can be folded away, so on a narrow screen. */
  contextPanelToggleable: boolean;
}

/** The real handlers of the commands. */
export interface CommandHandlers {
  createNote(): void;
  renameNote(): void;
  trashNote(): void;
  undo(): void;
  importMarkdown(): void;
  exportVault(): void;
  setViewMode(mode: ViewMode): void;
  openSwitcher(): void;
  focusSearch(): void;
  openVaultManager(): void;
  toggleContextPanel(): void;
  closeTab(): void;
  nextTab(): void;
  previousTab(): void;
}

/**
 * Builds the catalog of the app.
 *
 * Every command names its own handler, so a command without a handler cannot
 * appear. A command that is not available keeps a reason and does nothing
 * when it is run, so a shortcut behind a disabled command cannot throw.
 */
export function buildCommands(
  availability: CommandAvailability,
  handlers: CommandHandlers,
): CommandAction[] {
  const commands: CommandAction[] = [
    {
      id: 'note.new',
      label: 'New note',
      category: 'Note',
      shortcut: 'Ctrl/Cmd+N',
      run: handlers.createNote,
    },
    {
      id: 'note.rename',
      label: 'Rename note',
      category: 'Note',
      disabledReason: availability.hasActiveNote ? undefined : 'Open a note first',
      run: handlers.renameNote,
    },
    {
      id: 'note.trash',
      label: 'Move note to trash',
      category: 'Note',
      disabledReason: availability.hasActiveNote ? undefined : 'Open a note first',
      run: handlers.trashNote,
    },
    {
      id: 'note.undo',
      label: 'Undo delete',
      category: 'Note',
      disabledReason: availability.canUndo ? undefined : 'Nothing to undo',
      run: handlers.undo,
    },
    {
      id: 'note.switch',
      label: 'Quick switcher',
      category: 'Note',
      shortcut: 'Ctrl/Cmd+P',
      run: handlers.openSwitcher,
    },
    {
      id: 'files.import',
      label: 'Import Markdown',
      category: 'Files',
      run: handlers.importMarkdown,
    },
    {
      id: 'files.export',
      label: 'Export vault',
      category: 'Files',
      run: handlers.exportVault,
    },
    {
      id: 'search.workspace',
      label: 'Search workspace',
      category: 'Search',
      run: handlers.focusSearch,
    },
    {
      id: 'view.write',
      label: 'Write mode',
      category: 'View',
      run: () => handlers.setViewMode('write'),
    },
    {
      id: 'view.split',
      label: 'Split mode',
      category: 'View',
      run: () => handlers.setViewMode('split'),
    },
    {
      id: 'view.read',
      label: 'Read mode',
      category: 'View',
      run: () => handlers.setViewMode('read'),
    },
    {
      id: 'view.context',
      label: 'Toggle context panel',
      category: 'View',
      disabledReason: availability.contextPanelToggleable
        ? undefined
        : 'The context panel is always open on a wide screen',
      run: handlers.toggleContextPanel,
    },
    {
      id: 'vault.manager',
      label: 'Vault manager',
      category: 'Vaults',
      run: handlers.openVaultManager,
    },
    {
      id: 'tab.close',
      label: 'Close note tab',
      category: 'Tabs',
      disabledReason: availability.openTabCount > 0 ? undefined : 'No note is open',
      run: handlers.closeTab,
    },
    {
      id: 'tab.next',
      label: 'Next note tab',
      category: 'Tabs',
      disabledReason: availability.openTabCount > 1 ? undefined : 'Only one note is open',
      run: handlers.nextTab,
    },
    {
      id: 'tab.previous',
      label: 'Previous note tab',
      category: 'Tabs',
      disabledReason: availability.openTabCount > 1 ? undefined : 'Only one note is open',
      run: handlers.previousTab,
    },
  ];

  // A command that cannot run does nothing when it is run, so a shortcut or a
  // click behind a disabled command can never throw.
  return commands.map((command) =>
    command.disabledReason ? { ...command, run: () => {} } : command,
  );
}
