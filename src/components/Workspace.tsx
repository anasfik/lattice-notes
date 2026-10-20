import type { ChangeEvent, ReactNode, RefObject } from 'react';

import { activeNotes } from '../domain/vault';
import type { LocalGraph } from '../domain/vault';
import type { Vault } from '../domain/types';
import ContextRail from './ContextRail';
import Editor from './Editor';
import Explorer from './Explorer';
import type { FocusTarget } from './Explorer';
import Preview from './Preview';
import Search from './Search';

export interface WorkspaceProps {
  vault: Vault;
  status: string;
  error: string | null;
  canUndo: boolean;
  focusNote: FocusTarget | null;
  graph: LocalGraph | null;
  noteNames: ReadonlySet<string>;
  /** True while the graph still trails the vault. */
  graphPending?: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  editorRef?: RefObject<HTMLTextAreaElement | null>;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  paletteTrigger?: ReactNode;
  onRetry(): void;
  onSelect(id: string): void;
  /** Opens a note from a control the navigation replaces. */
  onNavigate(id: string): void;
  onCreate(): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onRestore(id: string): void;
  onChange(body: string): void;
  onUndo(): void;
  onWikiLink(target: string): void;
  onAnnounce(message: string): void;
  onImport(): void;
  onExport(): void;
  onImportFiles(event: ChangeEvent<HTMLInputElement>): void;
}

/**
 * The three pane shell: activity rail, explorer, editor with preview, and the
 * context rail. It owns the single polite live region and the persistent
 * storage warning; the app owns the data.
 *
 * The document order is rail, editor, context, notes, so the compact layout
 * reads from top to bottom and the keyboard never travels backwards. The
 * desktop places the notes list on the left with the grid areas.
 */
export default function Workspace(props: WorkspaceProps) {
  const notes = activeNotes(props.vault);
  const trashed = props.vault.notes.filter((note) => note.deletedAt !== null);
  const active = notes.find((note) => note.id === props.vault.activeNoteId) ?? null;

  return (
    <div className="workspace">
      <nav className="workspace__rail" aria-label="Workspace">
        <h1 className="workspace__mark" aria-label="Lattice Notes">
          LN
        </h1>
        <button
          type="button"
          className="workspace__rail-action"
          aria-label="New note"
          onClick={props.onCreate}
        >
          New
        </button>
        <button
          type="button"
          className="workspace__rail-action"
          aria-label="Import Markdown"
          title="Import Markdown"
          onClick={props.onImport}
        >
          Import
        </button>
        <button
          type="button"
          className="workspace__rail-action"
          aria-label="Export vault"
          title="Export vault"
          onClick={props.onExport}
        >
          Export
        </button>
        <input
          ref={props.fileInputRef}
          type="file"
          multiple
          accept=".md,.markdown,.txt,.json"
          className="workspace__file-input"
          onChange={props.onImportFiles}
        />
      </nav>

      <main className="workspace__main" aria-label="Note workspace">
        <div className="workspace__statusbar">
          <p className="workspace__status" role="status">
            {props.status}
          </p>
          {props.canUndo ? (
            <button type="button" className="workspace__undo" onClick={props.onUndo}>
              Undo delete
            </button>
          ) : null}
        </div>

        {props.error ? (
          <div className="workspace__warning" role="alert">
            <p className="workspace__warning-text">{props.error}</p>
            <button type="button" className="workspace__warning-action" onClick={props.onRetry}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="workspace__panes">
          <Editor note={active} textareaRef={props.editorRef} onChange={props.onChange} />
          <Preview
            body={active?.body ?? ''}
            onWikiLink={props.onWikiLink}
            existingNames={props.noteNames}
          />
        </div>
      </main>

      <aside className="workspace__explorer" aria-label="Notes">
        <Explorer
          notes={notes}
          trashed={trashed}
          activeNoteId={props.vault.activeNoteId}
          focusNote={props.focusNote}
          onSelect={props.onSelect}
          onCreate={props.onCreate}
          onRename={props.onRename}
          onDelete={props.onDelete}
          onRestore={props.onRestore}
          tools={
            <Search
              vault={props.vault}
              onSelect={props.onSelect}
              onAnnounce={props.onAnnounce}
              inputRef={props.searchInputRef}
              action={props.paletteTrigger}
            />
          }
        />
      </aside>

      <aside className="workspace__context" aria-label="Context">
        <ContextRail
          note={active}
          graph={props.graph}
          noteNames={props.noteNames}
          graphPending={props.graphPending}
          onSelect={props.onSelect}
          onNavigate={props.onNavigate}
          onWikiLink={props.onWikiLink}
        />
      </aside>
    </div>
  );
}
