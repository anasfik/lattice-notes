# Design Refinement Implementation Plan

> **For agentic workers:** Use subagent-driven-development; one implementation wave, independent review afterward. Leave changes uncommitted.

**Goal:** Quieter writing controls and consistent recovery/settings controls without changing storage or navigation behavior.
**Architecture:** Reuse native forms and CSS tokens; improve shared actions, label hit areas and document-header layout. No application-state changes.
**Tech Stack:** Existing React/TypeScript/Vite/native CSS and Chromium proof.
**Spec:** `docs/superpowers/specs/2026-10-22-design-refinement-design.md`; binding `DESIGN.md`.

## Global constraints
- Preserve earlier dirty identity/navigation/Wave1/Wave2 work. No commits, remotes, dependencies, migrations or user-profile changes.
- Keep paper/ink/copper, 4px radius, spacing/type tokens, native radio/checkbox semantics, visible focus, 44px label targets and reduced motion.
- Marketing heroes, AIDA, GSAP and random layout do not suit this writing workspace; do not stack incompatible skill aesthetics.

## Evidence and review focus
Baseline `.superpowers/sdd/2026-10-22-design-refinement/before/`: six isolated contexts, light/dark at1440/390/320; 31 checks, 18 axe scans clean, zero errors. Parent inspected desktop workspace/recovery and mobile workspace/settings.
1. Mobile marks are44px, not merely hit areas: keep checkbox/radio marks16–24px and labels≥44px.
2. Desktop Restore is UA Arial/outset/21px: reuse product actions, ≥44px all widths, 4px radius.
3. Bookmark Retry needs shared product states, preserving callback/error behavior.
4. View options retain native keyboard arrows/focus and a non-color selection indicator in a quiet segmented group.
5. At390px writing begins y417 with176px document header: reduce excess mobile rows without truncating long titles, hiding safety actions or shrinking targets. At320px wrap rather than overflow.

## Task 1 — Controls and writing hierarchy
**Files:** `src/styles.css`; `src/components/{Workspace,RecoveryDialog,BookmarksPanel}.tsx` only for necessary class/structure changes; existing component tests/`src/visual-identity.test.ts` as relevant.
**Interfaces:** No prop/state/storage changes; existing workspace-view radios, restore handler, Retry callback unchanged.
- [x] Extend ignored proof.mjs after assertions with keyboard radio/focus and compact labelled controls; observe expected style assertion RED before editing.
- [x] Reuse action styles for Restore/Retry, including hover/active/focus/disabled; no new button abstraction.
- [x] Exempt radio/checkbox marks from broad touch-input sizing; labels carry≥44px targets on desktop/mobile.
- [x] Style view group as segmented controls; native inputs remain focusable and labels show selected/focused states. Reduce document-header rows using existing flex placement; no hidden core actions or icon-only ambiguity.
- [x] Full tests and after proof; compare six widths/themes plus long names, keyboard and reduced motion. Only a reflow proxy ran; actual browser zoom remains NOT RUN.

## Task 2 — Independent proof and review
- [x] Re-read changes; disk check then npm test/build and diff-check under shared flock.
- [x] Parent after proof plus existing Wave1/Wave2 behavior scripts; inspect desktop/mobile light/dark pixels, console/axe/keyboard results.
- [ ] Independent scoped code-review and rendered ui-review; fix blockers and recheck only affected paths.
- [x] Record exact results/changed paths in docs/verification/2026-10-22-design-refinement.md, leave source uncommitted and localhost5173 alive. Real screen-reader session NOT RUN; axe/keyboard is not a substitute. Independent review remains blocked by model availability, not passed.
