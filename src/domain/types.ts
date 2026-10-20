/**
 * Shared entity shapes for the Lattice Notes domain layer.
 *
 * Notes stay plain Markdown. The vault is the single document that a
 * repository adapter persists; everything derived from it (links, tags,
 * search results, graph) is computed by pure functions.
 */

export interface Note {
  /** Stable identifier, generated with the platform UUID source. */
  id: string;
  /** Normalized, unique, human readable name shown in the explorer. */
  name: string;
  /** Raw Markdown body. */
  body: string;
  createdAt: number;
  updatedAt: number;
  /** Set when the note is deleted; a deleted note is kept for undo. */
  deletedAt: number | null;
}

export interface Vault {
  notes: Note[];
  /** Id of the selected note, or null when nothing is selected. */
  activeNoteId: string | null;
}
