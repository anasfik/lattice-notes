import type { Note } from '../domain/types';

export interface EditorProps {
  note: Note | null;
  onChange(body: string): void;
}

/** The Markdown editor. The label stays visible so the field is never unnamed. */
export default function Editor({ note, onChange }: EditorProps) {
  return (
    <section className="editor" aria-labelledby="editor-title">
      <header className="editor__header">
        <h2 className="editor__title" id="editor-title">
          {note ? note.name : 'No note selected'}
        </h2>
      </header>
      <label className="editor__label" htmlFor="note-editor">
        Markdown body
      </label>
      <textarea
        id="note-editor"
        className="editor__textarea"
        value={note?.body ?? ''}
        disabled={!note}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {note ? null : (
        <p className="editor__hint">Use New note to start writing, then pick a note in the explorer.</p>
      )}
    </section>
  );
}
