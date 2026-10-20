# Complete Local Workspace Implementation Plan

> For agentic workers: use subagent-driven-development, one mutator at a time; independent review each wave, affected-path re-review for blocking fixes. Continue without routine product questions.

**Goal:** Onboarding, safe multiple vaults, complete real commands, popup note switching, tabs, daily/calendar notes and a controllable fullscreen graph on the refined workspace.
**Architecture:** Extend the existing IndexedDB store with a catalog, keyed documents and per-vault sessions. Explicit identity/generation and flush-before-switch protect drafts. Reuse existing Markdown mutations, search/link semantics and shared action handlers.
**Tech stack:** Existing React/TypeScript/Vite; native IndexedDB/dialog/details/SVG/pointer/CSS; no new runtime dependency.
**Spec:** `docs/superpowers/specs/2026-10-20-lattice-notes-workspace-design.md`.

## Global constraints
- Original branding/code/copy/assets; never execute/copy proprietary bundles. Public references only.
- Local/offline first, no accounts/server/telemetry/folder-access promises/new runtime dependency.
- DB `lattice-notes` version1/store `vault`, legacy `current` and `{version:1,vault}` unchanged; metadata-only migration never overwrites legacy content.
- Preserve formats, recovery/export, draft/caret/selection, Write/Split/Read and compact panels.
- Exactly one polite status, persistent actionable errors, visible focus/reduced motion/44px controls (inline links exempt).
- One mutator, at most two readers, no grandchildren; heavy gates under `/tmp/opencode/lattice-notes-build.lock`; preserve5173; no merge/push/publish.

## Review focus
1. Corruption is not empty; never seed/overwrite it (wave1).
2. Debounced writes retain source identity; failed switch preserves draft+Export (wave2).
3. IME and shortcuts behind modals cannot mutate background notes (wave3/browser).
4. Local midnight/DST/leap/year changes never create wrong/duplicate daily notes (wave4).
5. Graph drag/cancel/close never opens accidentally/leaks frames or silently omits dense data (wave5).

## Wave0 — close UI refinement
- [ ] Existing UI report/diff, parent tests/build/browser/keyboard/offline evidence, inspect1440/390/320 pixels; independent review, fix blockers/re-review; preserve as baseline. Existing evidence is under `/tmp/opencode/lattice-refine/`; do not redo passing checks without changed code.

## Wave1 — repository/migration
**Files:** `src/storage/vaultRepository.ts` and tests ONLY.
**Exports:** `VaultMetadata={id:string,name:string,createdAt:number,archivedAt:number|null}`; `VaultCatalog={version:1,activeVaultId:string,vaults:VaultMetadata[]}`. `loadVault(id='current'):Promise<Vault|null>`, `saveVault(vault,id='current'):Promise<void>`. `loadCatalog():Promise<VaultCatalog|null>`; `createStoredVault(name,vault):Promise<{catalog:VaultCatalog,vault:Vault}>`; `openStoredVault(id)` same return; `renameStoredVault(id,name)`, `archiveStoredVault(id)`, `restoreStoredVault(id)` return `Promise<VaultCatalog>`.
**Keys:** current→current, otherwise vault:<id>; catalog at catalog. Default calls always legacy. Atomic creation/selection and transactional catalog read/modify/write. Reject bad metadata/archived/missing/corrupt targets, active archive; no implicit repair.
- [ ] RED: legacy content/IDs/timestamps/selection and raw document untouched; fresh null; corrupt legacy/catalog rejects; A/B isolation; no-arg saves current even B selected; abort create leaves no partial keys; failed target doesn't select; archive/rename/restore preserve bodies; concurrent creates preserve both.
- [ ] Implement reusing existing open/validation/abort/late-close; narrow GREEN, full tests, locked build/diff-check; scoped commit+RED/GREEN report; independent review before UI consumes it.

## Wave2 — onboarding and guarded lifecycle
**Files:** App/tests, new Onboarding/VaultManager, Workspace/CSS; focused `src/hooks/useVaultWorkspace.ts` allowed to simplify, not duplicate.
**Consumes:** wave1, note mutations/export, visible-content focus. **Produces:** current ID/catalog, single-flight `switchVault(id)` and create route, toolbar manager trigger. Import/export visible vault only, one undo slot per ID, Help does not reseed. All autosaves explicit ID+generation; flush before switching/creating, failure keeps source.
- [ ] RED: fresh labelled name+blank/example/JSON-restore; validated backup preserves names/bodies/timestamps; malformed/unreadable/oversize creates nothing and preserves form; create once+focus; legacy bypass; corruption not first use; unavailable explicitly unsaved with Retry/Export.
- [ ] RED: edit A→B flush→return/reload isolation; delayed A completion cannot mark B saved; rapid switches single-flight; source-save/target-read failure leaves A/draft/Export/catalog; manager operations+active archive reason+long names+focus; undo A unavailable B and restored A only; active-only import/export.
- [ ] Implement native forms/dialogs and persistent storage warning; adapt old app-test setup to explicit migrated-user fixtures, retaining assertions. Full gates, onboarding/manager1440/390/320+offline, independent review/repair.

## Wave3 — commands, switcher and tabs
**Files:** App/Workspace/CommandPalette/tests, new QuickSwitcher/NoteTabs, shared `src/domain/commands.ts` if it removes duplication, CSS; repository/tests for sessions.
**Interfaces:** real action IDs/labels/categories/shortcuts/disabled reasons bound to common handlers. `loadVaultSession(id):Promise<{version:1,openNoteIds:string[]}|null>`, optional `saveVault(vault,id,session)` commits content+session atomically. Key session:<id>; activeNoteId sole selection; sanitize IDs, preserve null after last tab close. Active close right then left; close≠delete, bodies never copied.
- [ ] RED: all supported real commands, disabled reasons; modal shortcut isolation/IME Enter; CtrlP distinct switcher prevents Print, query title/body/no-results, arrows/Enter once, Escape visible focus, typing no creation; workspace search retained.
- [ ] RED: one tab per ID, close not delete, neighbors, final null reload, rename/trash/Undo ownership, A/B isolation, sanitized reload, abort combined content/session updates neither key nor in-memory bodies.
- [ ] Implement native dialog/IME-safe combobox and non-nested close controls; internally scrolling320px tabs; complete roving arrows/Home/End if ARIA tabs. Full gates+keyboard/axe/browser, independent review/repair.

## Wave4 — daily/calendar notes
**Files:** pure `src/domain/dailyNotes.ts`/tests, Calendar/tests, App/action catalog/Workspace/CSS.
**Interfaces:** `formatLocalDate(Date):string`; strict `parseCivilDate(string):{year:number,month:number,day:number}|null`; `monthDays(year,month)` month1-based; `openDailyNote(Vault,dateKey):{vault:Vault,note:Note}` exact normalized active title, invalid rejects, new body `# YYYY-MM-DD\n\n`.
- [ ] RED: midnight/DST/local vs UTC, leap/invalid/year/month boundaries, idempotence/isolation/deleted policy; Today/date/grid opens one tab, notes indicated beyond color, labels/Escape/focus/reload/offline.
- [ ] Native date+month prev/next/Today grid, existing handlers/real commands, no new format. Full gates+desktop/mobile keyboard/axe, independent review/repair.

## Wave5 — fullscreen graph/motion
**Files:** pure graphView/tests, new GraphView/tests; contextual Graph/ContextRail/App/catalog/CSS wiring (retain contextual graph).
**Interfaces:** nodes{id,name}, edges{source,target} with existing resolution; deterministic finite geometry/projection/clamped camera; dialog owns camera/filter/selection, `onOpenNote(id)`/`onClose`. Draw exactly up to300 including selected, explicit totals/omitted; all-note searchable list50/page.
- [ ] RED: links/trash, zero/dense deterministic finite geometry, zoom/reset, selection vs drag, pointer cancel, keyboard ignores fields, cancel frames; dialog/list/filter/counts/2D/3D/Orbit/Move/zoom/fit/reset, close focus, Open note closes/focuses visible content.
- [ ] Original SVG/canvas, pointer capture/cancel, one pendingRAF/no idle frames/unmount cleanup; no graph/animation deps. Short opacity/transform transitions, reduced-motion handling, no typing/layout delays. Browser motion evidence+pointer/touch/keyboard+dense timing+1440/390/320+axe, full gates, independent review/repair.

## Wave6 — final cross-feature proof
- [ ] Final status/diff/tests/locked build; unrelated work preserved. Whole-expansion independent review against baseline/spec/deferred ledger; blocking fix+scoped re-review.
- [ ] Fresh production contexts: legacy/new onboarding, two vaults with tabs/daily, edit/switch/reload, archive/restore, import/export isolation/fault recovery, all command/switcher/tab/calendar/graph keyboard+motion.
- [ ] Worker controlling→correct vault identity/body saved→offline reload boots→offline edit survives second reload; zero console/page errors, preserve5173.
- [ ] Inspect1440×900/390×844/320×844 screenshots, axe onboarding/manager/switcher/calendar/graph, manual contrast if incomplete, honest screen-reader coverage; final ledger/report paths/SHAs/checks/URLs/limits. Keep branch/worktree; no automatic merge/push/publish.
