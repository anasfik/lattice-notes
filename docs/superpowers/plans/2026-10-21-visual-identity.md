# Lattice Notes Visual Identity Implementation Plan

> **For agentic workers:** Use subagent-driven-development, one mutator at a time, independent final review. User delegated direction and execution without further approvals.

**Goal:** Rebuild the complete visible product as an editorial writing instrument without changing data behavior.
**Architecture:** Reuse React components and native controls, replace the token system and component presentation, add one original reusable brand mark only if useful.
**Tech Stack:** Existing React/TypeScript/Vite and CSS; no new runtime dependencies.
**Spec:** `DESIGN.md`.

## Global Constraints
Preserve five existing dirty refinement paths; no storage/domain/recovery changes; no accounts/server/remote assets; WCAG AA, 44px compact targets, reduced motion; no push/publish or user-data mutation.

## Review Focus
1. Long note/vault names at 320px must wrap or truncate accessibly, never overflow.
2. Dark local semantic tokens must not leak unreadable ink onto paper menus.
3. Inline rename/mode changes preserve focus, body, selection and scroll.
4. Native dialog controls and graph controls remain reachable with keyboard.
5. Empty/error/local-first copy stays truthful and actionable.

### Task 1: Complete identity and component system
Files: `src/styles.css`, presentational `src/components/*.tsx`, `public/icon.svg`, `public/manifest.webmanifest`, `index.html`; optional `BrandMark.tsx`. Do not edit App behavior/domain/storage. Preserve current App/Explorer/Workspace refinement.
- [ ] Read components/callers and existing stylesheet before edits; capture before screenshots.
- [ ] Add runnable visual acceptance checks; observe old identity fail expected palette/brand criteria before implementation. Behavioral JSX changes require test-first regressions in existing tests.
- [ ] Implement DESIGN.md across onboarding, chrome/index, document/read view, tabs/search/context, all dialogs and graph; update icon/metadata.
- [ ] Run targeted tests, then `flock /tmp/opencode/lattice-notes-build.lock npm test` and build after disk check; inspect changed paths and diff-check.
- [ ] Capture screenshots and axe/keyboard at 1440/390/320 in fresh contexts; fix real failures, leave source uncommitted for review.

### Task 2: Independent review and integration proof
- [ ] Independent code-review of presentation diff, preserve behavioral contracts; fix blocking findings and affected-path re-review.
- [ ] Parent runs full tests/build and browser proof, inspects pixels; record honest unavailable physical/screen-reader checks.
- [ ] Update ledger and report changed paths, evidence and local preview. No remote mutation.
