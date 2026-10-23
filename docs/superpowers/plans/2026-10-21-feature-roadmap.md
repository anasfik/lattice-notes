# Feature roadmap: Lattice Notes

- Date: 2026-10-21
- Companion research: `docs/superpowers/specs/2026-10-21-feature-gap-research.md`
- Status (2026-10-23): Waves 1–2 implemented (settings, recovery, history, bookmarks and outline). Waves 3–6 remain planned; Wave 7 records scope boundaries. The original implementation instructions below are historical design intent, not a claim that every planned feature has shipped. See the current README for supported behavior.

## 0. Ground rules

1. **No parity claim.** Lattice Notes stays an independent, browser-only, local-first Markdown
   workspace. Every wave below is a deliberate, documented subset, never a match for Obsidian.
   The README line "This is an original browser workspace, not full application parity"
   (`README.md:176-177`) stays true and must be updated, not deleted, as features land.
2. **Local-first only.** No wave adds an account, a server, a telemetry call, an upload path or a
   third-party runtime dependency. New dependencies need a written justification in the wave.
3. **RED first.** Every behaviour change starts as a failing test in the wave's own test file.
   A wave is not started with a test that does not yet fail for the right reason.
4. **One wave at a time.** The wave order below is a dependency order, not a wish list.
5. **Additive storage only.** A storage change adds an IndexedDB object store or a versioned
   document key. Existing vaults are never rewritten in place. Every schema change ships with a
   migration test built from a previous-version fixture.
6. **The dirty tree survives.** The worktree carries uncommitted identity and navigation work
   (`git status` at plan time shows modified `src/App.tsx`, `src/components/*`, `src/domain/*`,
   `src/styles.css` and new files such as `src/components/icons/`, `src/domain/folders.ts`,
   `DESIGN.md`). Every wave leaves that work intact: no `git checkout`, no `git stash` of
   unrelated files, no `git reset`, no commit without explicit approval.
7. **Gates are the AGENTS.md gates**: `npm test`, `npm run build`, desktop 1440×900 screenshot,
   mobile 390×844 screenshot, browser console check, focused accessibility and keyboard checks.
   The repo convention of running the full suite and the build under a shared flock after a `df`
   check applies.
8. **Evidence per wave** lands in `.superpowers/sdd/2026-10-21-<wave>/` (brief, report, review
   notes, browser evidence), and the wave ends with an independent code review.

## 1. Wave summary

| Wave | Theme | Depends on | Primary risk | Deliverable |
|---|---|---|---|---|
| 1 | Safety and settings | — | Storage migration touches every vault | A settings surface, snapshot recovery, explicit destructive actions |
| 2 | Navigation, history, bookmarks, outline | 1 | New persisted state per vault | Back/forward, recent notes, bookmarks, heading outline |
| 3 | Search, tags, properties | 1, 2 | Query language surface area; frontmatter parsing | Operator search, tag index, read-only properties |
| 4 | Editing: find/replace, tasks, templates, markdown set | 3 | Editor text model changes | In-note find/replace, task lists, templates, slash menu, callouts and tables |
| 5 | Files, attachments, portability | 4 | Binary storage and export format | Attachment store, embed rendering, Markdown-file export, CSV/HTML import, deep link |
| 6 | Split layouts | 2, 4 | Session format change; layout complexity | Multiple panes, tab groups, pinned tabs, linked views |
| 7 | Boundaries: canvas, bases, sync, plugins | — | Scope creep | Written decisions, no code |

Priority order is 1 → 2 → 3 → 4 → 5 → 6, with 7 running as documentation only.
Wave 1 is first because every later wave creates state that a user can lose; recoverability is
cheapest to build before there is more to lose.

## 2. Wave 1 — Safety and settings

### Outcome
The user can see and change the settings that affect their data, can recover a note body that
was overwritten by mistake, and cannot lose data through an action that was not confirmed.

### Scope (exact files and symbols)

New:
- `src/domain/settings.ts` — `AppSettings`, `DEFAULT_SETTINGS`, `normalizeSettings`
- `src/domain/snapshots.ts` — snapshot capture, retention and diff helpers
- `src/components/SettingsDialog.tsx` — native `<dialog>`, labelled controls
- `src/components/RecoveryDialog.tsx` — list snapshots of a note, restore one

Modified:
- `src/storage/vaultRepository.ts` — `DB_VERSION` 1 → 2; create object stores `settings` and
  `snapshots` in the existing `onupgradeneeded` path (`src/storage/vaultRepository.ts:527`)
- `src/domain/commands.ts` — commands `settings.open`, `note.recover`, `note.deletePermanent`
- `src/App.tsx` — settings state, snapshot capture on save, restore handler
- `src/components/Workspace.tsx` — app-menu entries for Settings and Recovery
- `README.md` — document the recovery path and the settings

### Interfaces

```ts
// src/domain/settings.ts
export interface AppSettings {
  version: 1;
  confirmDelete: boolean;        // ask before a note is trashed
  snapshotIntervalMinutes: number; // 0 disables; clamped to 0..60
  snapshotRetentionDays: number;  // clamped to 1..90
  excludedPatterns: string[];     // note names hidden from search and the tag index
  dailyNoteFormat: string;        // default 'YYYY-MM-DD'
  spellcheck: boolean;
  theme: 'light' | 'dark' | 'system';
}
export const DEFAULT_SETTINGS: AppSettings;
export function normalizeSettings(raw: unknown): AppSettings; // total: never throws

// src/domain/snapshots.ts
export interface Snapshot { key: string; vaultId: string; noteId: string; at: number; body: string }
export function shouldCapture(lastAt: number, now: number, intervalMinutes: number): boolean;
export function retentionCutoff(now: number, retentionDays: number): number;
export function diffCounts(before: string, after: string): { added: number; removed: number };

// src/storage/vaultRepository.ts (new exports, same module)
export async function loadSettings(): Promise<AppSettings>;
export async function saveSettings(settings: AppSettings): Promise<void>;
export async function listSnapshots(vaultId: string, noteId: string): Promise<Snapshot[]>;
export async function writeSnapshot(vaultId: string, noteId: string, body: string): Promise<void>;
export async function readSnapshot(key: string): Promise<Snapshot | null>;
export async function deleteSnapshot(key: string): Promise<void>;
export async function pruneSnapshots(vaultId: string, cutoff: number): Promise<number>;
```

### RED tests (written first, named)
- `src/domain/settings.test.ts`: `normalizeSettings returns the defaults for unknown input`;
  `keeps known fields and drops unknown ones`; `clamps the snapshot interval to 0..60`.
- `src/domain/snapshots.test.ts`: `captures only after the interval elapsed`;
  `prunes snapshots older than the retention window`; `diffCounts counts added and removed lines`.
- `src/storage/vaultRepository.test.ts`: `a version 1 database upgrades to version 2 and the
  vault document still loads`; `settings survive a reopen`; `a corrupt settings record falls back
  to the defaults and does not touch the vault`; `a snapshot can be listed, read and deleted`.
- `src/components/SettingsDialog.test.tsx`: `opens from the app menu`; `Escape closes the dialog
  and returns the focus`; `every control has an accessible name`; `applying writes the settings
  and announces the change`.
- `src/App.test.tsx`: `a note body can be restored from an earlier snapshot`.

### Gates
`npm test` · `npm run build` · migration fixture test (v1 → v2) · settings dialog keyboard walk
(Escape, Tab order, focus return) · restore-a-snapshot browser proof · 1440×900 and 390×844
screenshots · console check · independent code review.

### Dependencies
None. This is the foundation wave.

### Recovery and data-loss considerations
- The migration is additive: a new object store, no rewrite of `vault` documents, no change to
  the catalog. A user who downgrades keeps a working vault; the extra stores are ignored.
- A settings write failure must never block a note save; a failed snapshot write must never
  fail a note save. Both are logged to the status line, not thrown.
- `note.deletePermanent` is the first irreversible action in the app. It requires a
  confirmation that names the note, it prunes that note's snapshots, and the dialog offers
  "Export before deleting".
- Snapshot bodies contain the full note text. They live in the same browser origin as the vault
  and are cleared by the same "clear site data" action. The README must say so plainly.
- Do not implement retention sweeping of the trash in this wave. Soft-deleted notes stay
  recoverable until the user deletes them permanently. A retention policy is a later decision
  that must not be shipped silently.

## 3. Wave 2 — Navigation, history, bookmarks, outline

### Outcome
The user can go back to the note they came from, reach the notes they use often, and jump to a
heading inside the note they are reading.

### Scope

New:
- `src/domain/history.ts` — in-memory navigation stack
- `src/domain/bookmarks.ts` — bookmark model and grouping
- `src/domain/outline.ts` — heading ids and outline items
- `src/components/BookmarksPanel.tsx` — list, groups, add and remove
- `src/components/OutlinePanel.tsx` — heading list of the active note

Modified:
- `src/storage/vaultRepository.ts` — `DB_VERSION` 2 → 3, new object store `bookmarks`
- `src/domain/commands.ts` — `history.back`, `history.forward`, `note.bookmark`,
  `view.outline`, `bookmarks.panel`
- `src/App.tsx` — history state, bookmark state and handlers
- `src/components/Preview.tsx` — stable heading ids so the outline can link to them
- `src/components/Workspace.tsx` — the two new panels
- `src/domain/markdown.ts` — export `headingId(text, index)`

### Interfaces

```ts
// src/domain/history.ts
export interface HistoryEntry { noteId: string; at: number }
export interface HistoryState { past: HistoryEntry[]; future: HistoryEntry[] }
export const HISTORY_LIMIT = 50;
export function pushHistory(state: HistoryState, noteId: string, at: number): HistoryState;
export function goBack(state: HistoryState): { state: HistoryState; noteId: string | null };
export function goForward(state: HistoryState): { state: HistoryState; noteId: string | null };

// src/domain/bookmarks.ts
export type BookmarkKind = 'note' | 'heading' | 'search';
export interface Bookmark { id: string; kind: BookmarkKind; target: string; title: string; group: string }
export function toggleBookmark(list: Bookmark[], candidate: Omit<Bookmark, 'id'>): Bookmark[];
export function groupBookmarks(list: Bookmark[]): Map<string, Bookmark[]>;

// src/domain/outline.ts
export interface OutlineItem { level: number; text: string; id: string }
export function buildOutline(headings: HeadingInfo[]): OutlineItem[];
export function headingId(text: string, index: number): string;
```

### RED tests
- `src/domain/history.test.ts`: `pushing the same note twice does not duplicate the entry`;
  `going back moves the entry to the future`; `going forward restores it`; `the stack is capped
  at 50 entries`; `opening a note from the switcher clears the future`.
- `src/domain/bookmarks.test.ts`: `toggling adds and then removes the bookmark`;
  `two headings of the same note are different bookmarks`; `grouping sorts by group then title`.
- `src/domain/outline.test.ts`: `the outline lists headings in document order`; `two headings
  with the same text get different ids`.
- `src/components/BookmarksPanel.test.tsx`: `a bookmark can be added and removed with the
  keyboard`; `an empty bookmark list shows its empty state`.
- `src/components/Preview.test.tsx`: `every heading carries the id the outline links to`.
- `src/domain/commands.test.ts`: `the catalog contains history.back, history.forward,
  note.bookmark and view.outline`.

### Gates
`npm test` · `npm run build` · keyboard walk of the back/forward shortcuts, the bookmarks panel
and the outline · bookmark persistence across a reload in the browser · screenshots at both
widths · console check · independent code review.

### Dependencies
Wave 1 (the `bookmarks` object store is created in the version 3 migration; the settings and
snapshot stores from wave 1 stay untouched).

### Recovery and data-loss considerations
- Navigation history is **in memory for the session only** and is not persisted. The session
  document (`VaultTabSession`, `src/storage/vaultRepository.ts:53`) is deliberately not changed
  in this wave, so no session migration is needed. The README states that back/forward is lost
  on reload.
- Bookmarks are per vault. A corrupt bookmark record is dropped with a status message; it must
  never block loading the vault.
- Drag-to-reorder in the bookmarks panel is optional. Every reorder must also be possible from
  the keyboard (move up/down commands). Drag-only ordering fails the accessibility gate.
- Outline drag-to-rearrange sections, as Obsidian documents it
  (`en/Plugins/Outline.md`, 2026-10-21), is **out of scope** for this wave: it would mean
  rewriting note bodies.

## 4. Wave 3 — Search, tags, properties

### Outcome
The user can find a note the way they expect (operators, tags, properties) and can see the tags
and metadata of the vault as a whole.

### Scope

New:
- `src/domain/searchQuery.ts` — query parser and matcher
- `src/domain/tags.ts` — vault-wide tag index and nested tree
- `src/domain/properties.ts` — read-only frontmatter subset parser
- `src/components/TagsPanel.tsx`
- `src/components/PropertiesPanel.tsx`

Modified:
- `src/domain/vault.ts` — `searchNotes` gains a matcher path; the existing single-term
  behaviour stays the default (`src/domain/vault.ts:213-236`)
- `src/components/Search.tsx` — operator hints, sort control, result count
- `src/components/QuickSwitcher.tsx` — keeps the simple matcher (a switcher does not need
  operators)

### Interfaces

```ts
// src/domain/searchQuery.ts
export const MAX_QUERY_LENGTH = 256;
export const MAX_REGEX_LENGTH = 128;
export interface SearchOperator { name: string; value: string }
export interface PropertyFilter { key: string; value: string | null }
export interface ParsedQuery {
  text: string[];                 // plain words, AND semantics
  any: string[];                  // OR alternatives
  negative: string[];
  operators: SearchOperator[];
  properties: PropertyFilter[];
  matchCase: boolean;
  regex: string | null;
}
export function parseQuery(input: string): ParsedQuery;
export function matchesQuery(note: Note, query: ParsedQuery, ctx: { names: ReadonlySet<string> }): boolean;

// src/domain/tags.ts
export interface TagCount { tag: string; count: number }
export interface TagNode { tag: string; count: number; children: TagNode[] }
export function collectTags(vault: Vault, excluded?: ReadonlySet<string>): TagCount[];
export function tagTree(tags: TagCount[]): TagNode[];

// src/domain/properties.ts
export type PropertyValue = string | number | boolean | string[] | null;
export interface NoteProperties { raw: string; values: Record<string, PropertyValue>; valid: boolean }
export function parseProperties(body: string): NoteProperties;
```

Supported operator set, aligned with `en/Plugins/Search.md` (2026-10-21): `file:`, `path:`,
`content:`, `match-case:`, `ignore-case:`, `tag:`, `line:`, `section:`, `task:`, `task-todo:`,
`task-done:`, plus property filters `[key:value]` and `[key:null]`, `OR`, `-` negation,
parentheses, quoted phrases and `/regex/`. `block:` is deferred: it needs a block parser that
wave 4 introduces.

### RED tests
- `src/domain/searchQuery.test.ts`: `a bare word matches the title or the body`;
  `OR and negation are honoured`; `tag: matches only notes carrying that tag`;
  `a property filter matches a property value`; `a regex query matches the pattern`;
  `a dangerous regex is refused and the query degrades to literal text`;
  `a query longer than the ceiling is truncated instead of throwing`.
- `src/domain/tags.test.ts`: `a tag is counted once per note`; `nested tags build a tree`;
  `an excluded note is not counted`.
- `src/domain/properties.test.ts`: `a frontmatter block is parsed into typed values`;
  `malformed frontmatter leaves the note as plain text`; `a note without frontmatter has no
  properties`; `the raw frontmatter text is preserved byte for byte`.
- `src/components/Search.test.tsx`: `an operator query filters the list`; `the result count is
  announced`.

### Gates
`npm test` · `npm run build` · the existing search and switcher tests still pass unchanged ·
a browser proof of five operator queries · a timing note for a 500-note vault in the report
(the current implementation is O(notes x body), `src/components/Search.tsx:29-31`) ·
accessibility of the tag tree (expand and collapse must be keyboard operable) · screenshots ·
console check · independent code review.

### Dependencies
Wave 1 (the `excludedPatterns` setting) and wave 2 (the tag panel sits next to the bookmarks
panel; the outline panel defines the heading-id convention reused by the search snippets).

### Recovery and data-loss considerations
- Properties are **read-only in this wave**. There is no property write path, so parsing a note
  can never damage it. The raw frontmatter block is kept verbatim so a later write path can
  round-trip it.
- The frontmatter parser is a deliberately small subset: `key: value`, `- item` lists, numbers,
  booleans and ISO dates as strings. Nested maps, anchors and multi-line scalars are **not**
  supported and are reported as unparsed rather than guessed. Obsidian's own documentation
  states nested properties are not supported in its property view either
  (`en/Editing and formatting/Properties.md`, 2026-10-21).
- A note whose frontmatter is malformed stays fully readable and fully searchable as plain
  text. It is never dropped from the index.
- Excluded notes stay visible in the explorer and in the note tree. Exclusion hides them from
  search and the tag index only, so nothing becomes unreachable.

## 5. Wave 4 — Editing: find and replace, tasks, templates, markdown set

### Outcome
The editor can find and replace inside a note, the Markdown subset covers the syntax people
actually write, and reusable snippets can be inserted where the cursor is.

### Scope

New:
- `src/domain/findReplace.ts` — match ranges and replace
- `src/domain/templates.ts` — template discovery and rendering
- `src/domain/slashCommands.ts` — the `/` menu
- `src/components/FindBar.tsx` — inline find and replace, in the editor chrome

Modified:
- `src/domain/markdown.ts` — list items gain an optional task state; new block kinds for
  tables and callouts; new inline nodes for highlights, comments and footnotes; horizontal rule
- `src/components/Preview.tsx` — render the new syntax
- `src/components/Editor.tsx` — selection handling for find, replace and template insertion
- `src/domain/commands.ts` — `edit.find`, `edit.replace`, `note.template`, `edit.slash`

### Interfaces

```ts
// src/domain/findReplace.ts
export interface MatchRange { start: number; end: number }
export interface FindOptions { query: string; caseSensitive: boolean; regex: boolean }
export function findMatches(body: string, options: FindOptions): MatchRange[];
export function replaceAll(body: string, options: FindOptions, replacement: string): { body: string; count: number };

// src/domain/templates.ts
export const TEMPLATE_FOLDER = 'Templates';
export interface TemplateContext { title: string; now: Date }
export function listTemplates(vault: Vault): Template[];
export function renderTemplate(body: string, ctx: TemplateContext): string; // {{title}} {{date}} {{time}}
export function applyTemplate(body: string, template: string, caret: number, ctx: TemplateContext)
  : { body: string; caret: number };

// src/domain/slashCommands.ts
export interface SlashCommand { id: string; label: string; insert: string }
export function filterSlashCommands(input: string): SlashCommand[];
```

Template variables are `{{title}}`, `{{date}}`, `{{time}}` with a documented token subset
(`YYYY`, `MM`, `DD`, `HH`, `mm`), not the full Moment.js token set that Obsidian documents
(`en/Plugins/Templates.md`, 2026-10-21). The subset is stated in the UI.

Markdown syntax added, each with its own test: task list items (`- [ ]`, `- [x]`), tables,
callouts (`> [!type]`), highlights (`==text==`), comments (`%%text%%`), footnotes (`[^1]`),
horizontal rule.

### RED tests
- `src/domain/findReplace.test.ts`: `finds every literal match`; `a case sensitive query only
  matches the exact case`; `a regex query matches the pattern`; `replaceAll reports the number
  of replacements`; `an empty query matches nothing`.
- `src/domain/templates.test.ts`: `renders the title, date and time variables`;
  `a template in the Templates folder is listed`; `the template is inserted at the caret and the
  caret lands after the inserted text`; `an unknown variable is left as written`.
- `src/domain/slashCommands.test.ts`: `filters the commands by the typed prefix`; `the heading
  commands insert the expected marker`.
- `src/domain/markdown.test.ts`: `a task list item reports its checked state`;
  `a callout block reports its type and title`; `a table row is parsed into cells`;
  `a highlight is parsed as an inline node`; `a footnote reference is parsed`.
- `src/components/FindBar.test.tsx`: `the find field opens with the keyboard shortcut`;
  `Escape closes the bar and returns the focus to the editor`; `the replace action reports how
  many matches it changed`.

### Gates
`npm test` · `npm run build` · **the round-trip test**: a note that uses every supported syntax
is saved, reloaded and compared byte for byte (the parser must never rewrite the source) ·
an IME guard check so a composition is never interrupted
(`src/components/Workspace.tsx:840` already has the editable guard) · keyboard walk of the find
bar and the slash menu · screenshots · console check · independent code review.

### Dependencies
Wave 3 (`task:` search operators depend on the task parsing introduced here; the property
filter grammar is reused for the slash menu arguments).

### Recovery and data-loss considerations
- Replace-all shows the match count before it writes. The wave does **not** add a general
  undo stack; the recovery path from wave 1 (a snapshot of the body before the change) is the
  undo for a bad replace, and the README says so.
- The parser is a reader. It must never write back a normalised body, or a note written by
  another tool would be silently reformatted. The round-trip test enforces this.
- The template folder is a naming convention over existing notes (`Templates/…`), not a new
  record type. A template note is still a note and still appears in the explorer, so deleting a
  template cannot orphan a note.
- Slash commands insert literal Markdown text. No command can run code, fetch a URL or read
  the network.

## 6. Wave 5 — Files, attachments, portability

### Outcome
A note can carry an image or a file, the app can read and write a folder of Markdown files, and
the export format can grow without breaking an older export.

### Scope

New:
- `src/domain/attachments.ts` — attachment model, ceilings, embed target resolution
- `src/components/AttachmentList.tsx` — the attachments of a note, with remove and export

Modified:
- `src/storage/vaultRepository.ts` — `DB_VERSION` 3 → 4, new object store `attachments`
- `src/domain/transfer.ts` — envelope `formatVersion: 2` with attachments; the version 1 reader
  stays (`src/domain/transfer.ts:145-146`)
- `src/domain/markdown.ts` — `![[name]]` resolves to an attachment or a note
- `src/components/Preview.tsx` — render an image attachment with an object URL
- `src/components/Workspace.tsx` — paste and drop handling, export entry points
- `README.md` — the new export format and the browser limits

### Interfaces

```ts
// src/domain/attachments.ts
export interface Attachment { id: string; vaultId: string; noteId: string; name: string; mime: string; size: number; createdAt: number }
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_VAULT_ATTACHMENT_BYTES = 200 * 1024 * 1024;
export function embedTarget(raw: string): { kind: 'note' | 'attachment'; name: string } | null;

// src/domain/transfer.ts (extended)
export interface EnvelopeV2 { app: 'lattice-notes'; formatVersion: 2; notes: SerializedNote[]; attachments: { name: string; mime: string; data: string }[] }
export function serializeVault(vault: Vault, attachments: AttachmentPayload[]): string;
export function deserializeVault(json: string): Vault; // accepts version 1 and version 2
```

Envelope version 2 keeps the version 1 shape and adds an `attachments` array with base64
payloads. A version 1 envelope still imports.

### RED tests
- `src/domain/attachments.test.ts`: `an attachment over the per-file ceiling is refused with a
  reason`; `the per-vault attachment total is capped`; `an embed target names either a note or
  an attachment`.
- `src/domain/transfer.test.ts`: `a version 1 envelope still imports`; `a version 2 envelope
  round trips the notes and the attachments`; `a corrupt attachment payload is reported and does
  not abort the import`; `the existing size and count ceilings still apply`.
- `src/domain/markdown.test.ts`: `a wiki link that names an attachment is parsed as an embed`.
- `src/components/AttachmentList.test.tsx`: `an attachment can be exported and removed`.

### Gates
`npm test` · `npm run build` · a browser proof of a 5 MB image: paste, save, reload, export,
re-import · the storage-quota warning path still works and reports the attachment ceiling ·
accessibility of the attachment list · screenshots · console check · independent code review.

### Dependencies
Wave 4 (the parser must understand `![[name]]` before an embed can render) and wave 1 (the
storage warning path and the recovery export).

### Recovery and data-loss considerations
- Attachments are stored in the vault's own IndexedDB origin. Clearing site data still loses
  them. The README keeps that warning next to the export paragraph.
- Removing an attachment is a soft delete until the wave's recovery path handles it; the
  simplest safe rule is that an attachment is removed only together with an explicit confirm,
  and the attachment bytes are exported before removal.
- Import stays merge-only and never overwrites an existing note (`README.md:108-110`). The same
  rule applies to attachments: a name collision gets the usual suffix.
- Exporting as a folder of `.md` files uses the File System Access API when the browser has it
  and falls back to individual downloads when it does not. The JSON envelope stays the lossless
  path and is always offered.
- CSV and single-file HTML import are the only additional formats in this wave. The remaining
  Obsidian importers (`en/Import notes/Importer.md` and siblings, 2026-10-21) are out of scope:
  each needs a format-specific converter and a review of the data it writes.
- The deep link is `?note=<id>` with a "Copy link" action. It is inspired by the Obsidian URI
  scheme (`en/Extending Obsidian/Obsidian URI.md`, 2026-10-21) but is **not** `obsidian://`
  compatible and must not be described as such.

## 7. Wave 6 — Split layouts

### Outcome
Two notes can be read side by side, and the layout survives a reload.

### Scope

New:
- `src/domain/panes.ts` — pane and layout model, split, close, move, pin, resize

Modified:
- `src/domain/tabs.ts` and `src/storage/vaultRepository.ts` — session `version: 1` → `2` with a
  layout, plus a migration from the version 1 session
- `src/components/NoteTabs.tsx` — one tab strip per pane
- `src/components/Workspace.tsx` — the pane container and the resize handles
- `src/domain/commands.ts` — `pane.splitRight`, `pane.splitDown`, `pane.close`,
  `pane.focusNext`, `tab.pin`, `view.source`, `view.preview`, `view.both`

The existing `ViewMode` values `write | split | read` are renamed to `source | preview | both`
in this wave, because "split" would otherwise mean two different things
(`src/domain/commands.ts:11`). The rename touches the command catalog, the palette labels, the
workspace markup and their tests.

### Interfaces

```ts
// src/domain/panes.ts
export interface PaneState { id: string; kind: 'note' | 'linked'; tabIds: string[]; activeTabId: string | null; linkedNoteId: string | null }
export interface LayoutState { panes: PaneState[]; activePaneId: string }
export function splitPane(layout: LayoutState, direction: 'right' | 'down', noteId?: string): LayoutState;
export function closePane(layout: LayoutState, paneId: string): LayoutState;
export function moveTab(layout: LayoutState, tabId: string, toPaneId: string, index: number): LayoutState;
export function pinTab(layout: LayoutState, tabId: string, pinned: boolean): LayoutState;
export function clampSize(size: number, min: number, max: number): number;
```

### RED tests
- `src/domain/panes.test.ts`: `splitting adds a second pane`; `closing a pane returns the
  layout to one pane`; `moving a tab between panes keeps both panes valid`;
  `a pinned tab is not replaced when the active note closes`; `the size is clamped to the
  minimum and the maximum`.
- `src/storage/vaultRepository.test.ts`: `a version 1 session migrates to a version 2 layout
  with one pane`; `a broken version 2 session falls back to a single pane without losing the
  notes`.
- `src/components/NoteTabs.test.tsx`: `each pane renders its own tabs`.
- `src/domain/commands.test.ts`: `the catalog contains the pane commands and the renamed view
  commands`.

### Gates
`npm test` · `npm run build` · 1440×900 screenshot of a two-pane layout · 390×844 screenshot of
the single-pane fallback · keyboard walk: split, move focus between panes, resize with the
keyboard, close a pane and land the focus somewhere useful · a reload keeps the layout ·
console check · independent code review.

### Dependencies
Wave 2 (history and the outline panel are the natural linked views) and wave 4 (the view mode
rename touches the same command catalog).

### Recovery and data-loss considerations
- The session migration is the only schema change. A version 1 session becomes one pane with
  the same open notes. A version 2 session that cannot be parsed falls back to a single pane,
  keeping the notes it can read — the rule that already applies to a broken session
  (`src/storage/vaultRepository.ts:120`).
- Closing a pane never closes a note. Closing the last tab of a pane closes the pane, not the
  note.
- Below the compact breakpoint the layout collapses to one pane with a pane switcher. The
  layout is saved, not lost.
- Resizing must be possible from the keyboard. A drag-only resize fails the accessibility
  gate.

## 8. Wave 7 — Boundaries: canvas, bases, sync, plugins

No code in this wave. It records decisions so the gaps are not rediscovered every quarter.

| Area | Decision | Reason | What it would take to revisit it |
|---|---|---|---|
| Obsidian Canvas | **Not planned** | An infinite board with cards, connections, groups and an export format is a second document model, not a feature. The 3D graph (`src/components/GraphView.tsx:634`) is a view of the link graph and is not a Canvas substitute. | A native board document type, a keyboard-complete interaction model, and an export format that survives a round trip. |
| Bases | **Deferred**, not declined | Property-driven tables, cards, kanban and map views with filters, sorts, groups, formulas and functions (`en/Bases/Introduction to Bases.md`, 2026-10-21) are a query language plus a view system. | Wave 3's property model must be stable and in use first, then a scoped filter and formula language. |
| Sync | **Out of scope** under the product constraints | The product is local-first with no account, no server and no upload (`README.md:3-5`, `README.md:176-177`). | Only a change to those constraints, which is a product decision, not a feature request. Export and import stay the portability boundary. |
| Plugin system | **Out of scope** | A plugin runtime implies an extension API, a permission model, sandboxing and a review process (`en/Extending Obsidian/Plugin security.md`, 2026-10-21). This app has no third-party code path and must not grow one silently. | A written security model and a review process would come first. |
| Obsidian Publish, Web Clipper, Obsidian CLI, Obsidian Headless | **Out of scope** | Each requires an Obsidian installation or a hosted service (`en/Obsidian Publish/*.md`, `en/Obsidian Web Clipper/*.md`, `en/Extending Obsidian/Obsidian CLI.md`, `en/Extending Obsidian/Obsidian Headless.md`, 2026-10-21). | A hosted or local service, which the product constraints forbid. |
| Theming, custom hotkeys, ribbon, pop-out windows | **Deferred** | Personalization is cheap to add and easy to over-build. The app keeps one editorial theme and code-owned shortcuts until a wave says otherwise. | A settings wave that treats them as first-class. |

Two rules follow from this table and apply to every wave:

1. No wave may quietly grow into one of these areas. A change that needs a plugin, a server or
   an account is out of scope and is raised as a product decision instead.
2. The README keeps an honest "not full application parity" statement and gains a short
   "What Lattice Notes does not do" list, maintained from this table.

## 9. Cross-wave checklist

For every wave, before it is called done:

- [ ] RED tests written first and observed failing for the right reason
- [ ] `npm test` and `npm run build` pass under the shared flock, after a `df -h /` check
- [ ] The existing test suite still passes without editing its expectations, except where the
      wave states a deliberate rename (wave 6 renames the view modes)
- [ ] Migration test from the previous storage version, when the wave touches storage
- [ ] No data-loss path without a confirm and a recovery route
- [ ] Desktop 1440×900 and mobile 390×844 screenshots inspected
- [ ] Browser console clean
- [ ] Keyboard walk of every new control, no drag-only or hover-only interaction
- [ ] Accessibility check on the new surfaces
- [ ] Independent code review of the wave, blocking findings fixed and re-checked
- [ ] `README.md` updated: features, limits, recovery, and the honest non-parity statement
- [ ] Evidence recorded under `.superpowers/sdd/2026-10-21-<wave>/`
- [ ] The uncommitted identity and navigation work is still present and untouched

## 10. Open questions for the next session

1. **Undo.** The wave 4 find and replace has no undo of its own and leans on the wave 1
   snapshot. Is that acceptable, or should a body undo stack ship with it? Decision needed
   before wave 4 starts.
2. **Theme scope.** `AppSettings.theme` is in wave 1. If only `light` and `system` are ever
   shipped, `dark` is a speculative field and should be dropped from wave 1.
3. **Excluded patterns syntax.** Glob or plain substring? The settings label must state which.
4. **Session format owner.** Wave 2 declines to change the session document and wave 6 changes
   it. If a wave in between needs to persist anything, the session version bumps once, in wave 6
   and not before.
