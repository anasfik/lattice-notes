import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import {
  buildGraphModel,
  clampCamera,
  fitCamera,
  layoutNodes,
  pageNotes,
  project,
  projectFlat,
  resetCamera,
  selectDrawable,
} from '../domain/graphView';
import type { Camera, Point3, ScreenPoint } from '../domain/graphView';
import type { Vault } from '../domain/types';
import Icon from './Icon';

export interface GraphViewProps {
  /** True when the graph is on the screen. */
  open: boolean;
  /** The vault whose notes are drawn. */
  vault: Vault;
  /** Opens a note and closes the graph. */
  onOpenNote(id: string): void;
  /** Closes the graph. */
  onClose(): void;
  /** Says something in the polite live region of the app. */
  onAnnounce(message: string): void;
}

/** The size of the picture. The graph never changes its own size. */
const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 700;
const VIEWPORT = { width: VIEW_WIDTH, height: VIEW_HEIGHT };

/** The size of a label in the world of the picture, in world units. */
const LABEL_SIZE = 12;

/** The smallest size a label may have on the screen, in CSS pixels. */
const MIN_LABEL_SIZE = 11;

/** The longest name a label shows before it is cut short. */
const LABEL_LENGTH = 24;

/**
 * The size of a label in the world of the picture.
 *
 * The picture is scaled to the width of the screen, so a label that keeps
 * its size in the world of the picture is unreadable on a phone. The size
 * grows with the shrink of the picture, so the label is at least
 * {@link MIN_LABEL_SIZE} CSS pixels on the screen.
 */
export function labelFontSize(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return LABEL_SIZE;
  return Math.max(LABEL_SIZE, MIN_LABEL_SIZE / scale);
}

/** How far the camera pans with one step of the keyboard. */
const PAN_STEP = 40;

/** How far the camera turns with one step of the keyboard. */
const ORBIT_STEP = 5;

/** The world units that one pixel of a drag moves the picture. */
const PAN_PER_PIXEL = 0.5;

/** The degrees that one pixel of a drag turns the picture. */
const ORBIT_PER_PIXEL = 0.3;

/** How much one zoom step multiplies the zoom with. */
const ZOOM_STEP = 1.2;

/** How far the pointer has to travel before the gesture is a drag. */
const DRAG_THRESHOLD = 4;

/** The part of the distance the camera closes with every frame. */
const EASE = 0.4;

/** The distance below which the camera has arrived. */
const STILL = 0.01;

/**
 * The fullscreen graph of the vault.
 *
 * The panel is a native dialog, so it lives in the top layer of the page and
 * can never make the page wider than the screen. The picture is drawn with
 * SVG from the coordinates of the domain: the same vault always gives the
 * same picture, and nothing here needs a library.
 *
 * The keyboard works on the surface of the picture only, so the arrows never
 * steal a key from the search field. The list of the notes is the path for
 * the reader who cannot use the picture: every note of the vault is in the
 * list, fifty at a time, and the notes that are not drawn are only there.
 */
export default function GraphView({
  open,
  vault,
  onOpenNote,
  onClose,
  onAnnounce,
}: GraphViewProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const searchId = `${baseId}-search`;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const surfaceRef = useRef<SVGSVGElement>(null);
  /** The element that had the keyboard before the graph opened. */
  const opener = useRef<HTMLElement | null>(null);
  /** True when the graph closed because a note was opened from it. */
  const picked = useRef(false);

  const [dimension, setDimension] = useState<'2d' | '3d'>('3d');
  const [mode, setMode] = useState<'orbit' | 'move'>('orbit');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * How much the picture is scaled down on the screen.
   *
   * The picture is drawn in a world of its own and scaled to the width of
   * the screen, so the scale is what the labels and the dots are measured
   * against.
   */
  const [scale, setScale] = useState(1);
  // Editing must not parse the whole vault for a closed supporting view.
  const model = useMemo(() => open ? buildGraphModel(vault) : { nodes: [], edges: [] }, [open, vault]);
  /** The camera the reader is aiming at. It opens with every note in sight. */
  const [target, setTarget] = useState<Camera>(() => fitCamera(model.nodes, VIEWPORT));
  /** The camera that is on the screen. */
  const [view, setView] = useState<Camera>(target);

  const targetRef = useRef<Camera>(target);
  const viewRef = useRef<Camera>(view);
  const openRef = useRef(open);
  /** The frame that is pending, if there is one. */
  const frameRef = useRef<number | null>(null);
  /** The pointers that are down on the picture. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** The gesture that is running on the picture. */
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
    candidate: string | null;
    pinch: number;
  } | null>(null);

  const announce = useRef(onAnnounce);
  announce.current = onAnnounce;

  const positions = useMemo(() => {
    const map = new Map<string, Point3>();
    const layout = layoutNodes(model.nodes);
    model.nodes.forEach((node, index) => {
      const point = layout[index];
      if (point) map.set(node.id, point);
    });
    return map;
  }, [model]);
  const drawable = useMemo(
    () => selectDrawable(model.nodes, model.edges, selectedId),
    [model, selectedId],
  );
  const projected = useMemo(() => {
    const map = new Map<string, ScreenPoint>();
    for (const node of drawable.nodes) {
      const point = positions.get(node.id);
      if (!point) continue;
      map.set(
        node.id,
        dimension === '3d'
          ? project(point, view, VIEWPORT)
          : projectFlat(point, view, VIEWPORT),
      );
    }
    return map;
  }, [dimension, drawable, positions, view]);
  const notes = useMemo(() => pageNotes(model.nodes, filter, page), [filter, model.nodes, page]);
  const selected = model.nodes.find((node) => node.id === selectedId) ?? null;

  /** True when the reader asked for less movement. */
  const reducedMotion = useMemo(() => {
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, [open]);

  /**
   * Asks for one frame.
   *
   * There is never more than one frame in the air: a second change waits for
   * the first frame. A closed or hidden graph asks for nothing.
   */
  const schedule = useCallback(function scheduleFrame() {
    if (!openRef.current) return;
    // A hidden page asks for nothing, so the graph rests while it is away.
    if (typeof document !== 'undefined' && document.hidden) return;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const current = viewRef.current;
      const goal = targetRef.current;
      const next = ease(current, goal);
      viewRef.current = next;
      setView(next);
      if (!still(next, goal)) scheduleFrame();
    });
  }, []);

  /** Aims the camera somewhere else. */
  const moveCamera = useCallback((next: Camera) => {
    const clamped = clampCamera(next);
    targetRef.current = clamped;
    setTarget(clamped);
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // The camera walks to the place the reader asked for. With less movement
  // wanted, it goes there at once and no frame is asked for.
  useEffect(() => {
    if (!open) return;
    if (reducedMotion) {
      viewRef.current = target;
      setView(target);
      return;
    }
    if (still(viewRef.current, target)) return;
    schedule();
  }, [open, reducedMotion, schedule, target]);

  // A frame that is still in the air is dropped when the graph closes.
  useEffect(() => {
    if (open) return;
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, [open]);

  // The same when the graph goes away.
  useEffect(
    () => () => {
      if (frameRef.current === null) return;
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  // The panel opens and closes with the platform of the browser.
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;

    if (open) {
      if (!element.open) {
        opener.current = document.activeElement as HTMLElement | null;
        const fitted = fitCamera(model.nodes, VIEWPORT);
        targetRef.current = fitted;
        viewRef.current = fitted;
        setTarget(fitted);
        setView(fitted);
        setSelectedId(null);
        setFilter('');
        setPage(1);
        gesture.current = null;
        pointers.current.clear();
        element.showModal();
        // The keyboard starts on the picture, so the arrows work at once.
        surfaceRef.current?.focus();
        announce.current(`Graph opened. ${model.nodes.length} notes.`);
      }
      return;
    }

    if (!element.open) return;
    element.close();
    // A note that was opened from the graph says so itself, so the graph
    // does not talk over it.
    if (picked.current) {
      picked.current = false;
    } else {
      announce.current('Graph closed.');
    }
    const target = opener.current;
    if (target?.isConnected) target.focus();
  }, [model.nodes.length, open]);

  // The wheel over the picture zooms, and the page never scrolls under it.
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element || !open) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      moveCamera({ ...targetRef.current, zoom: targetRef.current.zoom * factor });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [moveCamera, open]);

  /**
   * Measures how much the picture is scaled down on the screen.
   *
   * The measurement is taken when the graph opens and whenever the picture
   * changes its size, so the labels of the notes stay readable. Nothing is
   * measured in a loop.
   */
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element || !open) return;
    const measure = () => {
      const width = element.clientWidth;
      if (width > 0) setScale(width / VIEW_WIDTH);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  /** Pans the picture with the keyboard. */
  const pan = (key: string) => {
    const current = targetRef.current;
    if (key === 'ArrowLeft') {
      moveCamera({ ...current, targetX: current.targetX - PAN_STEP });
    } else if (key === 'ArrowRight') {
      moveCamera({ ...current, targetX: current.targetX + PAN_STEP });
    } else if (key === 'ArrowUp') {
      moveCamera({ ...current, targetY: current.targetY + PAN_STEP });
    } else if (key === 'ArrowDown') {
      moveCamera({ ...current, targetY: current.targetY - PAN_STEP });
    }
  };

  /** Turns the picture with the keyboard. */
  const orbit = (key: string) => {
    const current = targetRef.current;
    if (key === 'ArrowLeft') {
      moveCamera({ ...current, yaw: current.yaw - ORBIT_STEP });
    } else if (key === 'ArrowRight') {
      moveCamera({ ...current, yaw: current.yaw + ORBIT_STEP });
    } else if (key === 'ArrowUp') {
      moveCamera({ ...current, pitch: current.pitch + ORBIT_STEP });
    } else if (key === 'ArrowDown') {
      moveCamera({ ...current, pitch: current.pitch - ORBIT_STEP });
    }
  };

  /** The keyboard of the picture. */
  const onSurfaceKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (isEditable(event.target)) return;
    const key = event.key;

    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      if (mode === 'move') pan(key);
      else orbit(key);
      return;
    }
    if (key === '+' || key === '=') {
      event.preventDefault();
      moveCamera({ ...targetRef.current, zoom: targetRef.current.zoom * ZOOM_STEP });
      return;
    }
    if (key === '-' || key === '_') {
      event.preventDefault();
      moveCamera({ ...targetRef.current, zoom: targetRef.current.zoom / ZOOM_STEP });
      return;
    }
    if (key === '0') {
      event.preventDefault();
      moveCamera(resetCamera());
      return;
    }
    if (key === 'f' || key === 'F') {
      event.preventDefault();
      moveCamera(fitCamera(model.nodes, VIEWPORT));
      return;
    }
    if (key === 'Delete') {
      event.preventDefault();
      onClose();
    }
  };

  /** Escape closes exactly this layer, including from a search field. */
  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  /** Starts a gesture on the picture. */
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const id = pointerId(event);
    pointers.current.set(id, { x: event.clientX, y: event.clientY });
    if (pointers.current.size > 1) {
      // A second pointer turns the gesture into a pinch.
      const pinch = spread(pointers.current);
      gesture.current = {
        id,
        x: event.clientX,
        y: event.clientY,
        moved: true,
        candidate: null,
        pinch,
      };
      return;
    }
    gesture.current = {
      id,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      candidate: nodeIdOf(event.target),
      pinch: 0,
    };
    const element = surfaceRef.current;
    if (element && typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(id);
    }
  };

  /** Moves the picture while the pointer is down. */
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const id = pointerId(event);
    if (!pointers.current.has(id)) return;
    pointers.current.set(id, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;

    if (pointers.current.size > 1) {
      // The distance of the two fingers is the zoom.
      const pinch = spread(pointers.current);
      if (current.pinch > 0 && pinch > 0) {
        moveCamera({ ...targetRef.current, zoom: targetRef.current.zoom * (pinch / current.pinch) });
      }
      current.pinch = pinch;
      current.moved = true;
      return;
    }

    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    current.moved = true;
    current.x = event.clientX;
    current.y = event.clientY;

    if (mode === 'move') {
      moveCamera({
        ...targetRef.current,
        targetX: targetRef.current.targetX - dx * PAN_PER_PIXEL,
        targetY: targetRef.current.targetY + dy * PAN_PER_PIXEL,
      });
    } else {
      moveCamera({
        ...targetRef.current,
        yaw: targetRef.current.yaw + dx * ORBIT_PER_PIXEL,
        pitch: targetRef.current.pitch - dy * ORBIT_PER_PIXEL,
      });
    }
  };

  /** Ends the gesture. A pointer that did not travel picks a note. */
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const id = pointerId(event);
    pointers.current.delete(id);
    const current = gesture.current;
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (current && !current.moved && current.candidate) setSelectedId(current.candidate);
    }
    const element = surfaceRef.current;
    if (element?.hasPointerCapture?.(id)) {
      element.releasePointerCapture(id);
    }
  };

  /** Ends the gesture without picking a note. */
  const onPointerCancel = (event: ReactPointerEvent<SVGSVGElement>) => {
    const id = pointerId(event);
    pointers.current.delete(id);
    gesture.current = null;
    const element = surfaceRef.current;
    if (element?.hasPointerCapture?.(id)) {
      element.releasePointerCapture(id);
    }
  };

  /** Opens the note that is selected. */
  const openSelected = () => {
    if (!selectedId) return;
    picked.current = true;
    onOpenNote(selectedId);
    onClose();
  };

  const showLabels = drawable.drawn <= 30 && scale >= 0.5;
  /** The size of a label in the world of the picture. */
  const labelSize = labelFontSize(scale);

  return (
    <dialog
      ref={dialogRef}
      className="graphview"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={onDialogKeyDown}
    >
      <div className="graphview__panel">
        <header className="graphview__head">
          <h2 className="graphview__title" id={titleId}>
            Graph
          </h2>
          <button
            type="button"
            className="graphview__close"
            aria-label="Close the graph"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="graphview__toolbar" role="group" aria-label="Graph controls">
          <button
            type="button"
            className="graphview__control"
            aria-label="Zoom in"
            onClick={() =>
              moveCamera({ ...targetRef.current, zoom: targetRef.current.zoom * ZOOM_STEP })
            }
          >
            <Icon name="zoom-in" />
          </button>
          <button
            type="button"
            className="graphview__control"
            aria-label="Zoom out"
            onClick={() =>
              moveCamera({ ...targetRef.current, zoom: targetRef.current.zoom / ZOOM_STEP })
            }
          >
            <Icon name="zoom-out" />
          </button>
          <button
            type="button"
            className="graphview__control"
            aria-label="Fit the graph"
            onClick={() => moveCamera(fitCamera(model.nodes, VIEWPORT))}
          >
            <Icon name="fit" size={14} />
            Fit
          </button>
          <button
            type="button"
            className="graphview__control"
            aria-label="Reset the camera"
            onClick={() => moveCamera(resetCamera())}
          >
            <Icon name="reset" size={14} />
            Reset
          </button>

          <fieldset className="graphview__modes">
            <legend className="graphview__modes-legend">Dimension</legend>
            <label className="graphview__mode">
              <input
                type="radio"
                name="graphview-dimension"
                value="2d"
                checked={dimension === '2d'}
                onChange={() => setDimension('2d')}
              />
              <Icon name="flat" size={14} />
              <span>2D</span>
            </label>
            <label className="graphview__mode">
              <input
                type="radio"
                name="graphview-dimension"
                value="3d"
                checked={dimension === '3d'}
                onChange={() => setDimension('3d')}
              />
              <Icon name="solid" size={14} />
              <span>3D</span>
            </label>
          </fieldset>

          <fieldset className="graphview__modes">
            <legend className="graphview__modes-legend">Mode</legend>
            <label className="graphview__mode">
              <input
                type="radio"
                name="graphview-mode"
                value="orbit"
                checked={mode === 'orbit'}
                onChange={() => setMode('orbit')}
              />
              <Icon name="orbit" size={14} />
              <span>Orbit</span>
            </label>
            <label className="graphview__mode">
              <input
                type="radio"
                name="graphview-mode"
                value="move"
                checked={mode === 'move'}
                onChange={() => setMode('move')}
              />
              <Icon name="move" size={14} />
              <span>Move</span>
            </label>
          </fieldset>
        </div>

        <div className="graphview__body">
          <div className="graphview__stage">
            <svg
              ref={surfaceRef}
              className="graphview__canvas"
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              role="img"
              aria-label={`Graph of ${drawable.total} notes, ${drawable.drawn} of them drawn`}
              tabIndex={0}
              data-camera-yaw={round(target.yaw)}
              data-camera-pitch={round(target.pitch)}
              data-camera-zoom={round(target.zoom)}
              data-camera-target-x={round(target.targetX)}
              data-camera-target-y={round(target.targetY)}
              onKeyDown={onSurfaceKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
            >
              {drawable.edges.map((edge, index) => {
                const source = projected.get(edge.source);
                const target = projected.get(edge.target);
                if (!source || !target) return null;
                return (
                  <line
                    key={`${edge.source}-${edge.target}-${index}`}
                    className="graphview__edge"
                    x1={round(source.x)}
                    y1={round(source.y)}
                    x2={round(target.x)}
                    y2={round(target.y)}
                    aria-hidden="true"
                    focusable="false"
                  />
                );
              })}
              {drawable.nodes.map((node) => {
                const point = projected.get(node.id);
                if (!point) return null;
                const isSelected = node.id === selectedId;
                return (
                  <g
                    key={node.id}
                    className={
                      isSelected ? 'graphview__node graphview__node--selected' : 'graphview__node'
                    }
                    data-node-id={node.id}
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <title>{node.name}</title>
                    {/* A wider target under the dot, so a finger finds the note. */}
                    <circle
                      className="graphview__hit"
                      cx={round(point.x)}
                      cy={round(point.y)}
                      r={12}
                    />
                    <circle
                      className="graphview__dot"
                      cx={round(point.x)}
                      cy={round(point.y)}
                      r={isSelected ? 9 : 6}
                    />
                    {showLabels || isSelected ? (
                      <text
                        className="graphview__label"
                        x={round(point.x)}
                        y={round(point.y - labelSize - 4)}
                        fontSize={round(labelSize)}
                      >
                        {truncateLabel(node.name)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            <p className="graphview__hint">
              Drag to move the graph. Arrow keys move the camera, + and − zoom, 0 resets, f fits, Escape
              closes.
            </p>
          </div>

          <div className="graphview__side">
            <p className="graphview__counts">
              Drawing {drawable.drawn} of {drawable.total} notes
            </p>
            {drawable.omitted > 0 ? (
              <p className="graphview__omitted">{drawable.omitted} notes not drawn</p>
            ) : null}

            <label className="graphview__search-label" htmlFor={searchId}>
              Search notes
            </label>
            <input
              id={searchId}
              className="graphview__search"
              type="search"
              value={filter}
              placeholder="Search notes"
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(1);
              }}
            />

            <ul className="graphview__list" role="list" aria-label="Notes in this vault">
              {notes.items.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className="graphview__item"
                    data-note-id={node.id}
                    aria-pressed={node.id === selectedId}
                    onClick={() => setSelectedId(node.id)}
                  >
                    {node.name}
                  </button>
                </li>
              ))}
            </ul>

            <div className="graphview__pager">
              <button
                type="button"
                className="graphview__control"
                aria-label="Previous page"
                disabled={notes.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <Icon name="previous" size={14} />
                Previous
              </button>
              <span className="graphview__page">
                Page {notes.page} of {notes.pages}
              </span>
              <button
                type="button"
                className="graphview__control"
                aria-label="Next page"
                disabled={notes.page >= notes.pages}
                onClick={() => setPage((current) => Math.min(notes.pages, current + 1))}
              >
                Next
                <Icon name="next" size={14} />
              </button>
            </div>

            {selected ? (
              <div className="graphview__detail">
                <p className="graphview__detail-name">{selected.name}</p>
                <button
                  type="button"
                  className="graphview__open"
                  onClick={openSelected}
                >
                  Open note
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** The camera halfway to where the reader wants it. */
function ease(current: Camera, goal: Camera): Camera {
  const mix = (from: number, to: number) => from + (to - from) * EASE;
  return {
    yaw: mix(current.yaw, goal.yaw),
    pitch: mix(current.pitch, goal.pitch),
    zoom: mix(current.zoom, goal.zoom),
    targetX: mix(current.targetX, goal.targetX),
    targetY: mix(current.targetY, goal.targetY),
  };
}

/** True when the camera has arrived. */
function still(current: Camera, goal: Camera): boolean {
  return (
    Math.abs(current.yaw - goal.yaw) < STILL &&
    Math.abs(current.pitch - goal.pitch) < STILL &&
    Math.abs(current.zoom - goal.zoom) < STILL &&
    Math.abs(current.targetX - goal.targetX) < STILL &&
    Math.abs(current.targetY - goal.targetY) < STILL
  );
}

/** The number of the pointer of an event. */
function pointerId(event: ReactPointerEvent<SVGSVGElement>): number {
  return typeof event.pointerId === 'number' ? event.pointerId : 0;
}

/** The distance between two pointers. */
function spread(pointers: Map<number, { x: number; y: number }>): number {
  const points = [...pointers.values()];
  const first = points[0];
  const second = points[1];
  if (!first || !second) return 0;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

/** The note under the pointer, if there is one. */
function nodeIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null;
}

/** True for a field the keyboard is typing into. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/** A number with two decimals, so the picture stays readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The name of a note, cut short when it is too long.
 *
 * The whole name stays in the title of the note, so nothing is lost.
 */
function truncateLabel(name: string): string {
  if (name.length <= LABEL_LENGTH) return name;
  return `${name.slice(0, LABEL_LENGTH - 1)}…`;
}
