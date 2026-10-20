import { useId, useMemo } from 'react';

import type { GraphNode, LocalGraph } from '../domain/vault';

export interface GraphProps {
  graph: LocalGraph;
  /** Selects a note without moving the focus, for the nodes that survive. */
  onSelect(noteId: string): void;
  /** Selects a note and hands the keyboard to it, for the list that does not. */
  onNavigate(noteId: string): void;
  /** Upper bound of drawn nodes, the active note included. */
  maxNodes?: number;
}

const DEFAULT_MAX_NODES = 48;
const LABEL_LIMIT = 18;
const EMPTY_TEXT = 'No local connections yet. Add [[links]] to build the graph.';
/**
 * The picture is drawn narrower than the domain layout, so the labels have
 * room next to their node instead of running into the edge of the frame.
 */
const X_SCALE = 0.5;

/**
 * The link neighbourhood of the active note.
 *
 * The picture is drawn from the domain coordinates, so the same vault always
 * produces the same graph. Names are rendered as SVG text and accessible
 * names only; nothing from the vault is ever treated as markup. The list of
 * neighbour buttons below the picture is the touch and screen reader path.
 */
export default function Graph({
  graph,
  onSelect,
  onNavigate,
  maxNodes = DEFAULT_MAX_NODES,
}: GraphProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;

  const visible = useMemo(() => {
    if (graph.nodes.length <= maxNodes) return graph.nodes;

    // A hub note can have more neighbours than the picture can hold, so the
    // backlinks come first and the rest keep the domain order.
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const chosen: GraphNode[] = [];
    const seen = new Set<string>();
    const take = (id: string) => {
      const node = byId.get(id);
      if (!node || seen.has(id)) return;
      seen.add(id);
      chosen.push(node);
    };
    take(graph.activeId);
    for (const id of graph.backlinks) take(id);
    for (const node of graph.nodes) take(node.id);
    return chosen.slice(0, maxNodes);
  }, [graph, maxNodes]);

  const byId = useMemo(() => new Map(visible.map((node) => [node.id, node])), [visible]);
  const edges = graph.edges.filter(
    (edge) => byId.has(edge.source) && byId.has(edge.target),
  );
  const active = visible.find((node) => node.active);
  const neighbours = visible.filter((node) => !node.active);

  if (graph.nodes.length === 0) {
    // An empty graph has no stale content to replace, so the pending
    // message would only flicker on every keystroke.
    return <p className="graph__empty">{EMPTY_TEXT}</p>;
  }

  const caption = `Local graph for ${active?.name ?? 'this note'}`;

  return (
    <div className="graph">
      <figure className="graph__frame">
        <figcaption className="graph__caption">{caption}</figcaption>
        <svg
          className="graph__svg"
          viewBox="-150 -160 300 320"
          role="group"
          aria-labelledby={titleId}
        >
          <title id={titleId}>{caption}</title>
          {edges.map((edge, index) => {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            if (!source || !target) return null;
            return (
              <line
                key={`${edge.source}-${edge.target}-${index}`}
                className="graph__edge"
                x1={source.x * X_SCALE}
                y1={source.y}
                x2={target.x * X_SCALE}
                y2={target.y}
                aria-hidden="true"
                focusable="false"
              />
            );
          })}
          {visible.map((node) => (
            <g
              key={node.id}
              className={node.active ? 'graph__node graph__node--active' : 'graph__node'}
              role="button"
              tabIndex={0}
              aria-label={describe(node)}
              aria-current={node.active ? 'true' : undefined}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onSelect(node.id);
              }}
            >
              {node.active ? (
                <circle
                  className="graph__pulse"
                  cx={node.x * X_SCALE}
                  cy={node.y}
                  r={16}
                  aria-hidden="true"
                  focusable="false"
                />
              ) : null}
              <circle className="graph__node-dot" cx={node.x * X_SCALE} cy={node.y} r={9} />
              <text className="graph__node-label" x={node.x * X_SCALE} y={node.y + 30}>
                {shorten(node.name)}
              </text>
            </g>
          ))}
        </svg>
      </figure>

      {neighbours.length > 0 ? (
        <ul className="graph__list" aria-label="Connected notes">
          {neighbours.map((node) => (
            <li key={node.id}>
              <button type="button" className="graph__item" onClick={() => onNavigate(node.id)}>
                <span className="graph__item-name">{node.name}</span>
                <span className="graph__item-degree">
                  {node.degree} {node.degree === 1 ? 'link' : 'links'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="graph__empty">{EMPTY_TEXT}</p>
      )}

      {visible.length < graph.nodes.length ? (
        <p className="graph__note">
          Showing {visible.length} of {graph.nodes.length} connections
        </p>
      ) : null}
    </div>
  );
}

/**
 * The accessible name of a node: its name, its degree, and the current note.
 *
 * A truncated label is the visible text, so it has to be part of the
 * accessible name as well (WCAG 2.5.3, Label in Name).
 */
function describe(node: GraphNode): string {
  const links = `${node.degree} connection${node.degree === 1 ? '' : 's'}`;
  const visible = shorten(node.name);
  const name = visible === node.name ? node.name : `${visible}, ${node.name}`;
  return `${name}, ${links}${node.active ? ', current note' : ''}`;
}

function shorten(name: string): string {
  return name.length > LABEL_LIMIT ? `${name.slice(0, LABEL_LIMIT - 1)}…` : name;
}
