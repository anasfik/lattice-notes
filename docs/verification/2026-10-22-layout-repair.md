# Scroll, layout and semantics repair — 2026-10-22

## Scope and evidence

This repair changes `src/components/Workspace.tsx`, `src/styles.css` and regression tests in `src/App.test.tsx`. Extensive earlier uncommitted feature/design work remains in the checkout. No storage schema, domain rules, dependencies, notes, commits or remote systems changed in this wave.

The long-note baseline produced 15 failures across 28 browser assertions. At 390×844, the document grew to 21,366px and Context started around y=21,215. Compact split panes inherited document-sized scrolling rather than bounded pane scrolling. Independent Index/Context state also allowed both supporting panels to stack above/below the document.

## Repairs

- One compact panel state: Index or Context occupies the content area instead of stacking with the document. Selection, document creation and heading navigation reveal the appropriate content.
- Keep the editor mounted while hidden, preserving its draft, selection and saved pane offsets.
- A viewport-bounded grid with explicit pane scroll ownership, zero minimum grid-child heights, contained overscroll and no textarea resize handle that can break the grid.
- A short-height inner-scroll fallback keeps document controls and writing areas reachable rather than shrinking the editor away.
- Position the explorer so absolutely positioned accessible labels cannot leak beyond its scrollport and enlarge the page at landscape heights.
- One persistent semantic `main` workspace landmark; the document is a named `section`, including when supporting panels replace it. Existing native controls, token palette, focus indicators and 44px compact targets remain in use.

Baseline axe scans were already clean: the semantic change clarifies workspace structure, not a claim that an axe violation was found or that semantics were exhaustively audited.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | PASS — 636 tests, 32 files |
| `npm run build` | PASS — TypeScript and Vite |
| `git diff --check` | PASS |
| Layout browser proof | PASS — 70 assertions |
| Design regression proof | PASS — 130 assertions |
| Wave 1 browser regression | PASS — 55 assertions |
| Wave 2 browser regression | PASS — 59 assertions |
| Console/page errors in final browser runs | 0 |
| Independent code review | BLOCKED — free-model quota failures; no review performed |

Heavy checks used `/tmp/opencode/lattice-notes-build.lock`; root disk usage was 59%. The live development server was preserved. Browser runs used isolated Chromium contexts, not the user's browser storage.

Layout coverage: 1440, 900, 768, 390 and 320px widths, plus 390×400, 844×390 and 640×422 short-height/dark cases. Assertions cover bounded page geometry, internal preview scrolling and wheel ownership, draft/selection/DOM preservation, restored scroll offsets, visible Context, panel exclusivity, one visible main landmark, heading focus, keyboard behavior and axe WCAG/best-practice scans. Desktop 1440×900 and mobile 390×844 screenshots were inspected, alongside compact Outline and short-height screenshots.

Test-first evidence includes three initial failing compact-state tests and browser failures before CSS repairs. Full-suite verification also caught and led to repair of desktop empty-document focus. A design-proof fixture was updated to close Context before targeting the now-hidden document radio; a transient palette shortcut timeout was resolved by waiting for the closed dialog's render/effect boundary. Final complete runs passed.

## Artifacts and limits

Ignored reproducible evidence is retained in `.superpowers/sdd/2026-10-22-layout-repair/`: `proof.mjs`, `before/`, `after/`, `tests-final.log`, `build-final.log`, and `red-tests.log`. Existing design and feature browser proofs remain in their respective `.superpowers/sdd/` directories.

Short landscape split panes remain dense; controls and content scroll internally. This is a targeted shared-layout repair, not an exhaustive design-system audit. Real devices, screen readers, Safari/Firefox and actual browser zoom were **not run**. A 640×422 viewport is a reflow proxy, not proof of 200% browser zoom. Independent review remains an open gate, not a passed check. Changes are uncommitted.
