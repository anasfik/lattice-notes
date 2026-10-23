/**
 * The outline of a note.
 *
 * The outline is the list of the headings of the note that is on the screen.
 * Every heading carries the id the preview gives it, so the outline can link
 * to the place in the note it names.
 */

import { headingId } from './markdown';
import type { HeadingInfo } from './markdown';

export { headingId };

export interface OutlineItem {
  /** How deep the heading sits, 1 to 6. */
  level: number;
  /** The text of the heading. */
  text: string;
  /** The id the heading carries in the preview. */
  id: string;
}

/**
 * Builds the outline of a note.
 *
 * The headings keep the order of the document, and every one of them gets the
 * id of its place in it, so two headings with the same text never share an
 * id.
 */
export function buildOutline(headings: HeadingInfo[]): OutlineItem[] {
  return headings.map((heading, index) => ({
    level: heading.level,
    text: heading.text,
    id: headingId(heading.text, index),
  }));
}
