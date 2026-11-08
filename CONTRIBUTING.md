# Contributing

Thanks for taking a look. This is a small plugin and it intends to stay small — the useful contributions are
usually a new progress format, a rendering fix, or a docs correction.

## Before you start

- Read [`CONTRACT.md`](./CONTRACT.md) — it lists the only DSH internal APIs this plugin is allowed to use.
- Read [`AGENTS.md`](./AGENTS.md) if you are an AI agent; the rules there are hard constraints.
- Open an issue first for anything larger than a bug fix, so the scope can be agreed before you write code.

## Development setup

Requirements: Node ≥ 20, and a DSH 0.2.x installation for manual checks. No pnpm/npm workspace is involved.

```sh
git clone https://github.com/Dekurri/dsh-task-progress.git
cd dsh-task-progress
npm install       # devDependencies only (react / react-dom for the SSR render test)
npm run verify    # everything CI runs
```

`npm run verify` = `scripts/static-check.mjs` + `scripts/secret-scan.mjs` + `test/parse.test.mjs` +
`test/render.test.mjs`. All four must pass.

## What to change where

| You want to… | Change |
|---|---|
| support a new progress output format | `client.js` parsing section (`STAGE_RULES` / regexes), then add a case to `test/parse.test.mjs` |
| change how the card looks | `client.js` CSS + component, then re-run `test/render.test.mjs`; theme tokens only |
| adjust speed / ETA heuristics | `analyzeJob` in `client.js` + a parser test with a fixed clock |
| add a user-visible string | `client.js` zh+en dictionaries and check `test/render.test.mjs` still passes |
| touch the slot registration | stop — re-read `CONTRACT.md` first; the slot, id and order are part of the public behaviour |

Do **not**:

- add a runtime dependency (the published bundle is dependency-free);
- require any `@deepseek-ai/dsh-*` package from `client.js`;
- move the `const ANSI_RE = ` / `function isLive(job)` markers (tests extract the parser between them);
- commit machine-specific absolute paths, secrets, `node_modules`, `dist` or `*.tgz`.

## Pull requests

- One logical change per PR; keep the diff readable.
- Run `npm run verify` locally and paste the result in the PR template.
- For visual changes, attach a screenshot or a short recording of the card inside DSH.
- Add a `CHANGELOG.md` entry under `[Unreleased]` for behaviour changes.

## Releases (maintainer)

See [INSTALL.md § 7](./INSTALL.md#7-维护者发布流程). In short: bump `package.json` version, update `CHANGELOG.md`,
push to `main` with green CI, push a `v*` tag — the release workflow packs the tarball and creates the GitHub Release.

## License

By contributing you agree your changes are licensed under the [MIT License](./LICENSE).
