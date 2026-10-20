# Lattice Notes

A local-first Markdown workspace that runs entirely in the browser. Notes are
plain Markdown, they live in this browser's IndexedDB, and nothing is uploaded
anywhere: no account, no server, no telemetry.

- Linked notes with `[[wiki links]]`, backlinks, and a local link graph
- Full text search over titles and bodies
- Import from Markdown files and export to a readable JSON envelope
- Installable, offline capable: the app shell is precached by a service worker

## Architecture

| Part | What it is | Where it runs |
|---|---|---|
| UI | React 19 + TypeScript, built by Vite | browser |
| Notes | Plain Markdown text | browser |
| Storage | One versioned document in IndexedDB (`lattice-notes` / `vault` / `current`) | browser |
| Offline shell | A hand written service worker with a build time precache list | browser |

The whole application is static files. There is no backend, no API key and no
account. The vault is written to IndexedDB about 200 ms after the last edit.
If IndexedDB cannot be read, the app keeps working in memory and shows a
warning instead of overwriting anything.

## Running it locally

```bash
npm install        # once
npm run dev        # development server on http://127.0.0.1:5173
npm test           # the whole test suite (vitest, jsdom, fake-indexeddb)
npm run build      # type check and production build into dist/
npm run preview    # serve the production build on http://127.0.0.1:4173
```

The development server never registers the service worker, so the offline shell
only exists in a production build. Use `npm run preview` to try the offline
behaviour.

## Import and export

**Export vault** writes the notes of the current tab to
`lattice-notes-vault.json`. The export is made from the in-memory vault, never
from a re-read of the storage, so it also works while the storage warning is
showing and the notes of the tab can be rescued before the recovery path
replaces an unreadable vault.

The envelope is plain JSON and stays readable without this app:

```json
{
  "app": "lattice-notes",
  "formatVersion": 1,
  "notes": [
    {
      "name": "Getting started",
      "body": "# Getting started\n\n…",
      "createdAt": "2026-10-20T07:00:00.000Z",
      "updatedAt": "2026-10-20T07:00:00.000Z"
    }
  ]
}
```

Only active notes are exported, sorted by name. Internal ids are not part of
the format: an import gives every note a fresh id.

**Import Markdown** accepts `.md`, `.markdown`, `.txt` and the JSON envelope in
one selection. The file extension decides the path: `.json` is read as an
envelope, every other accepted extension is read as one Markdown note per file
(with the extension stripped from the note name). Anything else is skipped.

Import always merges. An existing note is never overwritten, erased or
truncated; a colliding name gets the usual `Name 2` suffix. The result is
announced in the status line, including what was skipped and why:

| Limit | Value | Reported as |
|---|---|---|
| Markdown file size | 1 MiB (1,048,576 bytes) per file | `too large` |
| Markdown files per selection | 500 | `over the batch limit` |
| JSON envelope size | 50 MiB (52,428,800 bytes) | `too large` |
| Notes in a JSON envelope | 20,000 | `over the batch limit` |
| File type | `.md`, `.markdown`, `.txt`, `.json` | `unsupported type` |

The JSON envelope has its own ceilings and is not subject to the Markdown file
or batch limits, so a vault with several large notes stays importable. An
envelope with more than 20,000 notes imports the notes inside the ceiling and
reports the rest as `over the batch limit`. A malformed envelope is an error in
the warning banner; it changes nothing in the vault.

## The Markdown subset

The parser is deliberately small and never produces HTML, so imported Markdown
cannot execute anything.

- ATX headings (`#` to `######`)
- Paragraphs
- Unordered (`-`, `*`, `+`) and ordered (`1.`, `1)`) lists
- Block quotes (`>`)
- Fenced code blocks (```` ``` ```` or `~~~`, with an optional language)
- Inline emphasis (`*text*`), strong (`**text**`) and inline code (`` `code` ``)
- Links (`[label](https://example.org)`); only `http`, `https`, `mailto` and
  relative targets become links
- Wiki links (`[[note]]`, `[[note|alias]]`, `[[note#heading]]`)
- Tags (`#tag`)
- Backslash escapes

One run of inline text is limited to 20,000 characters. A longer run is kept
as plain text instead of being parsed, so a pathological file cannot slow the
editor down. Raw markup in a note body stays visible text.

## The offline shell

`public/sw.js` is a hand written service worker template. The build fills its
two markers and writes `dist/sw.js`:

- The cache version is a SHA-256 hash of the worker template and of every
  precached file, so an identical rebuild keeps the same worker and any change
  produces a new one.
- The precache list is every file of the finished build, plus `./` and
  `./index.html`. The worker script itself is never in its own list.
- On activation only caches whose name starts with `lattice-notes-shell-` and
  is not the current one are deleted. Caches of other applications on the same
  origin are left alone.
- Navigations are network first with the precached `index.html` as the offline
  fallback, so a rebuild is picked up as soon as the browser is online again.
  Other same origin requests are served from the cache first.

## Known limits

- **Two tabs are last writer wins.** The whole vault is written as one
  document, so a second tab that was opened before the first one saved can
  overwrite the changes of the first tab. Use one tab at a time.
- **The last keystroke can be lost.** Writes are debounced by 200 ms. Closing
  the tab immediately after a keystroke can lose that keystroke.
- **The recovery path refuses to guess.** A retry re-reads the stored vault: it
  refuses to write over a vault that has become readable, and only replaces a
  still unreadable one after a second, explicitly warned retry.

## Reference material

The workspace layout and the local-first approach were informed by a bounded,
read-only static analysis of an Obsidian Desktop bootstrap archive, kept
outside this repository at `/tmp/opencode/lattice-bootstrap-evidence.md`. That
analysis read archive headers and hashes only: no proprietary code was
executed and nothing was copied into this project.

Lattice Notes is an independent implementation. It does not claim runtime
parity with Obsidian, and it does not implement the Obsidian file format or
vault layout. Notes here are Markdown in IndexedDB, not a folder of Markdown
files in a vault directory.

## License

MIT. See [LICENSE](LICENSE).
