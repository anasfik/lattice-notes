import type { RefObject } from 'react';

import type { Note } from '../domain/types';

export interface EditorProps {
  note: Note | null;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** True while another view shows the note, so the field is not on screen. */
  hidden?: boolean;
  /** True when the browser marks the words it does not know. */
  spellcheck?: boolean;
  onChange(body: string): void;
}

/**
 * The Markdown editor. The label stays visible so the field is never unnamed.
 *
 * The field stays mounted in every view and is only hidden, so a draft and
 * the caret of the writer survive a change of the view.
 */
export default function Editor({ note, textareaRef, hidden, spellcheck = false, onChange }: EditorProps) {
  return (
    <section className="editor" aria-label="Markdown editor" hidden={hidden}>
      <label className="editor__label" htmlFor="note-editor">
        Markdown body
      </label>
      <textarea
        id="note-editor"
        ref={textareaRef}
        className="editor__textarea"
        value={note?.body ?? ''}
        disabled={!note}
        spellCheck={spellcheck}
        onChange={(event) => onChange(event.target.value)}
      />
      {note ? null : (
        <p className="editor__hint">Use New note to start writing, then pick a note in the explorer.</p>
      )}
    </section>
  );
}
