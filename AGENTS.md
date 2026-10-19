# Lattice Notes Engineering Contract

## Mission
Ship the smallest complete, original, open-source local-first Markdown workspace. Continue autonomously through implementation, verification, review, and repair; ask only for credentials, destructive approval, or a product choice that cannot be reversed.

## Operating loop
1. Read this file, the design spec, plan, repository status, callers, and current diff.
2. Keep exactly one task active. Use test-first changes for behavior.
3. Reuse the platform and existing code before adding dependencies or abstractions.
4. Work in independently verifiable waves. Re-read changed files and run the narrowest meaningful check after each wave.
5. Finish every implementation wave with an independent code review; fix blocking findings and re-check the affected path.
6. Before closing, run the full test/build gates, inspect desktop and mobile pixels, keyboard-walk the core flow, and inspect the final diff.

## Product constraints
- Product name: **Lattice Notes**. Do not use Obsidian trademarks, code, copy, or assets.
- Local-first and offline-first. Notes remain Markdown and user data must never require an account or server.
- React + TypeScript + Vite, native browser APIs, and minimal dependencies.
- WCAG 2.2 AA: semantic HTML, visible focus, keyboard operation, reduced motion, and practical 44px touch targets.
- Preserve empty, partial, error, success, and destructive-action recovery states.
- Follow `docs/superpowers/specs/2026-10-19-lattice-notes-design.md` and `docs/superpowers/plans/2026-10-19-lattice-notes.md`.

## Agent policy
- Primary agent owns orchestration and integration.
- Prefer `opencode/minimax-m3.1-flash-free`; fall back to `opencode/deepseek-v4.1-flash-free`, then `opencode/glm-5.3-flash-free` if rate-limited.
- One mutating agent at a time in this checkout; at most two lightweight read-only agents. Children must not spawn children.
- Every child receives an exact file/symbol scope, constraints, verification commands, expected artifact, and objective done condition.

## Safety
- Never expose or commit secrets.
- Do not execute or copy proprietary application bundles. REA evidence is behavioral reference only.
- Do not delete user data without an undo path or explicit approval.
- Never push, publish, release, or mutate remote systems without explicit approval.
- Preserve unrelated changes.

## Required gates
`npm test` · `npm run build` · desktop 1440×900 screenshot · mobile 390×844 screenshot · browser console check · focused accessibility and keyboard checks.
