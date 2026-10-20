/**
 * The model of the fullscreen graph.
 *
 * Every function here is pure: the same vault always gives the same picture.
 * The geometry is derived from the sorted list of the notes, so the drawing
 * never depends on a clock, a random number or the order of the vault.
 *
 * The links are resolved with the rules of the contextual graph: the target
 * of a `[[wikilink]]` is the active note with that name, and a note in the
 * trash never resolves.
 */

import { parseNote } from './markdown';
import { activeNotes, normalizeNoteName } from './vault';
import type { Vault } from './types';

/** A note of the graph. */
export interface ViewNode {
  id: string;
  name: string;
}

/** A link between two notes of the graph. */
export interface ViewEdge {
  source: string;
  target: string;
}

/** The notes of a vault and the links between them. */
export interface GraphModel {
  nodes: ViewNode[];
  edges: ViewEdge[];
}

/** A point of the picture, in the world of the graph. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Where the reader looks at the graph from. */
export interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
  targetX: number;
  targetY: number;
}

/** The size of the picture. */
export interface Viewport {
  width: number;
  height: number;
}

/** A point of the picture, on the screen. */
export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
  scale: number;
}

/** The notes that are drawn, and the ones that are not. */
export interface DrawableSelection {
  nodes: ViewNode[];
  edges: ViewEdge[];
  drawn: number;
  total: number;
  omitted: number;
}

/** One page of the list of the notes. */
export interface NotePage {
  items: ViewNode[];
  page: number;
  pages: number;
  total: number;
}

/** The most notes that are drawn at once. */
export const DRAW_LIMIT = 300;

/** The notes of one page of the list. */
export const PAGE_SIZE = 50;

/** The angle between two neighbours of the spiral of the layout. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** The distance between two rings of the layout. */
const RING_STEP = 80;

/** The height of the spread of the layout. */
const Z_SPREAD = 8;

/** How far the camera stands from the picture. */
const CAMERA_DISTANCE = 2000;

/**
 * The length of the lens of the projection.
 *
 * The lens is as long as the distance of the camera, so a point in the
 * middle of the picture keeps its size and the fitted camera frames the
 * notes the way it counted them.
 */
const FOCAL = 2000;

/** The smallest depth a point may have, so the projection never divides by zero. */
const MIN_DEPTH = 1;

/** The largest angle of the camera above and below the horizon. */
const MAX_PITCH = 75;

/** The smallest and the largest zoom of the camera. */
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;

/** The largest distance the camera may pan away from the picture. */
const MAX_TARGET = 1e6;

/**
 * The notes of a vault and the links between them.
 *
 * The notes are the active ones, sorted by name and then by id, so the list
 * of the notes does not depend on the order of the vault. A link is only
 * kept when both ends are notes of the vault: a note in the trash and a
 * target that does not exist stay out of the picture.
 */
export function buildGraphModel(vault: Vault): GraphModel {
  const notes = activeNotes(vault);
  const byName = new Map(notes.map((note) => [note.name.toLowerCase(), note]));

  const nodes: ViewNode[] = notes
    .map((note) => ({ id: note.id, name: note.name }))
    .sort(byNameThenId);

  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const edges: ViewEdge[] = [];

  for (const note of notes) {
    const targets = new Set<string>();
    for (const link of parseNote(note.body).links) {
      const target = byName.get(normalizeNoteName(link.target).toLowerCase());
      if (!target || target.id === note.id) continue;
      targets.add(target.id);
    }
    for (const target of targets) {
      edges.push({ source: note.id, target });
    }
  }

  edges.sort(
    (a, b) =>
      (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0) ||
      (order.get(a.target) ?? 0) - (order.get(b.target) ?? 0),
  );

  return { nodes, edges };
}

/**
 * The place of every note of the list.
 *
 * The notes are spread over a spiral: the angle between two neighbours is
 * the golden angle, so no two neighbours share a direction, and the radius
 * grows with the square root of the index, so the notes keep their distance
 * from each other when there are many of them. The height of a note is a
 * small spread, so the picture has a depth without turning into a cloud.
 */
export function layoutNodes(nodes: ViewNode[]): Point3[] {
  // Keep the world bounded so Fit can frame even a dense vault at minimum zoom.
  const scale = Math.min(1, Math.sqrt(100 / Math.max(1, nodes.length)));
  return nodes.map((_node, index) => {
    const angle = index * GOLDEN_ANGLE;
    const radius = RING_STEP * Math.sqrt(index + 0.5) * scale;
    const height = ((index % 5) - 2) * Z_SPREAD;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: height,
    };
  });
}

/**
 * The camera inside its ranges.
 *
 * A broken number becomes the middle of its range, so the picture is always
 * a picture and never a hole in the page.
 */
export function clampCamera(camera: Camera): Camera {
  return {
    yaw: clamp(finite(camera.yaw, 0), -180, 180),
    pitch: clamp(finite(camera.pitch, 0), -MAX_PITCH, MAX_PITCH),
    zoom: clamp(finite(camera.zoom, 1), MIN_ZOOM, MAX_ZOOM),
    targetX: clamp(finite(camera.targetX, 0), -MAX_TARGET, MAX_TARGET),
    targetY: clamp(finite(camera.targetY, 0), -MAX_TARGET, MAX_TARGET),
  };
}

/**
 * The place of a point on the screen, with a depth.
 *
 * The camera turns around the vertical axis and then around the horizontal
 * one, and the picture is a small perspective: the nearer a point is, the
 * larger it is. The depth never reaches zero, so the division of the
 * projection is always a division by a real number.
 */
export function project(point: Point3, camera: Camera, viewport: Viewport): ScreenPoint {
  const cam = clampCamera(camera);
  const yaw = toRadians(cam.yaw);
  const pitch = toRadians(cam.pitch);

  const dx = point.x - cam.targetX;
  const dy = point.y - cam.targetY;
  const dz = point.z;

  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const turnedX = dx * cosYaw + dz * sinYaw;
  const turnedZ = -dx * sinYaw + dz * cosYaw;

  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const leanedY = dy * cosPitch - turnedZ * sinPitch;
  const leanedZ = dy * sinPitch + turnedZ * cosPitch;

  const depth = Math.max(MIN_DEPTH, CAMERA_DISTANCE - leanedZ);
  const scale = (FOCAL / depth) * cam.zoom;

  return {
    x: viewport.width / 2 + turnedX * scale,
    y: viewport.height / 2 - leanedY * scale,
    depth,
    scale,
  };
}

/**
 * The place of a point on the screen, without a depth.
 *
 * The flat picture turns in its own plane and is never nearer and never
 * farther, so the notes keep their size while the graph is turned.
 */
export function projectFlat(point: Point3, camera: Camera, viewport: Viewport): ScreenPoint {
  const cam = clampCamera(camera);
  const angle = toRadians(cam.yaw);

  const dx = point.x - cam.targetX;
  const dy = point.y - cam.targetY;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const turnedX = dx * cos - dy * sin;
  const turnedY = dx * sin + dy * cos;

  return {
    x: viewport.width / 2 + turnedX * cam.zoom,
    y: viewport.height / 2 - turnedY * cam.zoom,
    depth: 0,
    scale: cam.zoom,
  };
}

/**
 * The camera that frames every note.
 *
 * The middle of the notes is the middle of the picture, and the zoom is the
 * one that leaves a margin around them. A vault without notes keeps the
 * camera of the start.
 */
export function fitCamera(nodes: ViewNode[], viewport: Viewport): Camera {
  const positions = layoutNodes(nodes);
  if (positions.length === 0) return resetCamera();

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const position of positions) {
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
  }

  const halfWidth = Math.max((maxX - minX) / 2, 1);
  const halfHeight = Math.max((maxY - minY) / 2, 1);
  const width = Math.max(finite(viewport.width, 1), 1);
  const height = Math.max(finite(viewport.height, 1), 1);
  const zoom = clamp(
    Math.min(width / (2 * halfWidth), height / (2 * halfHeight)) * 0.85,
    MIN_ZOOM,
    MAX_ZOOM,
  );

  return clampCamera({
    yaw: DEFAULT_CAMERA.yaw,
    pitch: DEFAULT_CAMERA.pitch,
    zoom,
    targetX: (minX + maxX) / 2,
    targetY: (minY + maxY) / 2,
  });
}

/** The camera the graph starts with. */
export const DEFAULT_CAMERA: Camera = {
  yaw: 0,
  pitch: -35,
  zoom: 1,
  targetX: 0,
  targetY: 0,
};

/** A fresh copy of the camera the graph starts with. */
export function resetCamera(): Camera {
  return { ...DEFAULT_CAMERA };
}

/**
 * The notes that are drawn, and the ones that are not.
 *
 * The selected note is always drawn, so the reader never loses the note it
 * is on. The rest of the budget goes to the notes with the most links, and
 * ties are settled by the name, so the same vault always draws the same
 * picture.
 */
export function selectDrawable(
  nodes: ViewNode[],
  edges: ViewEdge[],
  selectedId: string | null,
): DrawableSelection {
  const total = nodes.length;
  const sorted = [...nodes].sort(byNameThenId);

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const byDegree = [...sorted].sort((a, b) => {
    const difference = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
    if (difference !== 0) return difference;
    return byNameThenId(a, b);
  });

  const chosen: ViewNode[] = [];
  const ids = new Set<string>();
  const take = (id: string) => {
    const node = sorted.find((candidate) => candidate.id === id);
    if (!node || ids.has(id)) return;
    ids.add(id);
    chosen.push(node);
  };

  if (selectedId) take(selectedId);
  for (const node of byDegree) {
    if (chosen.length >= DRAW_LIMIT) break;
    take(node.id);
  }

  const drawn = new Set(chosen.map((node) => node.id));
  return {
    nodes: chosen,
    edges: edges.filter((edge) => drawn.has(edge.source) && drawn.has(edge.target)),
    drawn: chosen.length,
    total,
    omitted: total - chosen.length,
  };
}

/**
 * One page of the list of the notes.
 *
 * The list is a way to find a note, so it only looks at the name of a note.
 * The page is kept inside the range of the list, so an empty list still has
 * a first page.
 */
export function pageNotes(nodes: ViewNode[], query: string, page: number): NotePage {
  const needle = query.trim().toLowerCase();
  const matching = (needle ? nodes.filter((node) => node.name.toLowerCase().includes(needle)) : nodes)
    .slice()
    .sort(byNameThenId);

  const total = matching.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = clamp(Math.trunc(finite(page, 1)), 1, pages);
  const start = (current - 1) * PAGE_SIZE;

  return {
    items: matching.slice(start, start + PAGE_SIZE),
    page: current,
    pages,
    total,
  };
}

/** Two notes, the one with the smaller name first. */
function byNameThenId(a: ViewNode, b: ViewNode): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** A number that is a number, or the given one when it is broken. */
function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** A number inside its range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** An angle in degrees as the number the trigonometry wants. */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
