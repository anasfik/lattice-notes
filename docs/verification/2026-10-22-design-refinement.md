# Writing-first control refinement — 2026-10-22

## Scope

Retained the existing React/TypeScript/Vite app and `DESIGN.md` paper/ink/copper identity. This is a UI refinement, not a replacement of notes, storage or navigation. Existing uncommitted feature work remains intact; no commits, remote actions, dependencies or migrations were added.

Changed product paths for this wave only:
- `src/styles.css`: compact native option marks with full-size labels, shared Restore/Retry action styling, segmented view controls, mobile document-header spacing and secondary-action hover rules.
- `src/components/Workspace.tsx`: accessible labelled view group with native radios and a generated label ID; existing view handlers retained.
- `src/components/BookmarksPanel.tsx`: Retry uses the shared product action style; callback and error behavior unchanged.

The requested design skills were combined contextually: token consistency, flat editorial surfaces, native controls, keyboard access and audit-first refinement. Marketing heroes, randomized page sections, GSAP and perpetual motion were deliberately not applied to a local writing workspace.

## Observed changes

Isolated Chromium contexts, before/after computed values and screenshots:
- At 390px, checkbox/radio marks changed from 44px to approximately 18.4px; labels remain at least 44px high.
- Desktop Restore changed from a 21px Arial/outset browser button to a 44px product action with inherited control typography, solid border and 4px radius.
- The 390px document header is now approximately 152px high, down from the observed 176px baseline; the textarea starts around y391 rather than y417. Long titles remain fully visible by wrapping at 320px.
- View selection retains native arrow-key behavior and visible focus, with an inset ring and heavier label so selection is not conveyed by color alone.

## Fresh parent verification

- **PASS** `npm test`: 633 tests, 32 files.
- **PASS** `npm run build`: TypeScript and Vite.
- **PASS** `git diff --check`.
- **PASS** design browser proof: 130 assertions, zero console/page errors; 1440×900, 390×844 and 320×844 in light/dark with reduced motion, axe scans, native radio keyboard behavior, keyboard Restore and fault-injected bookmark Retry.
- **PASS** prior Wave 1 browser regression: 55 assertions, zero errors.
- **PASS** prior Wave 2 browser regression: 59 assertions, zero errors.
- **PASS** shared choice-sizing regression: all 12 GraphView radios across 1440/390/320 retain compact marks inside ≥44px labels, no page overflow or console/page errors. This checks the other consumer of the global coarse-input exemption.
- **PASS** parent inspected desktop workspace/recovery, mobile workspace/settings, dark settings and 320px long-title screenshots.
- **PASS** existing `http://localhost:5173/` still responds HTTP 200.

All heavy parent commands ran under `/tmp/opencode/lattice-notes-build.lock`; root disk usage was 59%. Browser contexts were fresh and isolated from the user's profile.

Local evidence (ignored, retained in this checkout): `.superpowers/sdd/2026-10-22-design-refinement/{before,after}/`, `proof.mjs`, `parent-tests.log`, `parent-build.log`. Runnable visual check: `flock /tmp/opencode/lattice-notes-build.lock node .superpowers/sdd/2026-10-22-design-refinement/proof.mjs after`.

## Review and limits

The interrupted MiniMax implementer left useful changes and observed failing visual assertions; its partial work was recovered rather than rewritten. DeepSeek/GLM fallbacks hit free-usage limits and MiniMax was unavailable. Final scoped review attempts also failed: DeepSeek reported a free-usage limit, Flint reported an unavailable upstream endpoint, and Nemotron reported a free-usage limit. **BLOCKED: independent code/rendered review could not run.** Parent code/pixel inspection and execution evidence above are not represented as an independent review. No paid model was substituted and no repeated quota retries are running. The implementation is locally verified but the independent review gate remains open.

**NOT RUN:** a real screen-reader session, real browser 200% zoom, Safari/Firefox and real-device testing. The 640×422 CSS viewport with DPR 2 is only a reflow proxy, not proof of actual browser zoom. Axe and keyboard checks are not substitutes for screen-reader testing. The prior feature roadmap beyond Wave 2 remains paused, not completed.
