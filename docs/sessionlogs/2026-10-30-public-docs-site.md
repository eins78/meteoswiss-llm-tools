# Public docs site: user, operator and development docs

**Date:** 2026-10-30
**Source:** Claude Code (Sonnet 5.5), delegated from homebot
**Session:** Max wants to present the project to MeteoSwiss staff and refer to public docs instead of a handout.
Brief: publish one coherent docs site, linked from the repo and the homepage, for three audiences. Plan first, then Max's ballot
(13:29 CET, six decisions, recorded in `docs/plans/2026-10-30-public-docs-site.md`), then the build. Constraints: PR only, no merge,
no release, no deploy, no change to the home repo, docker-infra or the running server.

## Summary

The Pages site at `code.178.is/meteoswiss-llm-tools/` published only the eval runs (since the 2026-07-18 re-scope) and was linked from
nowhere. It now has four sections: Use it, Run it, Build on it, Evaluations. Every page was written from the code, not from the old docs.
The landing page at `meteoswiss-mcp.ars.is` and all READMEs link to it. The landing-page link is a server change, so a
`meteoswiss-mcp` patch changeset is included; releasing and deploying it are Max's call after the merge.

## What changed

- **New pages** (hand-written, `packages/meteoswiss-docs-site/src/content/docs/`): `user/` (connect, tools reference, agent skill,
  data and limits), `operator/` (install, configuration, monitoring, releases), `development/` (architecture, testing, releasing,
  contributing), `evaluations/index.mdx`, and a new home page.
- **Sync script** (`scripts/sync-content.ts`): it used to delete everything under `src/content/docs/` except `index.mdx`. It now clears
  only what it writes (`runs/`, `evaluations/skill-vs-mcp.md`, the HTML snapshots). It also publishes `docs/skill-vs-mcp.md` under
  Evaluations, rewriting its links to eval results to the site's own run pages.
- **Config:** sidebar with four groups; `.gitignore` narrowed to the synced paths; `pages.yml` also builds on `docs/skill-vs-mcp.md`.
- **Links:** root README (prominent), `meteoswiss-mcp` README, skills README, landing page (`overview.md`, `usage.md`, `tools.md`).
- **Stale in-repo docs:** `packages/meteoswiss-mcp/docs/user-guide.md` and `releasing.md` replaced by pointers plus what is still true;
  both docs indexes fixed; `CLAUDE.md` tool list corrected and docs-site rules added.

## Code vs old docs (the code won)

| Old claim | Where | Code says |
|-----------|-------|-----------|
| A weather-report tool for three regions; hosted at a retired demo URL; "HTTP/SSE" | `mcp/docs/user-guide.md` | Seven tools, none is a report tool; Streamable HTTP; hosted at `meteoswiss-mcp.ars.is` |
| Tags `v2.0.1`, `gh release create v…`, "package.json updated from the tag" | `mcp/docs/releasing.md` | Tags must start `meteoswiss-mcp-v` (`release.yml` checks it); versions come from changesets |
| Links to `implementation-plan.md`, `implementation-status.md` | `mcp/docs/README.md` | The files are in `docs/archive/` |
| Six tools; ~160 stations for current weather | root `CLAUDE.md` | Seven tools (`meteoswissClimateData` missing); ~300 stations (~160 full + ~140 precipitation-only) |
| Skill does not cover climate series | `docs/skill-vs-mcp.md`, `skills/README.md` | `SKILL.md` has a climate section and marker (5 of 7 tools covered). The four-prompts claim was correct |
| Skills package 1.0.0 | root README | 1.1.0 |
| Env var table of 9 variables | `mcp/README.md` | About 30; the new configuration page lists them all |
| `docker-compose.yml` builds with `context: .` | `mcp/docker-compose.yml` | The Dockerfile needs the repository root as context. Not changed: noted on the install page |
| `server.json` lists the npm package version 2.1.0 with a stdio transport | `mcp/server.json` | Package is 4.0.0; there is no stdio mode. Not changed (registry metadata): reported to Max |
| `npx meteoswiss-mcp` implied by "npm install" | n/a | `package.json` has no `bin`; the install page says to run `node node_modules/meteoswiss-mcp/dist/index.js` |

## Not done, and why

- No merge, release or deploy (brief). The landing-page link needs a `meteoswiss-mcp` release and a manual deploy to appear on
  `meteoswiss-mcp.ars.is`.
- `server.json` and `docker-compose.yml` left alone: not documentation, and changing registry metadata or the compose build is a
  separate decision.
- The third eval run (`2026-07-12-mcp-vs-skills`) is still unpublished: it has no editorial stub (an existing, deliberate rule).
- The tool reference is hand-written, not generated from the Zod schemas.
- German/French/Italian pages (decision DEC-005: English only).

## Verification

- `pnpm --filter meteoswiss-mcp run ci`: lint, parity (7 tools, 5 covered), build, 317 tests passed.
- `pnpm run build` in the docs site: 18 pages; an internal link check over the built HTML found 0 broken links.
- Public-safety grep over the new pages: only `meteoswiss-mcp.ars.is`, `code.178.is`, the TEST instance named by Max, and `ghcr.io/eins78`.
