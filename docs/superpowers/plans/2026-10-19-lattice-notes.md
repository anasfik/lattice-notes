# Lattice Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove an original open-source local-first Markdown knowledge workspace with linked notes, search, backlinks, graph, import/export, and offline operation.

**Architecture:** React owns the workspace UI and transient state; pure TypeScript domain modules derive links, search results, graph data, and import/export; one IndexedDB adapter persists a versioned vault document. Markdown preview renders trusted React nodes rather than raw HTML.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, IndexedDB, SVG, manual service worker/manifest.

**Spec:** `docs/superpowers/specs/2026-10-19-lattice-notes-design.md`

## Global Constraints
- No proprietary code, assets, branding, or copy.
- Local-only operation with Markdown bodies and no server/account requirement.
- Native browser APIs before dependencies; no state-management, graph, Markdown, or icon package unless a measured blocker proves necessary.
- CSS design token block exists before component styling and supplies all reusable values.
- WCAG 2.2 AA semantics, focus, contrast, keyboard operation, target size, and reduced motion.
- Test-first behavior changes; one mutating agent at a time.

## Review Focus
- Malformed/hostile Markdown must render as text and never execute HTML or script.
- Empty or whitespace-only note names must not create inaccessible/ambiguous records.
- Duplicate imported file paths must not overwrite existing notes.
- IndexedDB failure must not discard current in-memory edits.
- Small-screen panels and dialogs must not trap focus or create horizontal overflow.

---

### Task 1: Foundation, tokens, and vault domain

**Files:**
- Create: `package.json`, Vite/TypeScript config, `index.html`, `src/main.tsx`
- Create: `src/styles.css`, `src/domain/types.ts`, `src/domain/vault.ts`, `src/domain/markdown.ts`
- Test: `src/domain/vault.test.ts`, `src/domain/markdown.test.ts`

**Interfaces:**
- Produces: `Note`, `Vault`, `createNote`, `renameNote`, `deleteNote`, `restoreNote`, `parseNote`, `searchNotes`, `buildLocalGraph`.

- [ ] Write focused failing tests for normalized unique names, delete/restore, hostile Markdown, wiki links/tags/backlinks, search, and graph derivation.
- [ ] Run the focused tests and confirm expected missing-module/API failures.
- [ ] Add minimal Vite React scaffolding, the locked CSS token block, and pure domain implementations.
- [ ] Run the focused tests and `npm run build`; expect PASS.
- [ ] Independently review Task 1 and fix blocking findings.

### Task 2: Persistent accessible workspace shell

**Files:**
- Create: `src/storage/vaultRepository.ts`, `src/storage/vaultRepository.test.ts`
- Create: `src/App.tsx`, `src/components/Workspace.tsx`, `src/components/Explorer.tsx`, `src/components/Editor.tsx`, `src/components/Preview.tsx`, `src/components/ContextRail.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: Task 1 domain interfaces.
- Produces: `loadVault(): Promise<Vault | null>`, `saveVault(vault: Vault): Promise<void>`, and the working create/select/edit/rename/delete/undo UI.

- [ ] Write failing repository and interaction tests for first load, persistence errors, create/edit/rename/delete/undo, and empty vault recovery.
- [ ] Run focused tests and confirm they fail for missing behavior.
- [ ] Implement the IndexedDB adapter and semantic three-pane shell with persistent live status and in-memory fallback.
- [ ] Run focused tests, full `npm test`, and `npm run build`; expect PASS.
- [ ] Independently review Task 2 and fix blocking findings.

### Task 3: Linked-note navigation, search, palette, and graph

**Files:**
- Create: `src/components/Search.tsx`, `src/components/CommandPalette.tsx`, `src/components/Graph.tsx`
- Modify: `src/App.tsx`, workspace components, `src/styles.css`
- Test: `src/App.test.tsx`, `src/components/Graph.test.tsx`

**Interfaces:**
- Consumes: `parseNote`, `searchNotes`, `buildLocalGraph`, note mutation callbacks.
- Produces: keyboard search/palette, create-missing wiki links, backlinks navigation, and accessible SVG graph navigation.

- [ ] Write failing interaction tests for shortcuts, no results, command execution, wiki target creation, backlinks, and graph node activation.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement the minimum controls and deterministic graph with the active-node pulse and reduced-motion override.
- [ ] Run focused tests, full `npm test`, and `npm run build`; expect PASS.
- [ ] Independently review Task 3 and fix blocking findings.

### Task 4: Import/export, offline shell, responsive and final proof

**Files:**
- Create: `src/domain/transfer.ts`, `src/domain/transfer.test.ts`, `public/manifest.webmanifest`, `public/sw.js`
- Modify: `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `index.html`, `README.md`
- Create: `scripts/smoke.mjs` only if existing test/browser tools cannot express the smoke path.

**Interfaces:**
- Produces: `importMarkdownFiles`, `serializeVault`, `deserializeVault`, installable/offline app shell, responsive pane controls, documented local development and data format.

- [ ] Write failing tests for file filtering, collision suffixes, partial import reports, export round-trip, and invalid envelopes.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement transfer controls, manifest/service worker registration, responsive pane behavior, and concise README.
- [ ] Run `npm test` and `npm run build`; expect PASS with no warnings.
- [ ] Start the real app, verify core behavior, console, offline reload, keyboard flow, and accessibility.
- [ ] Capture and inspect 1440×900 and 390×844 screenshots; repair overflow, contrast, focus, or hierarchy defects.
- [ ] Run one final whole-wave code review, fix blocking findings, and inspect the final diff/status.
