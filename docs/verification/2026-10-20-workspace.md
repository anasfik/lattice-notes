# Local workspace acceptance record

Scope: the [workspace design](../superpowers/specs/2026-10-20-lattice-notes-workspace-design.md)
and [delivery plan](../superpowers/plans/2026-10-20-lattice-notes-workspace.md).
This is an original MIT-licensed browser workspace, not full Obsidian parity.
No account, backend, telemetry, new runtime dependency, remote publication or
filesystem permission was introduced.

## Delivered

- Named browser-local vaults; blank/example/validated JSON onboarding;
  switching, rename, reversible archive/restore and a visible active-archive reason.
- Legacy metadata-only migration, atomic catalog operations and content/session
  writes, captured vault identity/generation, flush-before-switch, per-vault undo,
  import ownership and export from the visible in-memory vault.
- Mounted Write/Split/Read content preserving draft, caret and scroll; supported
  commands, Ctrl/Cmd+K palette, distinct Ctrl/Cmd+P search and ID-only note tabs.
  Closing the final tab persists no selection without deleting notes.
- Strict local civil-date daily notes and keyboard-operated calendar.
- Native full-viewport graph dialog: deterministic bounded perspective geometry,
  2D/3D, orbit/pan, zoom, Fit/Reset, pointer cancellation, keyboard controls and
  focus return. At most 300 nodes are drawn including selection; every note is
  reachable through the searchable 50-per-page list. No idle frame loop.

## Verification

All checks below ran locally on the final combined implementation with system
Chromium 146 on Linux. Browser contexts were fresh and isolated from user notes.

| Check | Result |
|---|---|
| `npm test` | PASS: 447 tests, 18 files |
| `npm run build` | PASS: TypeScript and Vite production build |
| `git diff --check` | PASS |
| Storage contract conformance script | PASS: all claims hold |
| Cross-feature production browser checks | PASS: 127/127 |
| Production service worker/offline checks | PASS: 6/6 |
| Two-vault, import/export, archive, reload and legacy migration | PASS: 11/11 |
| No-mouse onboarding → switcher → daily/calendar → graph → manager | PASS: 10/10 |
| Failed vault operation inside manager, draft preservation and recovery | PASS: 19/19 |

Rendered dimensions: **1440×900**, **390×844**, **320×844**. Screenshots were
inspected; checks found no horizontal document overflow or console/page errors.
Thirty axe state scans (WCAG 2 A/AA, 2.1 AA and 2.2 AA rules) returned zero
violations across onboarding, Write, Read, Files, palette, switcher, calendar,
vault manager, fullscreen graph and manager error states. Finite entrance
animations were allowed to settle before screenshot/contrast checks. Reduced
motion preserves graph controls without spatial entrance/interpolation.

Offline proof used only a local production preview: service worker controls the
page, hashed JS/CSS are cached but the worker does not cache itself, a stored
vault boots offline, an offline edit reaches its own keyed document, and a
second offline reload retains that edit. The legacy raw document remained
unchanged after catalog migration. An actual downloaded JSON export contained
the visible vault and imported Markdown, not the other vault's notes.

### Review repairs

Independent whole-expansion review found one Important issue: failed operations
were announced behind the modal vault manager. The shared error is now shown
inside the open manager and returns to persistent workspace recovery on close;
there is exactly one alert and one status region. Its regression was observed
failing before the fix, then passing, and real-browser fault checks cover all
three widths.

Affected-path independent re-review: **PASS, no blocking findings**. It checked
the shared handoff for all five manager operations, single alert/status and
unchanged recovery/draft paths. The runtime regression injects an Open failure;
the other operation handoffs were source-verified rather than fault-injected.

Graph review repairs also have observed failing-then-passing regressions: no
note-body reads while closed, current-vault Fit on reopen, guarded pointer
release, Escape from the search field and finite fitted dense layouts. Final QA
made the scrolling preview keyboard reachable and fixed wrapped view-mode radio
target sizing at 320px.

### Performance evidence

For a synthetic linked 1,200-note vault, the real closed GraphView read **zero**
note bodies per simulated keystroke. Its component render median was 1.7ms
versus 8.1ms for a reconstructed old unconditional-model branch (12 samples after
3 warmups, headless Chromium on a shared machine). This is a bounded synthetic
comparison, not an end-user latency guarantee. Open graph p95 was about 89ms;
300 drawn nodes, 900 omitted and 24 list pages were verified.

## Remaining limits and follow-up

- Whole-vault writes remain last-writer-wins across browser tabs; there is no
  cross-tab merge. Pending-save ordering relies on IndexedDB transaction order.
- Closing the browser immediately after typing can lose the final 200ms of edits.
- A corrupt catalog is never reset automatically. Retry and in-memory Export
  remain available; automatic catalog repair is not implemented.
- Ordinary autosave preserves an unreadable tab session, but explicit recovery
  Retry can replace its tab IDs. Note bodies remain safe.
- A manager catalog refresh can race another tab's rename and show an old label
  until reopening/reloading. The hypothetical edit-between-flush-and-switch
  window is not reachable through the current modal UI; revisit if switching
  becomes non-modal.
- Successful rename/archive/restore can leave an earlier failure message visible.
  The shared error can also show an unrelated autosave failure inside the manager;
  recovery remains available after closing. Operation-specific error lifecycle is
  a follow-up, not a claim of perfect error-context handling.
- The rename command still uses the native prompt. Calendar's initial cursor can
  be stale after midnight; Today recovers. The unused optional ContextRail
  `onSelect` compatibility prop remains cleanup, not a second navigation path.
- Compact graph picture targets are small; equivalent labelled 44px list controls
  provide selection/Open note. Search filters the list, not the picture.
- Inline Markdown runs over 20,000 characters deliberately remain plain text.
- Automated DOM tests cannot prove native focus/layout or screen-reader speech.
  Chromium keyboard/geometry checks cover the former; physical touch devices,
  actual screen readers and a cross-browser matrix were **NOT RUN**.

Detailed raw JSON, screenshots, reproducible browser scripts, review reports
and benchmark samples remain in the git-ignored local directory
`.superpowers/sdd/2026-10-20-lattice-notes-workspace/`. It is intentionally
preserved. The application and this acceptance summary are tracked in git;
no merge, push, publish or release was performed.
