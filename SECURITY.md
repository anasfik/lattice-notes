# Security policy

## Reporting a vulnerability

Do not publish exploit details, real notes, backups, tokens or credentials in
public issues. Email **work@gwhyyy.com** with the subject
**Lattice Notes security report**. Include affected revision, reproduction steps
using synthetic data, impact and a suggested fix if available. Avoid attaching
private vault exports. There is no guaranteed response time or bounty program.

## Support status

Lattice Notes is pre-1.0. Security fixes target the current default branch;
older snapshots are not maintained separately. Export a backup before updating
or changing origin. Database upgrades may prevent older builds from reading
the same browser storage.

## Boundaries

- The app has no account, backend or telemetry. Notes and history remain in
  browser-origin IndexedDB, which is **not encrypted by this application**.
- Browser extensions, compromised devices and other scripts on the same
  origin can access local data. Host the app on a dedicated, trusted HTTPS
  origin and protect your browser profile.
- The Markdown renderer does not execute raw HTML. Treat renderer/link changes
  and imports as untrusted-input boundaries.
- Clearing site data or losing a profile can lose notes and snapshots.
  External exports are the backup boundary. Multi-tab writes are last-writer-wins.
- Dependencies and the static host remain part of the supply chain. CI does
  not prove the absence of vulnerabilities.
