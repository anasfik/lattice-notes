import { useMemo } from 'react';

import { parseNote, toPlainText } from '../domain/markdown';
import { normalizeNoteName } from '../domain/vault';
import type { LocalGraph } from '../domain/vault';
import type { Note } from '../domain/types';
import Graph from './Graph';

/** Shown while the graph trails the vault, so no false empty state appears. */
export const GRAPH_PENDING_TEXT = 'Updating links…';

export interface ContextRailProps {
  note: Note | null;
  graph: LocalGraph | null;
  /** Lower cased names of the active notes. */
  noteNames: ReadonlySet<string>;
  /** True while the graph still trails the vault. */
  graphPending?: boolean;
  /**
   * Opens a note without moving the keyboard.
   *
   * The rail opens every note through {@link onNavigate} now, so the
   * keyboard always lands on the content that is on the screen. The prop
   * stays for the callers that still pass it.
   */
  onSelect?(id: string): void;
  /** Opens a note and hands the keyboard to the content on the screen. */
  onNavigate(id: string): void;
  onWikiLink(target: string): void;
  /** Opens the fullscreen graph of the vault. */
  onOpenGraph?(): void;
}
/** The active note with its backlinks, its outgoing links, and the local graph. */
export default function ContextRail({
  note,
  graph,
  noteNames,
  graphPending = false,
  onNavigate,
  onWikiLink,
  onOpenGraph,
}: ContextRailProps) {
  const links = useMemo(() => (note ? parseNote(note.body).links : []), [note]);
  const backlinks = useMemo(() => {
    if (!graph) return [];
    return graph.backlinks
      .map((id) => graph.nodes.find((node) => node.id === id))
      .filter((node): node is NonNullable<typeof node> => node !== undefined);
  }, [graph]);

  return (
    <div className="context">
      <h2 className="context__title">Context</h2>
      {note ? (
        <>
          <nav className="context__section" aria-label="Backlinks" aria-busy={graphPending}>
            <h3 className="context__heading">
              {graphPending ? 'Backlinks' : `Backlinks (${backlinks.length})`}
            </h3>
            {backlinks.length > 0 ? (
              <ul className="context__list" role="list">
                {backlinks.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className="context__item"
                      onClick={() => onNavigate(node.id)}
                    >
                      {node.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="context__empty">
                {graphPending ? GRAPH_PENDING_TEXT : 'No backlinks yet.'}
              </p>
            )}
          </nav>

          <nav className="context__section" aria-label="Outgoing links">
            <h3 className="context__heading">Links ({links.length})</h3>
            {links.length > 0 ? (
              <ul className="context__list context__links" role="list">
                {links.map((link) => {
                  const resolved = noteNames.has(
                    normalizeNoteName(link.target).toLowerCase(),
                  );
                  return (
                    <li key={`${link.target}-${link.heading ?? ''}`}>
                      <button
                        type="button"
                        className={resolved ? 'context__item' : 'context__item context__create'}
                        onClick={() => onWikiLink(link.target)}
                      >
                        {resolved ? (link.alias ?? link.target) : `Create “${link.target}”`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="context__empty">No links yet. Write [[a note]] to link one.</p>
            )}
          </nav>

          <section className="context__section" aria-labelledby="context-graph">
            <div className="context__heading-row">
              <h3 className="context__heading" id="context-graph">
                Graph
              </h3>
              {onOpenGraph ? (
                <button
                  type="button"
                  className="context__graph-open"
                  onClick={onOpenGraph}
                >
                  Fullscreen graph
                </button>
              ) : null}
            </div>
            <Graph
              graph={graph ?? { activeId: '', nodes: [], edges: [], backlinks: [] }}
              // The picture opens a note like the list does, so the keyboard
              // always lands on the content that is on the screen.
              onSelect={onNavigate}
              onNavigate={onNavigate}
            />
          </section>

          {/* The metadata of the note is a footnote, not the subject. */}
          <section className="context__section context__details" aria-labelledby="context-details">
            <h3 className="context__heading" id="context-details">
              Details
            </h3>
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
          </section>
        </>
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
