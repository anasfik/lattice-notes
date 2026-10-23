# GitHub preparation — 2026-10-23

Target: [anasfik/lattice-notes](https://github.com/anasfik/lattice-notes), created **private**. This is repository setup, not an application deployment or release.

## Included

- Existing local-first workspace, recovery, navigation and layout work.
- README with feature boundaries, synthetic-data screenshot, Node 24 quick start and backup guidance.
- MIT license retained; third-party icon notices, contribution and security guidance.
- Issue and pull-request templates, monthly Dependabot updates, and CI using pinned checkout/setup-node actions with read-only repository permissions.
- Node version file, repository metadata and credential-file ignore rules.

## Fresh local evidence

- Node 24.18.1, npm 11.16.0; `npm ci` passed.
- `npm test`: **636 tests passed**, 32 files.
- `npm run build`: TypeScript and Vite passed.
- Layout browser regression: **70 assertions passed**, zero console/page errors; desktop 1440×900 and mobile 390×844 screenshots inspected. Chromium only.
- `npm audit` and `npm audit --omit=dev`: zero reported vulnerabilities.
- `git diff --check`, local links in README/contribution/security docs, and five YAML parses passed.
- `actionlint` 1.7.12 passed for `.github/workflows/ci.yml`.
- Bounded common-credential pattern scan: 114 working files and 183 reachable history blobs, no matches. This is not an exhaustive secret audit.

Local execution logs and synthetic browser evidence remain in ignored `.superpowers/sdd/2026-10-23-github/` and `.superpowers/sdd/2026-10-22-layout-repair/`; browser-profile data and personal notes are not included.

## Independent review and repairs — 2026-10-23

An independent reviewer session flagged two important issues; both were verified against the source, fixed with regression tests, and re-checked:

- **Snapshot retention was never enforced once capture stopped.** With the capture interval at `0`, expired bodies stayed in IndexedDB and were still listed and restorable, contradicting the documented 1–90-day retention. `openRecovery` now applies the retention cutoff to the listed history and sweeps expiry out of storage (`src/App.tsx`), with a regression test that also pins other vaults staying untouched.
- **Compact panels hid live status and error recovery.** At phone width with the Index or Context panel open, the status line and the save/import warnings (with Retry/Dismiss) were inside the hidden document panel, so screen readers announced nothing and Retry was unreachable. The status strip and warnings now live outside the asides and the document panel in a dedicated grid row (`.workspace__feed`), on both desktop and compact layouts, with two compact regression tests.

Fresh evidence after the repairs: **639 tests passed (32 files)**, TypeScript plus Vite build passed, the 70-assertion layout browser regression passed with fresh 1440×900 and 390×844 screenshots inspected, and a scoped re-review of both fixes found no blocking findings (residual risks documented in the review output, e.g. the sweep is vault-wide and runs lazily when a recovery dialog is opened; untested extremely short viewports remain listed below).

## Limits



Independent final code review was requested but remains unverified while the free-model provider is unavailable. Earlier review gaps are documented in the design/layout verification reports. Local green gates do not imply independent review approval or a successful GitHub Actions run. Remote commit and CI results are verified separately after push.

No deployment, release, public-visibility change, branch protection, or account/billing change is part of this preparation.

## Remote verification

- Workspace commit `cad557631ab6f705e3ba6a075c5726ebb32ed09c` pushed to `main`; remote branch SHA matches. Local feature branch and worktree retained, with `origin/main` upstream.
- README is readable through the GitHub API. Repository is private, issues enabled, wiki/projects disabled, merged-branch cleanup enabled, and Markdown/local-first/offline-first/React/TypeScript topics configured.
- **GitHub CI blocked:** the [push run](https://github.com/anasfik/lattice-notes/actions/runs/39878234851) and a separate [manual diagnostic run](https://github.com/anasfik/lattice-notes/actions/runs/39878434787) both returned `startup_failure`, with zero jobs/check runs and no downloadable logs. Dependabot-generated runs also failed at startup. Actions is enabled and local `actionlint` passes; the API evidence does not establish the underlying cause. No speculative workflow changes, billing changes or repeated reruns were made.
- Root cause (established later, run [39882463447](https://github.com/anasfik/lattice-notes/actions/runs/39882463447)): **"The job was not started because your account is locked due to a billing issue"** — a GitHub account-level lock, not a workflow-file or repository-configuration defect. Local checks remain valid; resolution requires the repository owner to clear the billing status (GitHub → Settings → Billing; no automated agent action).

## Visibility

On explicit owner request (2026-10-23), the repository was changed from private to **public** via `gh repo edit --visibility public`. Verified after the change: `isPrivate: false`, `visibility: "public"` from the API. Before the change, the working tree and all reachable history blobs had already passed the bounded common-credential scan (114 working files, 183 history blobs, no matches). The private history was never exposed to third parties before this point; no history rewrite was needed.
