import { activeNotes } from '../domain/vault';
import type { Vault } from '../domain/types';
import ContextRail from './ContextRail';
import Editor from './Editor';
import Explorer from './Explorer';
import Preview from './Preview';

export interface WorkspaceProps {
  vault: Vault;
  status: string;
  error: string | null;
  canUndo: boolean;
  focusNote: { id: string } | null;
  onRetry(): void;
  onSelect(id: string): void;
  onCreate(): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onRestore(id: string): void;
  onChange(body: string): void;
  onUndo(): void;
  onWikiLink(target: string): void;
}

/**
 * The three pane shell: activity rail, explorer, editor with preview, and the
 * context rail. It owns the single polite live region and the persistent
 * storage warning; the app owns the data.
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
      </nav>

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
        />
      </aside>

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
          <Editor note={active} onChange={props.onChange} />
          <Preview body={active?.body ?? ''} onWikiLink={props.onWikiLink} />
        </div>
      </main>

      <aside className="workspace__context" aria-label="Context">
        <ContextRail note={active} />
      </aside>
    </div>
  );
}
