/**
 * The outline of the note on the screen.
 *
 * The outline is the list of the headings of the note. Every heading is a
 * button that jumps to the place it names in the preview, so the outline is
 * operable from the keyboard alone.
 *
 * A note without headings has no outline, and the panel says so instead of
 * showing an empty list.
 */

import { useId } from 'react';

import type { OutlineItem } from '../domain/outline';
import Icon from './Icon';

export interface OutlinePanelProps {
  /** The headings of the note on the screen, in the order of the document. */
  items: OutlineItem[];
  /** Jumps to the heading with the given id. */
  onJump(id: string): void;
}

export default function OutlinePanel({ items, onJump }: OutlinePanelProps) {
  const titleId = useId();

  return (
    <section className="outline" aria-labelledby={titleId}>
      <h2 className="outline__title" id={titleId}>
        <Icon name="disclosure" size={14} />
        Outline
      </h2>

      {items.length === 0 ? (
        <p className="outline__empty">This note has no headings yet.</p>
      ) : (
        <ul className="outline__list" role="list">
          {items.map((item) => (
            <li key={item.id} className="outline__item" data-level={item.level}>
              <button type="button" className="outline__link" onClick={() => onJump(item.id)}>
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
