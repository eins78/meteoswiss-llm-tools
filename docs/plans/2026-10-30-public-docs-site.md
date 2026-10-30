# Public docs site (step 1: publish)

Status: approved by Max 2026-10-30 13:29 CET (ballot, 6 decisions); implemented in one PR, not merged.

## Decisions (Max, 2026-10-30)

| # | Question | Decision |
|---|----------|----------|
| DEC-001 | Docs tool and hosting | Keep Starlight on GitHub Pages |
| DEC-002 | Homepage | **Link only was the plan; Max chose to ALSO link the docs from the landing page (`src/views/homepage/`) in this step.** Add a changeset for `meteoswiss-mcp` (patch). Release and deploy are not part of this work and wait for Max's go after the merge |
| DEC-003 | Spike content | Evals and `skill-vs-mcp.md` under "Evaluations"; user, operator and development docs rewritten from the code; plans, sessionlogs, research and test reports stay off the site |
| DEC-004 | GitHub "About" homepage | Stays `meteoswiss-mcp.ars.is`; prominent docs link in the READMEs instead |
| DEC-005 | Languages | English only; example prompts stay multilingual |
| DEC-006 | Endpoints named in the docs | `https://meteoswiss-mcp.ars.is` as the endpoint; the TEST instance `https://meteoswiss-mcp-demo-test.cloud.kiste.li`, marked unstable and for early adopters. The `cloud.kiste.li` alias of PROD is not named |

DEC-002 supersedes the "link only, landing-page change in a separate later PR" recommendation below. The recommendations in
"Decisions" further down are kept as written for the record.

## Findings

- Pages site (`code.178.is/meteoswiss-llm-tools/`) is live (HTTP 200). It is an Astro Starlight project in
  `packages/meteoswiss-docs-site/` deployed by `.github/workflows/pages.yml`. Since the 2026-07-18 re-scope it
  publishes **only** the promptfoo eval runs plus two editorial pages. The sidebar has a single group, "Eval Runs".
  The workflow's path filter only fires on eval results and the docs-site package.
- `meteoswiss-mcp.ars.is` is the server's own landing page: three markdown files in
  `packages/meteoswiss-mcp/src/views/homepage/` (overview, usage, tools) rendered by `GET /`.
  Changing it means a server release and a manual deploy.
- Nothing links the Pages site: not the root README, not the package READMEs, not the GitHub "About" homepage
  (which is `meteoswiss-mcp.ars.is`), not the landing page.
- Current releases: `meteoswiss-mcp` 4.0.0, `meteoswiss-skills` 1.1.0. Seven tools registered in `src/server.ts`:
  `search`, `fetch`, `meteoswissLocalForecast`, `meteoswissCurrentWeather`, `meteoswissStations`,
  `meteoswissPollenData`, `meteoswissClimateData`.

## Code vs old docs (so far)

1. `packages/meteoswiss-mcp/docs/user-guide.md` documents a weather-report tool for three regions and a retired
   hosted URL. Neither exists in the code. It also links to files that are gone.
2. `docs/README.md` (package) links `implementation-plan.md` and `implementation-status.md`, which do not exist.
3. `docs/releasing.md` describes `v2.0.1` tags and `gh release create`. The real flow is changesets, a
   "Version Packages" PR, then tags `meteoswiss-mcp-vX.Y.Z` / `meteoswiss-skills-vX.Y.Z`.
4. Root `CLAUDE.md` lists six tools and omits `meteoswissClimateData`. It says ~160 stations for current weather,
   while the landing page says ~300 (~160 full plus ~140 precipitation-only). Verify against the station list.
5. `docs/user-guide.md` says "Session Management / HTTP/SSE"; the transport is Streamable HTTP.
6. `TRUST_PROXY` default changed in 4.0.0 (major). Any operator text must come from the code and CHANGELOG.

More will surface while deriving each page from code.

## Decisions (recommendation first)

### 1. Docs tool and hosting
- **Recommended: keep Starlight on GitHub Pages.** It is already built, deployed and on a working domain. The
  change is content plus sidebar plus a broader workflow path filter. No new tooling.
- Alternative: MkDocs, Docusaurus or a docs folder on the server. All cost more and gain nothing here.

### 2. Homepage
- **Recommended for this step: link only.** Add the docs URL to the repo README, each package README, the
  GitHub "About" homepage field (Max's call: keep `meteoswiss-mcp.ars.is` as homepage, or switch to the docs),
  and a link from the landing page text.
- The landing-page link is a server change (markdown in `src/views/homepage/`, needs a release and a manual
  deploy). Keep it a **separate, later PR**. Full integration (serving docs from the server) is not worth it:
  it couples docs to server releases.

### 3. Existing spike content
- **Keep:** eval runs and editorial, moved under a "Evaluations" section. The sync script and generated data stay.
- **Rewrite from code:** user guide, tool reference, operator guide, development guide.
- **Drop from the public site (leave in repo):** `docs/plans`, `sessionlogs`, `research`, `reviews`,
  `test-reports`, old `meteoswiss-mcp/docs/*` guides. The stale ones (`user-guide.md`, `releasing.md`,
  `docs/README.md`) get fixed or replaced by a pointer to the site, so the repo has one source of truth.
- `docs/skill-vs-mcp.md`: keep, publish as a page (it is referenced from the landing page).

## Proposed site structure

1. **Home**: what it is, three audience cards, data attribution.
2. **User docs**: connect (Claude Code, Desktop via mcp-remote, Claude.ai, other MCP clients), one page per tool
   (what it answers, parameters, example prompts in DE/FR/IT/EN, limits), the Agent Skill (install, when to
   use it instead of MCP), data sources and licence (MeteoSwiss OGD terms), FAQ and limits.
3. **Operator docs**: Docker (GHCR) and npm install, every env var from `environment-validation.ts` with
   defaults, caching (disk cache, TTLs, parse cache), `/health` and `/metrics`, reverse proxy and `TRUST_PROXY`,
   rate limits and sessions, release channels (`latest` vs `next`, rc tags), upgrade notes.
4. **Development**: architecture and data flow, repo layout, tests and fixtures, evals, release process
   (changesets), contributing, security reporting.
5. **Evaluations**: existing eval runs and skill-vs-MCP case study.

Reference pages are written by hand from the code, then checked mechanically where possible: tool names and
parameters against the Zod schemas, env vars against `environment-validation.ts`. Generating the tool reference
from the schemas is possible but out of scope for step 1.

## Delivery

- Branch `worktree-meteoswiss-docs`, one PR against `main`, **not merged**. Merge with `--merge` only on Max's go.
- Pages build runs on the PR (build-only). The deploy only happens on merge to `main`.
- Changes: docs-site content and sidebar, `pages.yml` path filter, README links, fix or replace the stale
  package docs. No server code, no changeset needed (docs and CI only).
- Public-safety pass before ready: grep for internal hostnames, paths and keys. Public hostnames only:
  `meteoswiss-mcp.ars.is`, `code.178.is`, `ghcr.io/eins78/meteoswiss-mcp`.
- Review chain from the `delegate` skill's "Delivering Pull Requests", including Copilot review. The sessionlog
  goes into the PR.

## Open questions for Max

1. GitHub "About" homepage: keep `meteoswiss-mcp.ars.is`, or point it at the docs?
2. Is German/French/Italian documentation wanted, or English only for now? (Recommend English only; example
   prompts stay multilingual.)
3. Should the docs mention the production host as the recommended endpoint, or only `meteoswiss-mcp.ars.is`?
