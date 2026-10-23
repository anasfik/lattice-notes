# Contributing to Lattice Notes

Lattice Notes is an early-stage, local-first Markdown workspace. Contributions
should keep notes readable, offline use reliable, and recovery paths explicit.

## Develop

Use Node.js 24 LTS and npm:

```bash
npm ci
npm run dev
npm test
npm run build
```

Tests use Vitest, jsdom and fake-indexeddb. A production build includes the
offline shell; `npm run preview` lets you test that shell locally. Development
mode does not register a service worker.

## Before a pull request

- Keep changes focused; discuss major features in an issue first. Roadmap
  entries are proposals, not promises that every feature already exists.
- Follow [DESIGN.md](DESIGN.md), use native semantic HTML, and preserve visible
  keyboard focus, reduced motion and practical 44px touch targets.
- Reproduce behavior bugs with a failing regression test, then fix the shared
  cause. Run the full tests and build, not only the new test.
- For UI changes, inspect desktop 1440×900 and mobile 390×844 (also 320px),
  check scrolling, keyboard operation, contrast and browser console errors.
- Treat IndexedDB migrations and async vault identity changes as data-safety
  boundaries. Never reset unreadable user data automatically. Test old database
  versions, failed writes, and note/vault switches during pending operations.
- Do not add accounts, telemetry, runtime dependencies or remote resources
  without discussing the product and privacy implications first.
- Never include real notes, backups, browser profiles, tokens or credentials in
  issues, screenshots or commits. Use synthetic examples.

Describe what changed, how it was tested and what was not tested. Report
security vulnerabilities through [SECURITY.md](SECURITY.md), not public issues.

## Project map

- `src/components/`: native React UI and interaction tests
- `src/domain/`: vault operations, Markdown and other pure domain rules
- `src/storage/`: IndexedDB repository and migration/failure tests
- `src/styles.css`: shared tokens and responsive layout
- `public/sw.js` and `vite.config.ts`: production offline shell
- `docs/`: design decisions, roadmap and historical verification records

Be respectful, specific and constructive in issues and reviews. Code is MIT
licensed; retain upstream notices for vendored assets.
