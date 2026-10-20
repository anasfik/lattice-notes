/**
 * Vault domain logic: note naming, mutations, search, and link graph.
 *
 * Every function is pure. A mutation returns the next vault plus the affected
 * note, so the UI can keep its selection and undo state in one place.
 */

import { parseNote, toPlainText } from './markdown';
import type { Note, Vault } from './types';

export const DEFAULT_NOTE_NAME = 'Untitled';

export interface SearchResult {
  noteId: string;
  name: string;
  matchIn: 'title' | 'body';
  snippet: string | null;
}

export interface GraphNode {
  id: string;
  name: string;
  x: number;
  y: number;
  degree: number;
  active: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface LocalGraph {
  activeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Ids of the notes that link to the active note. */
  backlinks: string[];
}

export function createEmptyVault(): Vault {
  return { notes: [], activeNoteId: null };
}

/** Trims a name and collapses internal whitespace runs into single spaces. */
export function normalizeNoteName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Notes that are not deleted, in vault order. */
export function activeNotes(vault: Vault): Note[] {
  return vault.notes.filter((note) => note.deletedAt === null);
}

/**
 * A unique note name among the active notes. Deleted notes release their
 * name so that a link to a trashed note resolves again as soon as a note with
 * that name exists; restoring a trashed note suffixes it if the name was
 * taken meanwhile.
 */
export function uniqueNoteName(vault: Vault, desired: string, exceptId?: string): string {
  const base = normalizeNoteName(desired) || DEFAULT_NOTE_NAME;
  const taken = new Set(
    vault.notes
      .filter((note) => note.deletedAt === null && note.id !== exceptId)
      .map((note) => note.name.toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;

  let suffix = 2;
  while (taken.has(`${base} ${suffix}`.toLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

export function createNote(vault: Vault, name = '', body = ''): { vault: Vault; note: Note } {
  const now = Date.now();
  const note: Note = {
    id: newId(),
    name: uniqueNoteName(vault, name),
    body,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return { vault: { ...vault, notes: [...vault.notes, note] }, note };
}

export function renameNote(
  vault: Vault,
  id: string,
  name: string,
): { vault: Vault; note: Note | null } {
  const existing = vault.notes.find((note) => note.id === id);
  if (!existing) return { vault, note: null };

  const desired = normalizeNoteName(name);
  if (!desired) return { vault, note: existing };

  const next = { ...existing, name: uniqueNoteName(vault, desired, id), updatedAt: Date.now() };
  if (next.name === existing.name) return { vault, note: existing };

  return {
    vault: { ...vault, notes: vault.notes.map((note) => (note.id === id ? next : note)) },
    note: next,
  };
}

export function updateNoteBody(
  vault: Vault,
  id: string,
  body: string,
): { vault: Vault; note: Note | null } {
  const existing = vault.notes.find((note) => note.id === id);
  if (!existing) return { vault, note: null };

  const next = { ...existing, body, updatedAt: Date.now() };
  return {
    vault: { ...vault, notes: vault.notes.map((note) => (note.id === id ? next : note)) },
    note: next,
  };
}

/** Deletes a note but keeps it in the vault so that it can be restored. */
export function deleteNote(vault: Vault, id: string): { vault: Vault; note: Note | null } {
  const existing = vault.notes.find((note) => note.id === id);
  if (!existing || existing.deletedAt !== null) return { vault, note: null };

  const now = Date.now();
  const next = { ...existing, deletedAt: now, updatedAt: now };
  const notes = vault.notes.map((note) => (note.id === id ? next : note));
  const activeNoteId =
    vault.activeNoteId === id ? (notes.find((note) => note.deletedAt === null)?.id ?? null) : vault.activeNoteId;

  return { vault: { ...vault, notes, activeNoteId }, note: next };
}

export function restoreNote(vault: Vault, id: string): { vault: Vault; note: Note | null } {
  const existing = vault.notes.find((note) => note.id === id);
  if (!existing || existing.deletedAt === null) return { vault, note: null };

  const next = {
    ...existing,
    name: uniqueNoteName(vault, existing.name),
    deletedAt: null,
    updatedAt: Date.now(),
  };
  return {
    vault: { ...vault, notes: vault.notes.map((note) => (note.id === id ? next : note)) },
    note: next,
  };
}

/** Finds notes whose title or body contains the query, deleted notes excluded. */
export function searchNotes(vault: Vault, query: string): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const results: SearchResult[] = [];
  for (const note of activeNotes(vault)) {
    if (note.name.toLowerCase().includes(needle)) {
      results.push({ noteId: note.id, name: note.name, matchIn: 'title', snippet: null });
      continue;
    }

    const text = toPlainText(note.body);
    const index = text.toLowerCase().indexOf(needle);
    if (index === -1) continue;

    const start = Math.max(0, index - 40);
    const end = Math.min(text.length, index + needle.length + 40);
    let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) snippet = `…${snippet}`;
    if (end < text.length) snippet = `${snippet}…`;
    results.push({ noteId: note.id, name: note.name, matchIn: 'body', snippet });
  }
  return results;
}

/**
 * The neighbourhood of the active note: the note itself, the notes it links
 * to, and the notes that link to it. Layout is deterministic so the graph
 * component can render the same picture for the same vault.
 */
export function buildLocalGraph(vault: Vault, activeNoteId: string): LocalGraph {
  const notes = activeNotes(vault);
  const active = notes.find((note) => note.id === activeNoteId);
  if (!active) return { activeId: '', nodes: [], edges: [], backlinks: [] };

  const byName = new Map(notes.map((note) => [note.name.toLowerCase(), note]));
  const outgoing = new Map<string, string[]>();
  for (const note of notes) {
    const targets: string[] = [];
    for (const link of parseNote(note.body).links) {
      const target = byName.get(normalizeNoteName(link.target).toLowerCase());
      if (target && target.id !== note.id && !targets.includes(target.id)) targets.push(target.id);
    }
    outgoing.set(note.id, targets);
  }

  const neighbourhood = new Set<string>([active.id]);
  for (const target of outgoing.get(active.id) ?? []) neighbourhood.add(target);
  for (const note of notes) {
    if ((outgoing.get(note.id) ?? []).includes(active.id)) neighbourhood.add(note.id);
  }

  const edges: GraphEdge[] = [];
  for (const id of [...neighbourhood].sort()) {
    for (const target of outgoing.get(id) ?? []) {
      if (neighbourhood.has(target)) edges.push({ source: id, target });
    }
  }

  const radius = 120;
  const neighbours = [...neighbourhood]
    .filter((id) => id !== active.id)
    .map((id) => notes.find((note) => note.id === id))
    .filter((note): note is Note => note !== undefined)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const nodes: GraphNode[] = [
    { id: active.id, name: active.name, x: 0, y: 0, degree: 0, active: true },
    ...neighbours.map((note, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / neighbours.length;
      return {
        id: note.id,
        name: note.name,
        x: Math.round(Math.cos(angle) * radius * 100) / 100,
        y: Math.round(Math.sin(angle) * radius * 100) / 100,
        degree: 0,
        active: false,
      };
    }),
  ];

  for (const edge of edges) {
    for (const node of nodes) {
      if (node.id === edge.source || node.id === edge.target) node.degree += 1;
    }
  }

  return {
    activeId: active.id,
    nodes,
    edges,
    backlinks: edges.filter((edge) => edge.target === active.id).map((edge) => edge.source),
  };
}

function newId(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
