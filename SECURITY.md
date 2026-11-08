# Security policy

## Supported versions

Only the latest released version receives fixes.

| Version | Supported |
|---|---|
| 0.1.x | ✅ |
| < 0.1 | ❌ |

## What this plugin can and cannot touch

The plugin is a browser-side UI module with an empty Host half:

- it does **not** read files, environment variables, cookies or tokens;
- it does **not** make network requests (no fetch / WebSocket / CDN);
- it does **not** persist anything (no data directory, no localStorage);
- it renders one slot entry (`conversation.input.overlay`) and only styles its own DOM subtree.

The only data it consumes is the in-memory DSH `jobs` stream of the current session
(job label, status, timestamps and the task's own stdout/stderr tail).

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability), or email the maintainer listed in `package.json`.

Include: affected version, DSH version, minimal reproduction, and the impact you believe it has.
You can expect an initial response within 7 days.

## Supply chain

- The published bundle has **zero runtime dependencies**. `react` / `react-dom` are devDependencies used only by
  the SSR render tests, so the tarball ships no third-party code.
- `scripts/secret-scan.mjs` runs in CI and fails on credentials or machine-local absolute paths in the tree.
- Dependabot keeps devDependencies and GitHub Actions up to date.
