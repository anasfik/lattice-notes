# Feature gap research: Lattice Notes against the public Obsidian documentation

- Date: 2026-10-21
- Kind: research only. No product source was edited, no commit was made, no child agent was spawned.
- Companion plan: `docs/superpowers/plans/2026-10-21-feature-roadmap.md`
- Observed state was read in this worktree on branch `feature/lattice-notes-mvp`, which carries uncommitted identity/navigation work in progress. That dirty work was left untouched.

## 1. Purpose and non-goals

This document compares two things:

1. what Lattice Notes actually does today, read from the source in this repository, and
2. what the official Obsidian documentation describes for core plugins, editor features and settings.

It ends with a gap matrix that a roadmap can be built from.

**This is not a parity claim, and it must never be read as one.** Lattice Notes is an independent,
browser-only, local-first Markdown workspace: notes live in IndexedDB, there is no account, no
server, no filesystem vault and no plugin runtime. Obsidian is a desktop and mobile application
with a filesystem vault, an optional account-based Sync service, a hosted Publish product and a
third-party plugin ecosystem. The matrix records where Lattice Notes is narrower, differently
shaped, or missing. The README already states the boundary honestly: "This is an original browser
workspace, not full application parity" (`README.md:176-177`).

## 2. Method, evidence rules and limits

### 2.1 Evidence classes

Every statement in this document is labelled with one of three classes:

| Class | Meaning | How it is cited |
|---|---|---|
| **Observed** | Read directly from this repository's source at the given location. | `file:line` in this worktree |
| **Documented** | Read from the official Obsidian help documentation. | Page title, published permalink when observed, repository path, retrieval date |
| **Inferred** | A judgement derived from the two above. Not a fact about either product. | Labelled "Inferred" in the row |

### 2.2 Rules applied

- Every Obsidian claim cites a page of the official help documentation and the retrieval date
  (2026-10-21).
- Every Lattice Notes claim cites `file:line`.
- Absence claims were produced by repository-wide greps over `src/**/*.ts` and `src/**/*.tsx`,
  not by reading one file. The grep results and their known false positives are listed in 2.5.
- No Obsidian application bundle was executed, decompiled, or copied into this project or this
  document. Nothing about Obsidian behaviour is asserted from memory or from a binary.

### 2.3 REA status (explicit)

- The initial retained REA evidence inventory was empty. Subsequently the user identified an
  AppImage; `/home/gwhyyy/.local/bin/Obsidian.AppImage` was inspected statically. See
  [artifact evidence](2026-10-21-obsidian-artifact-evidence.md) for its SHA-256 and REA Evidence IDs.
- That inspection established only the ELF launcher identity: one artifact node, no child
  inventory. It did **not** establish the application version, packaged features or runtime
  behaviour. The proprietary bundle was not executed, extracted or copied.
- Every Obsidian statement below comes from **public official documentation only**. Where this
  document describes behaviour that the documentation does not state (for example the exact
  default of a setting), the row is marked *Inferred* or the point is omitted.

### 2.4 Sources

The Obsidian help site content is published from the public `obsidianmd/obsidian-help` repository.
The pages were read as raw Markdown from that repository on **2026-10-21**, from branch `master`,
whose tree object SHA was observed as `cd6c9f3c7d5492bbbec94e8f403572b84eeb325b`
(`git/trees/master?recursive=1`). Per-commit permalinks were **not** resolved in this bounded
pass, so the stable form used below is `raw.githubusercontent.com/.../master/...`; the tree SHA is
recorded so a reader can pin the exact revision if needed.

| Obsidian help page | Repository path (`en/…`) | Published permalink | Retrieved |
|---|---|---|---|
| Core plugins | `Plugins/Core plugins.md` | `https://help.obsidian.md/plugins` | 2026-10-21 |
| Search | `Plugins/Search.md` | `https://help.obsidian.md/plugins/search` | 2026-10-21 |
| Outline | `Plugins/Outline.md` | `https://help.obsidian.md/plugins/outline` | 2026-10-21 |
| Bookmarks | `Plugins/Bookmarks.md` | `https://help.obsidian.md/plugins/bookmarks` | 2026-10-21 |
| Properties view | `Plugins/Properties view.md` | `https://help.obsidian.md/plugins/properties` | 2026-10-21 |
| Templates | `Plugins/Templates.md` | `https://help.obsidian.md/plugins/templates` | 2026-10-21 |
| Daily notes | `Plugins/Daily notes.md` | `https://help.obsidian.md/plugins/daily-notes` | 2026-10-21 |
| Backlinks | `Plugins/Backlinks.md` | `https://help.obsidian.md/plugins/backlinks` | 2026-10-21 |
| File recovery | `Plugins/File recovery.md` | `https://help.obsidian.md/plugins/file-recovery` | 2026-10-21 |
| Tags view | `Plugins/Tags view.md` | `https://help.obsidian.md/plugins/tags` | 2026-10-21 |
| Workspaces | `Plugins/Workspaces.md` | `https://help.obsidian.md/plugins/workspaces` | 2026-10-21 |
| Properties | `Editing and formatting/Properties.md` | `https://help.obsidian.md/properties` | 2026-10-21 |
| Workspace | `User interface/Workspace.md` | `https://help.obsidian.md/workspace` | 2026-10-21 |
| Tabs | `User interface/Tabs.md` | `https://help.obsidian.md/tabs` | 2026-10-21 |
| Status bar | `User interface/Status bar.md` | `https://help.obsidian.md/status-bar` | 2026-10-21 |
| Settings | `User interface/Settings.md` | permalink not observed in this pass | 2026-10-21 |
| More options menu | `User interface/More options menu.md` | permalink not observed in this pass | 2026-10-21 |
| Editor / formatting set | `Editing and formatting/*.md` | permalinks not observed in this pass | 2026-10-21 |
| Canvas | `Plugins/Canvas.md` | permalink not observed in this pass | 2026-10-21 |
| Bases | `Bases/Introduction to Bases.md`, `Bases/*.md` | permalinks not observed in this pass | 2026-10-21 |
| Sync | `Obsidian Sync/*.md` | permalinks not observed in this pass | 2026-10-21 |
| Community plugins, Plugin security | `Extending Obsidian/Community plugins.md`, `Extending Obsidian/Plugin security.md` | permalinks not observed in this pass | 2026-10-21 |
| Obsidian URI / CLI / Headless | `Extending Obsidian/Obsidian URI.md`, `Extending Obsidian/Obsidian CLI.md`, `Extending Obsidian/Obsidian Headless.md` | permalinks not observed in this pass | 2026-10-21 |
| Importer | `Import notes/Importer.md` and siblings | permalinks not observed in this pass | 2026-10-21 |

### 2.5 Absence greps

Repository-wide greps over `src/**/*.ts` and `src/**/*.tsx` for the feature words below.
False positives are named so the rows are not overclaimed.

| Grep term | Result in product code | False positives noted |
|---|---|---|
| `history` | no hits | — |
| `bookmark` | no hits | — |
| `outline` | one hit in `src/storage/vaultRepository.ts` | not a heading list view |
| `frontmatter`, `yaml` | no hits | — |
| `template` | no hits | — |
| `checkbox` | no hits | — |
| `task` | one hit in `src/storage/vaultRepository.test.ts` | not a task feature |
| `attachment`, `embed` | no hits | — |
| `canvas` | `src/components/GraphView.tsx:634` | CSS class of the 3D graph surface, not Obsidian Canvas |
| `sync` | hits only inside `async` | substring artefact |
| `property` | hits only in `*.test.tsx` files | DOM properties, not note properties |
| `tag` | `src/domain/markdown.ts`, `src/components/Preview.tsx` | present feature (per-note parsing) |
| `trash` | `src/domain/vault.ts`, `src/components/Explorer.tsx` | present feature (soft delete) |

## 3. What Lattice Notes does today (Observed)

| Area | Observed behaviour | Evidence |
|---|---|---|
| Storage | One IndexedDB database `lattice-notes` at version 1, one object store `vault`, one catalog key; each vault is one whole document. | `src/storage/vaultRepository.ts:19-26`, `:101`, `:527` |
| Vaults | Named browser-local vaults, create/rename/archive/restore; no filesystem access. | `src/storage/vaultRepository.ts:143-171`, `:231-283`; `README.md:7`, `README.md:36-38` |
| Notes | `Note { id, name, body, createdAt, updatedAt, deletedAt }`. No properties, no attachments, no aliases, no per-note metadata beyond timestamps. | `src/domain/types.ts:9-20` |
| Delete | Soft delete kept in the vault for undo; restore re-names if the name was taken. | `src/domain/vault.ts:183-210`; `src/components/Explorer.tsx:274-287` |
| Folders | Virtual groups from `/` in the note name; no folder records; empty folders are not stored. | `README.md:46-48`; `src/components/Explorer.tsx:3`, `:71`, `:147-149` |
| Editor | One plain `<textarea>`, spellcheck disabled, no formatting widget, no find/replace, no multi-cursor, no folding. | `src/components/Editor.tsx:25-33` |
| Rendering | Own safe Markdown parser; never produces HTML; ATX headings, paragraphs, unordered/ordered lists, quotes, fenced code, emphasis/strong/inline code, `http`/`https`/`mailto`/relative links, wiki links with alias and heading, `#tags`, backslash escapes. | `src/domain/markdown.ts:50-56`, `:95-192`; `README.md:126-145` |
| Wiki links | `[[note]]`, `[[note|alias]]`, `[[note#heading]]`; unresolved links can create the target. No block refs, no embeds, no aliases property. | `src/domain/markdown.ts:340-353`; `src/components/ContextRail.tsx:90-104` |
| Tags | Per-note tags parsed, lowercased, de-duplicated, rendered as spans. No vault-wide index, no counts, no tag panel. | `src/domain/markdown.ts:77-83`, `:275-286`; `src/components/Preview.tsx:153-155` |
| Links context | Backlinks (linked mentions only) and outgoing links shown in the right rail; both derived from the local graph. | `src/components/ContextRail.tsx:45-50`, `:83-110`; `src/domain/vault.ts:243-306` |
| Graph | Contextual local graph plus a fullscreen 2D/3D graph, capped at 300 notes, with orbit/pan/zoom/fit/reset and a keyboard-operable list. | `README.md:53-56`; `src/components/GraphView.tsx` |
| Search | Substring, case-insensitive, title first then body, one snippet per hit; the switcher reuses it; no operators, no regex, no sort, no property search, no excluded files. | `src/domain/vault.ts:213-236`; `src/components/Search.tsx:31`; `src/components/QuickSwitcher.tsx:62-67` |
| Commands | One catalog of 22 actions, shared by toolbar, shortcuts and palette; a disabled command keeps a reason and does nothing. | `src/domain/commands.ts:77-231` |
| Command palette | Substring filter over label and category; no fuzzy ranking, no pinned commands. | `src/components/CommandPalette.tsx:39-46` |
| Quick switcher | Opens and lists notes, reusing `searchNotes`, capped result list. | `src/components/QuickSwitcher.tsx:55-71` |
| Daily notes | Fixed `YYYY-MM-DD` local civil date, reuses the note of that day, body seeded with a level-1 heading. | `src/domain/dailyNotes.ts:28-51`, `:77-93` |
| View modes | `write`, `split`, `read` — one note shown as source, source+preview, or preview only. | `src/domain/commands.ts:11`; `src/components/Workspace.tsx:792-806` |
| Layout | One left sidebar (notes, search, create), one right context rail, one content area, one flat tab strip. No tab groups, no multi-pane, no saved layouts. | `src/components/Workspace.tsx:537-812`; `src/components/NoteTabs.tsx:42-68` |
| Status line | A single status message (announcements and warnings). No backlinks count, no mode, no word count in the bar. | `src/components/Workspace.tsx:735-741` |
| Theme | One editorial light theme from CSS custom properties. No theme picker, no font settings, no dark mode. | `src/styles.css:78-88` |
| Import/export | `.md`, `.markdown`, `.txt` files and a JSON envelope (`formatVersion: 1`); merge-only, never overwrites; explicit size and count ceilings reported in the status line. | `src/domain/transfer.ts:14-26`, `:57-67`, `:145-146`; `README.md:103-124` |
| Offline shell | Hand-written service worker with a build-time precache list. | `README.md:147-162` |
| Recovery | Undo of a delete only. No snapshot history, no version restore, no diff. | `src/domain/commands.ts:111-116`; `src/App.tsx:584-610` |

## 4. Gap matrix

Status vocabulary: **Present** (same capability in the same shape), **Partial** (a narrower
version of the documented capability exists), **Absent** (no equivalent observed),
**Different** (a deliberate, documented divergence, not a defect).

| # | Area | Obsidian (Documented) | Lattice Notes (Observed) | Status |
|---|---|---|---|---|
| 1 | Core plugin surface | 30 core plugins are listed, including Audio recorder, Backlinks, Bases, Bookmarks, Canvas, Command palette, Daily notes, File explorer, File recovery, Footnotes view, Graph view, Note composer, Outgoing links, Outline, Page preview, Properties view, Publish, Quick switcher, Random note, Search, Slash commands, Slides, Sync, Tags view, Templates, Unique note creator, Web viewer, Word count, Workspaces (`en/Plugins/Core plugins.md`, 2026-10-21). | 22 application commands and no plugin system; the closest equivalents are the palette, switcher, search, daily notes, backlinks, graph and word count in the context rail. (`src/domain/commands.ts:77-231`) | Different |
| 2 | Markdown subset | Headings, bold/italic, **highlights**, links, quotes, lists incl. **task lists**, horizontal rule, code, **footnotes**, **comments** (`en/Editing and formatting/Basic formatting syntax.md`, 2026-10-21); **tables**, diagrams, math (`Advanced formatting syntax.md`). | Headings, paragraphs, lists, quotes, fenced code, emphasis/strong/inline code, links, wiki links, tags, escapes (`src/domain/markdown.ts:50-56`). No tables, task checkboxes, highlights, footnotes, comments, callouts, math, diagrams, horizontal rule. | Partial |
| 3 | Editing views | Reading view, Editing view with Live Preview and Source mode (`en/Editing and formatting/Views and editing mode.md`, 2026-10-21). | `write` (source) / `split` (source + preview) / `read` (preview). The write view is already plain source; there is no live-preview rendering of inline markup. (`src/domain/commands.ts:11`; `src/components/Workspace.tsx:792-806`) | Partial |
| 4 | Find and replace | In-note find and replace (`en/Editing and formatting/Find and replace.md`, 2026-10-21). | Absent; the editor is a plain textarea with no find UI (`src/components/Editor.tsx:25-33`). | Absent |
| 5 | Multiple cursors / rectangular selection | Documented (`en/Editing and formatting/Multiple cursors.md`, 2026-10-21). | Absent; single textarea, no selection API use. | Absent |
| 6 | Folding | Documented, including "Fold heading" (`en/Editing and formatting/Folding.md`, `en/User interface/Settings.md`, 2026-10-21). | Absent. | Absent |
| 7 | Slash commands | Documented (`en/Plugins/Slash commands.md`, 2026-10-21). | Absent. | Absent |
| 8 | Search language | Terms with AND/OR, negation `-`, parentheses, quoted phrases; operators `file:`, `path:`, `content:`, `match-case:`, `ignore-case:`, `tag:`, `line:`, `block:`, `section:`, `task:`, `task-todo:`, `task-done:`; property search `[key:value]` and `[key:null]`; regex `/…/`; sort orders; "Explain search term"; excluded files (`en/Plugins/Search.md`, 2026-10-21). | Substring, case-insensitive, title-then-body, one snippet (`src/domain/vault.ts:213-236`); no operators, no property search, no regex, no sort, no excluded files; O(notes × body) by design (`src/components/Search.tsx:29-31`). | Partial |
| 9 | Tags | Nested tags, tag format rules (`en/Editing and formatting/Tags.md`); Tags view with counts, nested tree, sort by name/frequency, expand/collapse, click to search (`en/Plugins/Tags view.md`, 2026-10-21). | Tags parsed per note and rendered as spans (`src/domain/markdown.ts:275-286`; `src/components/Preview.tsx:153-155`); no vault-wide index, no counts, no panel. | Partial |
| 10 | Properties (YAML frontmatter) | Properties with types text/list/number/checkbox/date/date-time/tags; add and rename properties; display modes Visible/Hidden/Source; explicitly **not** supported: nested properties, bulk editing, Markdown in properties (`en/Editing and formatting/Properties.md`, 2026-10-21); Properties view for file properties and all properties with their type (`en/Plugins/Properties view.md`, 2026-10-21). | Absent: no frontmatter parsing, no property types, no property views (`grep frontmatter|yaml` → no hits; `src/domain/types.ts:9-20` has no metadata field). | Absent |
| 11 | Backlinks | Linked **and unlinked** mentions, collapse results, more context, sort order, a mention filter, backlinks in document, linked backlinks tab (`en/Plugins/Backlinks.md`, 2026-10-21). | Linked mentions only, derived from the local graph, listed without context or sorting (`src/components/ContextRail.tsx:45-50`; `src/domain/vault.ts:300-305`). | Partial |
| 12 | Outgoing links | Dedicated core plugin and tab (`en/Plugins/Outgoing links.md`, 2026-10-21). | Outgoing links are a section of the context rail (`src/components/ContextRail.tsx:83-110`). | Present (different placement) |
| 13 | Outline | Table of contents of the active note, click to jump, drag to rearrange (`en/Plugins/Outline.md`, 2026-10-21). | Absent as a view; the heading data already exists in the parser (`src/domain/markdown.ts:67`). | Absent (data present) |
| 14 | Bookmarks | Bookmark files, folders, graphs, searches, headings, blocks and links; groups; drag reorder; multi-select; per-item edit dialog (`en/Plugins/Bookmarks.md`, 2026-10-21). | Absent (`grep bookmark` → no hits). | Absent |
| 15 | Navigation history | "Open version history" in the note menu, documented as requiring an active Sync subscription (`en/User interface/More options menu.md`, 2026-10-21); Obsidian Sync also keeps a version history (`en/Obsidian Sync/Version history.md`, 2026-10-21). | Absent: no back/forward stack, no recent-notes list. The tab session stores only open note ids (`src/storage/vaultRepository.ts:53`). | Absent |
| 16 | Workspaces and layout | Saved layouts with open files, tabs and sidebar widths (`en/Plugins/Workspaces.md`, 2026-10-21); tab groups, split right/down, resize, pin, stack, linked views, pop-out windows (`en/User interface/Tabs.md`; `en/User interface/Workspace.md`, 2026-10-21). | One flat tab strip (`src/components/NoteTabs.tsx:42-68`), one content area (`src/components/Workspace.tsx:792`), two collapsible side panels (`src/components/Workspace.tsx:166-167`), no saved layouts. | Partial |
| 17 | Command palette | Search commands, **pinned** commands (`en/Plugins/Command palette.md`, 2026-10-21). | Substring filter over the fixed catalog (`src/components/CommandPalette.tsx:39-46`); no pinning, no fuzzy ranking, no custom commands. | Partial |
| 18 | Quick switcher | Search, create and open notes from the keyboard (`en/Plugins/Quick switcher.md`, 2026-10-21). | Opens and lists existing notes via `searchNotes`; no create-on-the-fly, no fuzzy ranking (`src/components/QuickSwitcher.tsx:62-71`). | Partial |
| 19 | Daily notes | Name from the date, configurable new-file location, date format with automatic subfolders, optional template, date property becomes a link (`en/Plugins/Daily notes.md`, 2026-10-21). | Fixed `YYYY-MM-DD` local date, reuses the day's note, no template hook, no location or format setting (`src/domain/dailyNotes.ts:28-51`, `:77-93`). | Partial |
| 20 | Templates | Template folder, `{{title}}` / `{{date}}` / `{{time}}` with Moment.js format strings, insert at cursor, property merge on insert (`en/Plugins/Templates.md`, 2026-10-21). | Absent (`grep template` → no hits). | Absent |
| 21 | File explorer and trash | File explorer plus trash settings: confirm deletion, move to system trash, deleted-file retention (`en/User interface/Settings.md`; `en/Files and folders/Manage notes.md`, 2026-10-21). | Virtual folder tree with soft delete and a restore list; no permanent delete, no retention policy, no confirmation dialog (`src/components/Explorer.tsx:274-287`; `src/domain/vault.ts:183-210`). | Partial |
| 22 | File recovery | Periodic snapshots (default minimum 5 minutes apart, kept 7 days), restore with change diff, clear history, `.md` and `.canvas` only, snapshots are device-local (`en/Plugins/File recovery.md`, 2026-10-21). | Absent: no snapshot store, no restore, no diff (`grep` for snapshot/history → no hits). | Absent |
| 23 | Excluded files | Glob patterns excluded from search and unlinked mentions (`en/User interface/Settings.md`, 2026-10-21). | Absent. | Absent |
| 24 | Attachments and embeds | Attach a file, choose a default attachment location (`en/Editing and formatting/Attachments.md`); embed notes, images, audio, PDF, canvas, a list and search results (`en/Linking notes and files/Embed files.md`); accepted file formats (`en/Files and folders/Accepted file formats.md`), all 2026-10-21. | Absent: no binary storage, no attachment list, no embed rendering. `![[image.png]]` parses only as a wiki link to the name `image.png` (`src/domain/markdown.ts:340-353`). | Absent |
| 25 | Vault layout and portability | A vault is a folder of Markdown files on disk; vault management includes create, rename, move and remove (`en/Files and folders/How Obsidian stores data.md`; `en/Files and folders/Manage vaults.md`, 2026-10-21). | A vault is one IndexedDB document; the portable boundary is a JSON envelope (`src/storage/vaultRepository.ts:101`; `src/domain/transfer.ts:57-67`). Deliberate divergence from the product constraints, but it leaves a real portability gap. | Different (gap) |
| 26 | Importers | 15+ source formats (Notion, Evernote, HTML, CSV, Apple Notes, Logseq, Roam, Textbundle, …) (`en/Import notes/Importer.md` and siblings, 2026-10-21). | `.md`, `.markdown`, `.txt` and the JSON envelope only (`src/domain/transfer.ts:14-26`). | Partial |
| 27 | Bases | Property-driven views: table, list, cards, kanban, map, with filters, sorts, groups, formulas and functions (`en/Bases/Introduction to Bases.md`; `en/Bases/Views.md`; `en/Bases/Formulas.md`; `en/Bases/Functions.md`, 2026-10-21). | Absent; depends on properties (row 10). | Absent (deferred) |
| 28 | Canvas | Infinite board with cards from notes, media, web pages, bases and folders; connections with labels and direction; groups; zoom to fit/selection; export as image (`en/Plugins/Canvas.md`, 2026-10-21). | Absent. The `canvas` identifier in the code is the 3D graph surface (`src/components/GraphView.tsx:634`). | Absent (deferred) |
| 29 | Sync | Encrypted end-to-end sync, selective sync, version history, shared vaults, headless sync (`en/Obsidian Sync/*.md`, 2026-10-21). | Absent by product constraint: "No sync, plugins or filesystem vaults" (`README.md:176-177`). | Different (declared out of scope) |
| 30 | Plugins and plugin security | Community plugin store, install/update/uninstall, restricted mode, plugin capabilities, review process (`en/Extending Obsidian/Community plugins.md`; `en/Extending Obsidian/Plugin security.md`, 2026-10-21). | Absent: no plugin runtime, no extension API, no third-party code path. | Different (declared out of scope) |
| 31 | Publish, Web Clipper, CLI, Headless | Hosted publishing, a browser clipper, a local CLI and a headless service (`en/Obsidian Publish/*.md`; `en/Obsidian Web Clipper/*.md`; `en/Extending Obsidian/Obsidian CLI.md`; `en/Extending Obsidian/Obsidian Headless.md`, 2026-10-21). | Absent. All four need an Obsidian installation or a hosted service. | Different (declared out of scope) |
| 32 | Editor chrome and personalization | Ribbon, custom themes, fonts, translucency, CSS snippets, custom hotkeys with non-US layout support, status bar items, drag and drop (`en/User interface/Ribbon.md`; `Appearance.md`; `Extending Obsidian/CSS snippets.md`; `User interface/Hotkeys.md`; `User interface/Status bar.md`; `User interface/Drag and drop.md`, all 2026-10-21). | A toolbar and an app menu instead of a ribbon; one theme; fixed shortcuts in code (`src/domain/commands.ts:86`); a single-message status line (`src/components/Workspace.tsx:736-741`); no drag and drop. | Partial |
| 33 | Small core plugins not yet covered | Audio recorder, Footnotes view, Note composer (merge/extract), Page preview (hover preview), Random note, Slides, Unique note creator, Web viewer, Format converter, Word count (`en/Plugins/Core plugins.md`, 2026-10-21). | Word count is present in the context rail details (`src/components/ContextRail.tsx:147-148`); the rest are absent. Random note and unique note creator are cheap additions on top of the existing daily-note naming. | Mostly absent |
| 34 | Obsidian URI | `obsidian://` scheme with `open`, `new`, `daily`, `search` and `vault` actions and x-callback-url support (`en/Extending Obsidian/Obsidian URI.md`, 2026-10-21). | Absent. A `?note=` deep link is a cheap, compatible-in-spirit alternative, but it would not be an `obsidian://` implementation. | Absent |
| 35 | Undo / redo | Obsidian documents its own undo behaviour inside the editor and in note actions; the help set reviewed here does not define a separate undo-history plugin. | Undo exists only for a delete (`src/domain/commands.ts:111-116`). No general undo/redo stack. | Partial (see Inference below) |

### 4.1 Inferences worth recording

- **Inferred:** the highest-value gaps for a local-first browser app are the ones that increase
  *findability* and *recoverability* (rows 8, 9, 10, 13, 14, 15, 22, 23), because they add state
  that is cheap to keep local and expensive to lose. Row 25 (portability) matters for the same
  reason: the current export is a custom JSON envelope, not Markdown files.
- **Inferred:** rows 27 and 28 (Bases, Canvas) are large products, not features. Both need a
  document model Lattice Notes does not have (property-driven records, an embedded canvas file
  format). They are the right candidates for an explicit "not planned" decision rather than a
  roadmap slot.
- **Inferred:** row 35 is listed as Partial because the reviewed help set does not document a
  general undo history for Obsidian either; Lattice Notes' own undo is delete-only by design
  (`src/domain/commands.ts:111-116`). No parity claim is made here either way.
- **Inferred:** rows 16 and 6 (layouts, folding) are the most invasive per unit of value, because
  they touch the session format and the editor's text model respectively. They belong late.

## 5. Coverage summary

Counting the 35 rows above by status:

| Status | Count | Rows |
|---|---|---|
| Different (declared divergence) | 4 | 1, 25, 29, 30 |
| Present (placement differs) | 1 | 12 |
| Partial | 13 | 2, 3, 8, 9, 11, 16, 17, 18, 19, 21, 26, 32, 35 |
| Absent (of which 27, 28 deferred and 29-31 declared out of scope) | 17 | 4, 5, 6, 7, 10, 13, 14, 15, 20, 22, 23, 24, 27, 28, 31, 33, 34 |

No row is a complete match of the documented Obsidian behaviour, and none is intended to be.
The realistic target is not parity; it is a documented subset with honest limits.

## 6. Uncertainty and limits of this research

1. **No shipped-app evidence.** As stated in 2.3: no fresh REA artifact, no bundle execution, no
   binary inspection. Everything about Obsidian here is documentation-derived.
2. **Default values.** Only the defaults that the documentation itself states were recorded
   (for example the file-recovery 5-minute/7-day defaults). Other defaults are unknown to this
   document and are not guessed.
3. **Documentation coverage.** The help repository is the published documentation, not the
   product. Some behaviour (mobile-only differences, early-access features, mobile app pages)
   was reviewed only in the pages listed in 2.4. Mobile parity was not assessed: Lattice Notes
   is a responsive web app, and the Obsidian mobile app is a separate product surface.
4. **Version drift.** The Obsidian help repository is a moving target; every citation carries the
   retrieval date and the branch, so a later reader can tell what was read.
5. **Lattice Notes inventory** reflects this worktree only, including uncommitted work in
   progress. It was not re-verified against a clean checkout.
6. **Not assessed:** performance, accessibility conformance of Obsidian, licensing of the
   Obsidian help content, and any behaviour that only exists in a plugin.

## 7. What this document does not do

- It does not propose product behaviour; the wave plan does that, in
  `docs/superpowers/plans/2026-10-21-feature-roadmap.md`.
- It does not change any source file, dependency, setting or storage format.
- It does not claim that Lattice Notes should match Obsidian, or that it does.
