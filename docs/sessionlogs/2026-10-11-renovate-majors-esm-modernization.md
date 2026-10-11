# Renovate backlog cleared + pnpm 12 / vitest / jsdom 30 (the ESM arc)

**Date:** 2026-10-07 → 2026-10-11
**Source:** Claude Code (GLM-5.3-Flash)
**Session:** Started as "handle all renovate PRs" in meteoswiss-llm-tools, extended to
hello-world-web ("do the same"), then to the full dependency modernization both repos had
queued behind the Renovate schedule.

## Why Renovate needed hand-holding

Its schedule is `* 7-18 * * 5` (Fridays only, Europe/Berlin) and the Mend-hosted app
**silently skipped its window** twice: no run processed the user's dashboard ticks
(2026-10-07), and the next scheduled run (Fri 2026-10-09) also produced zero bot
commits. Every "pending approval" / "awaiting schedule" update was therefore
fast-tracked by hand — branches created with **Renovate's exact `renovate/*` branch
names** so the bot adopts them on its next run instead of recreating duplicates.
This worked: hello-world-web's dashboard ended at 0 open PRs / 0 pending.

## The two "main is red" findings that blocked everything

1. **meteoswiss**: the required `Security & Dependency Check` regressed on main after
   new advisories (38 findings, 2 critical — `proxy-addr` pinned by express's range,
   `shell-quote`). Fixed via refreshed `pnpm.overrides` + ignoring `braces`
   GHSA-vfj7-8cjw-p6xm, which had **no patched release at all** (`patched: <0.0.0`)
   — same `auditConfig.ignoreGhsas` mechanism the repo already used once.
2. **hello-world-web**: every docker build failed `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
   Root cause: `pnpm.overrides` (node-fetch/prettier/@lit pins, #488) live in the root
   `package.json`, but the docker `pnpm fetch` layer only copies
   `.npmrc`/`pnpm-lock.yaml`/`pnpm-workspace.yaml` — pnpm ≥ 10.34 hard-fails when
   overrides config doesn't match the lockfile. Fix: `COPY package.json` into that
   layer (518). Lesson: anything read from `package.json` must be in the fetch layer.

## pnpm 12 migration gotchas (both repos)

- `package.json`'s `pnpm` field is **no longer read** → `overrides` and `auditConfig`
  move to `pnpm-workspace.yaml`. Renovate reads overrides from the yaml too.
- `onlyBuiltDependencies` → **`allowBuilds`** (map form). Unapproved build scripts are
  a **hard error** (`ERR_PNPM_IGNORED_BUILDS`) — standalone packages need their own
  `pnpm-workspace.yaml` (pnpm ≥ 12 reads it as the settings file even outside a
  workspace; keep `packages: ["."]`).
- pnpm 12 records **itself** in the lockfile (`packageManagerDependencies`) — bumping
  the `packageManager` spec requires a lockfile regen or frozen installs fail.
- `packageManager` hash must be the **hex** form: the base64 integrity contains `/`,
  which corepack in `node:24-alpine` rejects ("expected a semver version") — the
  docker build was the only place this surfaced (base64 worked fine locally).
- `minimumReleaseAge: 1440` is pnpm 12's default supply-chain policy — but
  **resolution does not respect it**: it resolves freshly-published versions and then
  refuses to install them. A full lockfile regen (`rm pnpm-lock.yaml && pnpm install`)
  picks the newest release outside the 24h window.

## jest → vitest (meteoswiss, the ESM-unblocking move)

The suite already ran ESM-mode jest (`useESM` + `--experimental-vm-modules`), so the
runner swap was mostly mechanical, but three things are worth knowing:

1. `unstable_mockModule` → hoisted `vi.mock` + `vi.hoisted` for the factory's mock fns
   (same mock-before-dynamic-import semantics, so `beforeAll` keeps the env-var +
   dynamic-import pattern unchanged).
2. 6 of 32 files silently relied on **jest's injected globals** (no imports at all) —
   they fail at collection in vitest; add explicit imports. One used `test()` as an
   alias.
3. **Snapshot keys differ** (jest: space-joined, vitest: ` › `). A locally-rewritten
   `.snap` keeps both entries; CI (`CI=true`) hard-fails on the obsolete one. Prune
   to the vitest key.

Full parity: 32 files, 263 passed + 1 skipped.

## The require(esm) findings (user's ESM question)

- jsdom 25+ fails under jest only because **jest's loader bypasses Node's
  `require(esm)`** — the same jsdom 30 loads fine under native ESM (verified) and
  under vitest → jsdom 30 shipped (168).
- node-fetch v3 is loadable from CJS via `require(esm)` and *worked* in
  hello-world-web's runtime — but the diff bot then showed it drags in
  `web-streams-polyfill` at ~9 MB, while **no consumer declares ^3** (both
  `@lit-labs/ssr` and changesets declare `^2`). Reverted (#531); recorded wont-fix on
  the dashboard. The v3 "update" was a phantom: Renovate was updating the *override
  pin*, which no consumer asked for.
- Local e2e A/B (v2 vs v3) returned identical failures — a local-environment artifact
  (`.claude/worktrees/renovate-prs` left by an earlier session also trips local knip
  with 74 "unused files"). CI was the gate for both.

## Blocked list (do not churn these)

- **TypeScript 7**: `tsc` 7.0.2 builds both repos fine; the only guard is
  `typescript-eslint does not support TS 7.0` (8.71.1, no beta; upstream tracking
  typescript-eslint#10940). ts-jest is gone since #167, so #106 merges the day
  typescript-eslint ships support. TS 7's blog hints at a TS 6 side-by-side API that
  could eventually let typescript-eslint run on 6 while building with 7.
- `braces` GHSA-vfj7-8cjw-p6xm: ignore is a stopgap — remove when a patched release
  exists.

## Open follow-ups

- meteoswiss #157 (Version Packages): meteoswiss-mcp **3.1.1** awaiting merge/publish.
- `gatsby-starter-netlify-cms` has a committed `renovate.json` but the Renovate App
  never ran there (no dashboard, no PRs) — activate in the Mend portal or drop the
  config.
- hello-world-web: `.claude/worktrees/renovate-prs` worktree trips local knip
  (`lint:knip` counts its files as unused) — remove the worktree locally.
