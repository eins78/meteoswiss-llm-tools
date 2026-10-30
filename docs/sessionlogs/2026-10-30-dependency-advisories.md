# Fixing the dependency advisories behind the red "Security & Dependency Check"

**Date:** 2026-10-30
**Source:** Claude Code (Sonnet 5.5), delegated from homebot
**Session:** Max authorised one small security PR ("ms sec go"). Constraints: branch from `origin/main`, no merge,
no release or deploy, run the Copilot review chain.

## Summary

`pnpm audit --audit-level moderate` (the CI command) now exits 0; it was 28 findings (9 high, 12 moderate,
7 low) and is 3 lows. Full `pnpm run ci` is green (lint, parity, build, 317 tests). No source files changed.

## What the audit really contained

The brief named zod, body-parser and `@modelcontextprotocol/server`. The audit had more: `undici`, `qs`,
`fast-uri`, `ip-address`, `hono`, `@hono/node-server`, and `@modelcontextprotocol/{client,server}` 2.2.0. The
last two come only from the dev-only inspector.

## What changed

- Direct bumps: SDK 1.32.2, zod 4.6.7, express 5.3.0, express-rate-limit 8.7.2, jsdom 30.1.3 (runtime);
  inspector 2.13.0, mcp-remote 0.15.2 (dev).
- Those alone left 17 findings. The rest are pins in `pnpm-workspace.yaml` `overrides`, because the parents
  still allow vulnerable ranges (SDK and express-rate-limit pull `ip-address`, `fast-uri`, `hono`;
  mcp-remote pulls express 4 with `body-parser` 1.x and `undici`). Existing stale pins were raised in place;
  `body-parser` is new. `@hono/node-server` moves to 2.x, which the SDK's range (`^1.19.9 || ^2.0.5`) allows.

## One visible side effect

zod 4.6 emits nullable fields as `"type": ["string", "null"]` instead of `anyOf`. This is equivalent JSON
Schema but appears in `tools/list`, so `parity/tool-inventory.json` was regenerated. The diff is only that
reshaping of `meteoswissLocalForecast`. Clients with a strict schema reader are the only possible risk.

## Not done

Release, publish, image build, deploy, merge; the six product follow-ups and Renovate #106 (out of scope).
The 3 remaining low advisories are below the CI threshold.

## Trap

`node_modules` symlinks are tracked in this repo, so `pnpm add` dirties them. Stage explicit paths only.
