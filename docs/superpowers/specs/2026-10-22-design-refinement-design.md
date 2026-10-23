# Lattice Notes — writing-first refinement

## Intent
Refine the working local-first editor as one coherent product, not a collection of individually styled feature panels. The user delegates design decisions and execution, including permission for major changes. The builder chooses to retain the functioning React/TypeScript/Vite implementation and paper/ink/copper identity: a rebuild offers no demonstrated advantage to writing, navigation or data safety.

## Direction
Use DESIGN.md as the token and identity source of truth. A generous paper document and precise dark index are the memorable contrast. Native sans controls, serif reading and monospace source remain. Flat surfaces, fine rules and 4px controls; no marketing heroes, decorative motion, remote fonts or new libraries. Synthesize the requested skills contextually: design-system consistency, minimalist hierarchy, accessible native controls and audit-led taste, not their contradictory marketing defaults.

## Scope and evidence
Audit actual 1440×900, 390×844 and 320×844 interfaces before choosing layout changes. Source audit has identified candidate inconsistencies: Recovery Restore lacks the shared action base; bookmark Retry has no product styling; the global mobile target rule enlarges native radio/checkbox marks instead of only their labels. Confirm these in the browser before changing them. Evaluate chrome density and support panels by how much readable writing area remains, not by novelty.

## Flow and states
Open local workspace → select/create note → write → read → inspect links/bookmarks/outline → return to writing. Empty vault, no search results, loading bookmarks, failed read with Retry, failed save with retained draft, trash with Undo and permanent delete with named confirmation must survive. Existing handlers, accessible names, mounted textarea, caret/selection and keyboard shortcuts are contracts. Theme/reduced-motion settings must work, not merely exist.

## Constraints
Preserve all existing uncommitted feature and identity work. No storage schema/domain changes, user-note deletion, runtime dependencies, backend, telemetry or remote actions. Keep the live development server and isolated verification contexts. No commits authorized. Every changed interaction is test-first; visual corrections are demonstrated by runnable computed-style checks and inspected before/after screenshots.

## Acceptance
Coherent action typography, borders and state feedback across dialogs and rails; normal-sized native option marks inside ≥44px labels; supporting chrome never obstructs editing or hides routes to existing features. Light/dark screenshots at all three widths; no overflow, console/page errors or blocking axe findings; keyboard operation/focus return and reduced motion checked. Full npm test/build and diff-check pass. Independent scoped code review and rendered visual review must clear blockers. Screen-reader verification is reported as NOT RUN if the environment has no usable reader.
