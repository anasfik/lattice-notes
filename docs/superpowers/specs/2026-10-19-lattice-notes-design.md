# Lattice Notes Design

## Intent
Lattice Notes is an original, open-source, local-first Markdown knowledge workspace for people who think in linked notes. It should make opening, writing, linking, finding, and understanding notes fast without requiring an account, network, proprietary file format, or remote service.

## Evidence boundary
Public product pages and a bounded static analysis of the official Obsidian 1.14.4 Linux package informed capability priorities only. Browser Evidence `ev_de2a1c78802e866f572a53cc054aa23370d93df19e0f2a078a6faeb9cf13462b` observed the public claims of private on-device notes, offline operation, open formats, links, graph, and extensibility. Static Evidence `ev_0abdaa12a018f362d5486bfbd026115b7fdbccee76aba6171ea403f55a487851` observed bundled Markdown/editor/rendering modules but was partial and did not establish runtime behavior. No proprietary code, assets, branding, or copy may be reused.

## Product goals
- Create, rename, edit, and delete Markdown notes; deletion offers undo.
- Persist the vault in IndexedDB and work after the app shell has loaded without a network.
- Parse `[[wiki links]]`, tags, headings, lists, fenced code, emphasis, and ordinary links into a safe preview without injecting HTML.
- Show backlinks and a local link graph around the active note.
- Search titles and bodies, navigate results, and expose common actions in a keyboard command palette.
- Import Markdown files and export the vault in an open, documented JSON envelope containing Markdown bodies.
- Remain useful at 1440×900 and 390×844 with keyboard, pointer, touch, and reduced motion.

## Non-goals for the first complete release
Canvas, collaboration, hosted sync, publishing, accounts, a plugin marketplace, arbitrary plugin execution, PDF rendering, mobile-native packaging, and pixel-level imitation of another product.

## Architecture
A Vite React TypeScript PWA runs entirely in the browser. A small domain layer owns note normalization, links/tags, search, graph derivation, and import/export. A repository adapter persists one versioned vault document in IndexedDB; the React app owns transient selection, panels, palette, and undo state. Rendering uses React nodes rather than raw HTML so imported Markdown cannot execute scripts.

The app starts with a small seeded vault only when storage is genuinely empty. If storage fails, it keeps the in-memory vault usable, shows a persistent recoverable warning, and allows export. Writes are debounced after immediate in-memory updates. Import merges non-conflicting paths and deterministically suffixes collisions instead of overwriting.

## Core flow
Entry → restore local vault → select or create note → edit Markdown → local save confirmation → follow a wiki link or inspect backlinks/graph → search or command palette for navigation → export when desired.

Branches:
- Empty vault: explain local storage and offer “Create first note” or “Import Markdown”.
- Search has no matches: echo the query and offer to clear it.
- Missing wiki target: activate the link to create the named note.
- IndexedDB unavailable/write failure: keep edits in memory, show what happened, offer retry/export.
- Delete: remove immediately, announce it, and offer undo before replacing the prior undo slot.
- Import collision: retain both notes with a numeric suffix and report the count.
- Unsupported file: skip it and report partial success.

## Visual system
Purpose: Local-first Markdown knowledge workspace with linked notes, search, graph, and extensibility.
Audience: Desktop knowledge workers using keyboard-heavy workflows on wide screens, with a compact mobile fallback.
Tone: Instrument-panel minimalism—dense, calm, and tool-like.
Reference: IDE file explorers, scientific instruments, and paper notebooks.
Palette: Charcoal base, layered graphite surfaces, warm white ink, electric violet accent.
Type: Geist Sans for interface clarity; Geist Mono for metadata and commands, with local fallbacks.
Memorable: A restrained live link-map pulse reveals the neighborhood around the active note.
Restraint: No marketing gradients, ornamental cards, mixed radii, or animation without feedback value.

The CSS token block must precede components and own type, space, colors, radius, borders, and motion. Exactly one accent is used. The three-pane desktop shell is activity rail, explorer, editor/preview, and contextual right rail. On small screens, the editor is primary; supporting panes become explicit drawers/panels and every interactive target is at least 44px.

## Interaction and accessibility
- Native buttons, inputs, textareas, dialogs, nav, aside, and main landmarks.
- Visible focus with 3:1 contrast; all actions keyboard operable.
- `Ctrl/Cmd+K` opens the command palette, `Ctrl/Cmd+N` creates a note, `Ctrl/Cmd+P` focuses search, and Escape closes overlays.
- Dynamic save, delete, import, and search status is announced in one polite live region; errors persist visibly.
- The editor has a persistent label. Preview links are real buttons or anchors with accessible names.
- Motion respects `prefers-reduced-motion`; the graph pulse stops under reduced motion.
- Dark palette text and meaningful boundaries meet WCAG 2.2 AA contrast.

## Acceptance
1. A first visit shows a usable seeded local vault; refresh restores edits and selection without a server.
2. Creating, renaming, editing, deleting, and undoing a note works using keyboard alone.
3. Wiki links produce outgoing links, backlinks, create-missing-target behavior, and graph edges.
4. Search finds title/body text and handles no-result state.
5. Markdown import and vault export preserve note bodies and never silently overwrite.
6. The app builds and its automated domain/interaction tests pass.
7. Browser proof at 1440×900 and 390×844 shows no overflow or clipped controls; console has no application errors.
8. The core keyboard walk and automated accessibility scan have no blocking findings.
