# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-09

### Added

- Floating task-progress card above the composer, registered as the `task-progress` entry
  of the `conversation.input.overlay` slot (does not change the composer height).
- Live data from the built-in `jobs` client service (`job.list` snapshot + `job.follow`
  output stream), so both the built-in bash tool and `dsh-ops`' `ops_bash` are covered.
- Progress parsing for tqdm, labeled fractions (`Epoch 3/10`, `step 120/1000`, `1/132 项`),
  bare percentages, and pip stages; when a line carries both an epoch and a step counter the
  finer step is the main progress and the epoch is shown as context.
- Speed, estimated remaining time and elapsed time derived from tqdm fields or from
  fraction samples.
- Two-step stop button (3 s arm window) wired to `ctx.jobs.kill`.
- Multi-job display (2 expanded, the rest collapsed), card collapse/expand, empty state
  renders nothing.
- zh/en dictionaries, theme-token-only styling, reduced-motion support.
- Repo guardrails: static plugin checks, secret/local-path scan, parser tests, React SSR
  render tests, CI, tag-driven release workflow, Dependabot, CODEOWNERS, issue/PR templates.
