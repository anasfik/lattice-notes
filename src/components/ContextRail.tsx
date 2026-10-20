import { toPlainText } from '../domain/markdown';
import type { Note } from '../domain/types';

export interface ContextRailProps {
  note: Note | null;
}

/** Metadata about the active note. Backlinks and the graph arrive in task 3. */
export default function ContextRail({ note }: ContextRailProps) {
  return (
    <div className="context">
      <h2 className="context__title">Context</h2>
      {note ? (
        <dl className="context__meta">
          <dt>Name</dt>
          <dd>{note.name}</dd>
          <dt>Words</dt>
          <dd>{wordCount(note.body)}</dd>
          <dt>Created</dt>
          <dd>{formatTimestamp(note.createdAt)}</dd>
          <dt>Updated</dt>
          <dd>{formatTimestamp(note.updatedAt)}</dd>
        </dl>
      ) : (
        <p className="context__empty">Select a note to see its details.</p>
      )}
    </div>
  );
}

function wordCount(body: string): number {
  const text = toPlainText(body).trim();
  return text ? text.split(/\s+/).length : 0;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
