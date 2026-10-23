# Workspace navigation and actions

User delegated autonomous implementation. Keep DESIGN.md's editorial instrument, but make the product navigation sidebar-led rather than a row of competing toolbar buttons.

## Outcome and decisions
- App menu: global vault/import/export/help commands. Left sidebar: navigation (notes/search/daily/calendar/graph), file creation and local folder index. Document header: only note-specific actions and view. Right sidebar: links, local graph and metadata. Labels and icons must distinguish these layers.
- Use a small attributed Lucide SVG subset, bundled locally with no runtime dependency or remote icon requests; native buttons retain accessible names and tooltips. Icons decorate names, never replace accessible names.
- Folders are virtual path groups in existing note names (`Projects/Untitled`), not filesystem folders or a new storage schema. New folder creates its first Markdown note, with this behavior stated in the form. No invisible sentinel records. Existing notes stay untouched; rename can move a note by path. Folder grouping persists naturally through existing save/export/import. Empty folders are not stored.
- New note, new folder, vault manager/create, inline rename, today, date picker/calendar, quick switcher and commands reuse the shared handlers. Shortcuts shown in menus; add safe modal/IME-aware shortcuts for rename (F2), today (Alt+T), calendar (Alt+C), graph (Alt+G), and shortcut help. Do not intercept editing/navigation keys or browser Ctrl+W/Tab. Existing Ctrl/Cmd+K/P/N survive.
- Desktop sidebars are available without competing global actions. At 390/320 use explicit panel toggles and no overflow, >=44px targets; restore focus when panels/menus close. Native details/dialog preferred; no hover-only controls or nested modals.

## Task 1 — implementation
- [ ] Read callers; add failing behavior tests for grouping/folder creation, menu separation and shortcuts/modal+IME guards.
- [ ] Implement bounded icons + license, virtual folder helper and sidebar/action placement. Iconography covers workspace, explorer/actions, modes/tabs, both sidebars, graph controls, calendar, palettes and vault actions without relabeling existing accessible controls unnecessarily.
- [ ] Verify real existing actions, no placeholders; test folder roundtrip and repeated creation, invalid paths, note-body preservation.
- [ ] Full npm test and npm run build under shared flock after df; diff-check and fresh browser screenshots/axe/keyboard at1440x900/390x844/320x844. Preserve all existing dirty identity/refinement work; leave uncommitted.

## Task 2 — review and proof
- [ ] Independent code review of new wave; fix blocking findings and re-review only affected paths.
- [ ] Parent run tests/build + runtime proof of menus/shortcuts/folders/rename and all overlays; verify screenshot pixels, console/axe and offline path persistence; record limitations honestly.

## Constraints and review focus
No storage/domain entity format changes, dependencies, remote changes, user-data edits, process kills or commits. No unrelated refactoring. Existing identity wave is uncommitted and must survive. Preserve selection/scroll, import identity guards, single status, undo, native dialog semantics. Review hidden focus, folder names/case collisions, menu command duplication, shortcuts during IME/modal, and compact long names. Artifacts `.superpowers/sdd/2026-10-21-workspace-navigation/`.
