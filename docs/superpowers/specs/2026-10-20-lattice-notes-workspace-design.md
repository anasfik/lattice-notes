# Lattice Notes — complete local workspace

## Intent

Extend the existing local-first workspace into a coherent product: original onboarding, multiple vaults, complete supported commands, popup note search, tabs, daily calendar notes, and a controllable fullscreen perspective graph. Preserve the preceding UI refinement, notes, recovery and offline operation. Reference workflows are behavioral evidence, not proprietary code, copy or assets.

## Constraints and visual system

- Existing React/TypeScript/Vite PWA and native browser APIs; no new runtime dependency, account, server, telemetry, synchronization claims, plugins or filesystem-folder promises.
- Retain the dark writing studio: charcoal/graphite, warm ink, one violet accent, token-based spacing/type, sans controls and monospace Markdown. No decorative cards or perpetual animation.
- Keep mounted editor/preview and Write/Split/Read, preserving draft/caret/scroll; compact defaults to Write, explicit session choices survive navigation. Writing is primary; supporting panels remain explicit compact disclosures.
- Commands, vault name and New note stay discoverable. Secondary file actions use a labelled disclosure. Long names and tabs stay within their own scroll/truncation areas, never push global controls outside 320px.
- Exactly one polite status region; errors persist with recovery. A storage warning remains evident when an unrelated operation fails. Native dialogs restore visible focus; Escape closes the nearest layer, never a background panel. IME composition cannot execute commands.
- WCAG 2.2 AA, visible focus, named controls, reduced motion, practical 44px targets (inline prose links exempt), keyboard and touch equivalents.
- One mutator, at most two readers, no child spawning; heavy gates use `/tmp/opencode/lattice-notes-build.lock`. Preserve live port5173; no automatic merge, push or publish.

## Vault safety and lifecycle

Keep DB `lattice-notes`, version1, store `vault`, legacy key `current`, document `{version:1,vault}` and all note/envelope formats. Migration never rewrites, copies, moves, deletes or reseeds the legacy content. Catalog key `catalog` holds version1 metadata with stable IDs, names, timestamps, archive state and active ID. ID `current` maps ONLY to key `current`; other IDs map to `vault:<id>`, never display names. No-argument load/save always mean legacy `current`, not catalog selection; multi-vault callers always pass explicit identity.

Readable legacy data gains metadata and bypasses onboarding. Both legacy and catalog absent means fresh; unreadable/corrupt is an error, never absence. Creation writes document and catalog atomically. All catalog read/modify/write is in one transaction so overlapping operations preserve entries. Validate unique IDs, normalized nonempty names, finite timestamps and an unarchived active member; reject corruption rather than repair silently.

Switch/create is single-flight: finish the source draft write to its captured ID, validate/read the target and persist selection, then commit the visible workspace. Capture ID+generation for debounced writes; late completion cannot replace another vault's content or saved state. Failed flush/read keeps the source identity/draft/UI/undo/Export intact with Retry. Do not promise cross-tab content merge; last-writer-wins remains documented.

Archive is reversible; the active vault cannot be archived until another is open, with a visible reason. No permanent delete. Restore then Open/Export recovers an archived vault. Rename affects metadata only. Import/export acts on the visible vault only; Export includes unsaved in-memory notes. Keep one ephemeral undo slot per stable vault ID, validating ownership on restore; no transferable global undo or unnecessary stack.

## Onboarding and vault manager

Genuine first use shows an original compact welcome: browser-local explanation, editable vault name and blank/example/restore-JSON choice. Use shared envelope validation and byte/note limits BEFORE stored creation. Bad/unreadable backup writes no partial vault and preserves the form. Explain browser-data clearing and Export backups; Markdown import stays under Files after creation. No account gate, carousel or fake folder picker. Success enters once and focuses a useful control; errors retain values and Retry. Storage unavailable permits an explicitly unsaved workspace with Export.

The current vault name opens a native manager dialog listing active/archived vaults: Open/Create/Rename/Archive/Restore/Done, meaningful disabled reasons and operation feedback, keyboard and 320px operation. Help reopens guidance without migration or reseeding.

## Commands, popup search and tabs

One action catalog is shared by toolbar, shortcuts and palette: stable ID, label, category, optional shortcut, enabled state/reason and real handler. List every implemented action, not fake plugins: note create/rename/trash/undo, import/export, modes, note switching, workspace search, daily/calendar, graph, vault manager/help and tab actions. Note-dependent unavailable commands explain why. Shortcuts never mutate background content behind a modal.

Ctrl/Cmd+K is Commands; Ctrl/Cmd+P opens a distinct Quick switcher, preventing Print. Reuse existing title/body search, show labelled query and sensible snippets, arrows/Enter/Escape, empty/no-results and IME-safe behavior. Typing never creates notes; creation must be explicitly selected. Full-text explorer search remains visible and available as a command.

Tabs contain IDs, never bodies. Opening activates one tab without duplicates. Close never deletes. Rename updates titles, trash removes tabs, Undo may reopen only in its owning vault. Active close picks right neighbor else left; closing last persists `activeNoteId:null` and useful no-open-note UI, without deleting notes or auto-selecting after reload. Per-vault session key `session:<id>` contains `{version:1,openNoteIds:string[]}`. Content `activeNoteId` is the ONLY selection authority; no activeTabId. Filter missing/deleted/duplicate IDs on load, include active only if present. Save content selection+session atomically when both change. Native buttons and labelled non-nested close controls; if ARIA tabs are used, implement roving arrows/Home/End completely.

## Daily notes and calendar

Use local civil `YYYY-MM-DD`, never UTC slicing. Reuse an active exact normalized daily name idempotently, not prefixes. Deleted daily notes are not silently restored; a replacement follows existing naming rules. New body is `# YYYY-MM-DD\n\n`. Native date input, labelled month/year and date grid, previous/next/Today; existing-note indication beyond color. Strict date validation, leap/DST/midnight/year-boundary tests. Current-vault-only commands, keyboard/touch equivalents, reload/offline persistence.

## Fullscreen graph and motion

Native full-viewport in-app dialog (no browser-fullscreen permission) shows all active notes/resolved links, distinct from the contextual graph. Original SVG/canvas deterministic coordinates and small perspective projection, no WebGL/physics dependency. Selected detail/Open note, filter, 2D/3D, Orbit/Move, bounded zoom, fit/reset and clear keyboard instructions. Pointer capture/cancel, drag vs selection separation, wheel/pinch clamping, labelled touch controls; arrows/+/-/Reset only on graph surface, never hijack fields. Open note closes graph and focuses visible Write/Read content.

Drawing budget exactly300 nodes including selected; explicit drawn/total/omitted counts. All notes accessible via searchable list paginated50/page. Reuse existing resolution rules. Pure finite deterministic geometry/camera, bounded transforms, at most one pending animation frame; no idle/hidden/closed rendering, cancel frames on unmount. Reduced motion disables interpolation/spatial entrances, not controls. Short opacity/transform overlay/selection transitions only: no continuous idle orbit, cursor parallax, textarea layout animation or delayed focus.

## Acceptance

1. Legacy/fresh/corrupt/unavailable states distinguished; preserve all bodies/IDs/timestamps/selection.
2. Two-vault create/switch/rename/archive/restore/reload has no content/tab/import/export leakage; runnable rapid edit/switch, failed save/read and overlapping catalog regressions.
3. All commands real; disabled reasons, keyboard/touch/IME/Escape/focus covered for switcher/tabs/calendar.
4. Local daily notes idempotent, reloaded and offline in selected vault.
5. Graph orbit/pan/zoom/reset finite/bounded; filter/list/Open note, cancellation, cleanup and idle rendering proven.
6. No draft/caret/selection loss across modes/tabs/vaults; failure recovery and in-memory Export remain usable.
7. Full tests/type-checked build and independent review each wave; blocking fixes get affected-path re-review.
8. Fresh inspected screenshots1440×900/390×844/320×844, keyboard+axe onboarding/manager/switcher/calendar/graph, no overflow/console errors, reduced motion, real production offline identity+edits restored. State screen-reader coverage honestly.

## Reference scope

Public REA research: `/tmp/opencode/lattice-refine/reference-research.md` and `reference-evidence.json`. Vault first use `ev_a5898e72a388cfb5e27ebd126b086cc24b7836535850ec1bd8bc6f3e01702ed9`; management `ev_e3de36341297bd2be670be17139b78e82349df42de611798cbd76bf24aa661ea`; commands `ev_b65cacfa05d9f5555b1f4a4ec92e6d4c91fc92e4631de1371005e3a282b39dc2`; switching `ev_766f42c87fe5b44cd921df6833745778cbe8e2283aa4b65620881d3431c2e2ff`; tabs `ev_27b62fd50cb0e82bbcf2fb672c93231434ccd81be488b8ed9f190f5dc6cd08c1`; daily `ev_3e2b93899763ecc43480aa561c9663f69509f831ee323553ee7fd7e1590fd410`; graph `ev_7f312dd7523ef5e52660d975acb28b3b92b200be788f01fcebe7828cfcc756dd`.

These establish documentation workflows, not native runtime/animations/ranking. Calendar/3D references are third-party plugins. Deliberate differences: browser-local instead of folders, archive instead of delete/forget, K/P shortcuts rather than upstream P/O, explicit creation, flat ID tabs, fixed civil dates, bounded perspective graph. Search-language/plugin/folder-sync/tab-group/popout/configurable-template parity is outside this delivery.
