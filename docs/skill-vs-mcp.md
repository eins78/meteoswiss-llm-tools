# Skill vs. MCP Server: Two Ways to Give AI Agents the Same Data

This repo implements access to [MeteoSwiss Open Government Data (OGD)](https://opendatadocs.meteoswiss.ch/) **twice**: once as an [agent skill](../packages/meteoswiss-skills/) and once as an [MCP server](../packages/meteoswiss-mcp/). Same data source, same use cases, two architectures — which makes this a direct, apples-to-apples case study of the two main ways to give an AI agent access to a dataset.

This document is the honest comparison. It is architectural and qualitative: capability parity, engineering effort, operational trade-offs, and context cost. It is **not** a benchmark — no head-to-head task evaluation between the two implementations exists yet (see [Limitations](#limitations)).

## The problem

MeteoSwiss publishes its weather data as Open Government Data: CSV files and a STAC API on `data.geo.admin.ch`, free, no API key. An AI agent that should answer "Will it rain in Bern tomorrow?" needs to:

1. Find the right dataset (current measurements, forecasts, pollen, climate series are separate collections).
2. Resolve the user's location to a station abbreviation or forecast point ID (~6000 points, ~300 stations).
3. Handle format quirks: semicolon-delimited CSVs, Latin1-encoded metadata files, `YYYYMMDDHHmm` UTC timestamps, a known typo in a STAC asset key.
4. Return the answer in a form the model reliably interprets.

There are two established ways to package that knowledge for an agent:

- **A skill** — instructions and helper scripts the agent loads on demand and executes itself, using tools it already has (shell, HTTP).
- **An MCP server** — a running service that exposes the operations as typed, validated tools via the [Model Context Protocol](https://modelcontextprotocol.io/).

This repo builds both, at production quality, so the trade-offs are visible in real code instead of argued in the abstract.

## The two implementations

### The skill: ~630 lines of markdown and bash

[`packages/meteoswiss-skills`](../packages/meteoswiss-skills/) ships one skill, [`meteoswiss-ogd`](../packages/meteoswiss-skills/skills/meteoswiss-ogd/SKILL.md):

| File | Lines | Role |
|---|---|---|
| `SKILL.md` | 123 | Trigger description + curl/awk/jq recipes for each data type |
| `REFERENCE.md` | 205 | Parameter codes, weather-icon codes, pollen codes, STAC collections |
| `scripts/*.sh` (5 files) | 264 | Token-efficient wrappers: fetch, decode, filter, print `key=value` pairs |

The agent does the work itself: it reads the recipes, composes `curl | iconv | awk` pipelines (or calls the bundled scripts), and interprets raw CSV rows. Domain knowledge that the MCP server encodes in TypeScript — the Latin1 encoding of metadata files, the two-step STAC item lookup, the hourly-to-daily aggregation for postal-code forecasts — lives here as prose and shell.

The design follows progressive disclosure: `SKILL.md` stays small (it enters the context only when triggered), heavy lookup tables live in `REFERENCE.md`, which the agent reads only when needed.

Requirements: an agent with shell access, plus `curl`, `awk`, `iconv` (and `jq` for forecasts). No server, no Node.js, no deployment.

### The MCP server: ~6.6k lines of TypeScript

[`packages/meteoswiss-mcp`](../packages/meteoswiss-mcp/) is a Streamable-HTTP MCP server (49 source files) exposing seven tools — `meteoswissLocalForecast`, `meteoswissCurrentWeather`, `meteoswissStations`, `meteoswissPollenData`, `meteoswissClimateData`, `search`, `fetch` — plus four preconfigured prompts (DE/FR/IT).

The same domain knowledge is encoded as infrastructure:

- **Location resolution** — fuzzy station-name matching with diacritic normalization, geocoding and reverse geocoding via geo.admin.ch, nearest-station lookup by coordinates. "Bahnhofplatz 1 Bern" works.
- **Caching** — TTL-tiered disk cache (60 s realtime, 1 h forecast, 24 h metadata, 7 d climate), so a hosted instance doesn't hammer the upstream on every question.
- **Validated I/O** — Zod schemas on every tool input; responses are compact structured JSON, not raw CSV.
- **Operations** — session management, health endpoint, Docker image, and a hosted instance at [meteoswiss-mcp.ars.is](https://meteoswiss-mcp.ars.is/) that any MCP client can use with zero installation.
- **Tests** — ~3.1k lines of unit and integration tests, run in CI against recorded fixtures.

Requirements: Node.js 22+ or Docker to self-host — or nothing at all, using the hosted instance.

## Capability parity

| Capability | Skill | MCP server |
|---|---|---|
| Multi-day local forecast | ✅ recipe + `forecast.sh` | ✅ `meteoswissLocalForecast` |
| Current weather (10-min updates) | ✅ recipe + `current-weather.sh` | ✅ `meteoswissCurrentWeather` |
| Weather-station search | ✅ recipe + `search-stations.sh` | ✅ `meteoswissStations` |
| Forecast-point search (~6000 points) | ✅ recipe + `search-forecast-points.sh` | ✅ built into forecast location resolution |
| Pollen data | ✅ recipe + `pollen.sh` | ✅ `meteoswissPollenData` |
| Climate series (NBCN, decades back) | ✅ recipe (monthly/yearly/daily files) | ✅ `meteoswissClimateData` |
| MeteoSwiss website search + page fetch | ❌ | ✅ `search`, `fetch` |
| Fuzzy station-name matching | ❌ (exact/substring grep; agent improvises) | ✅ |
| Geocoding (address → nearest station) | ❌ | ✅ |
| Structured JSON output | ❌ (raw CSV / `key=value`) | ✅ |
| Preconfigured multilingual prompts | ❌ | ✅ 4 (DE/FR/IT) |
| Response caching | ❌ (agent fetches fresh each time) | ✅ TTL-tiered |

The skill covers the five core data-access capabilities. Everything below the line is where the server's extra ~6000 lines went: convenience, robustness, and coverage that instructions alone don't provide.

## Engineering comparison

| | Skill | MCP server |
|---|---|---|
| Code size | ~630 lines (markdown + bash) | ~6.6k lines TypeScript, 49 files |
| Runtime requirements | `curl`, `awk`, `iconv`, `jq` in the agent's shell | Node.js 22+ / Docker — or none (hosted) |
| Works with | Agents with shell access (Claude Code, Cursor, …) | Any MCP client, including ones without shell access (Claude Desktop, Claude.ai) |
| Testing | Structural validation only (`skills` CLI in CI) | ~3.1k lines of unit + integration tests in CI |
| Distribution | Copy files: plugin marketplace, Skills CLI, or symlink | npm package, Docker image, hosted endpoint |
| Update path | Users reinstall the skill files | Redeploy; hosted users get updates transparently |
| Failure handling | Agent improvises from raw error output | Server-side validation, typed error messages |
| Where compute happens | In the agent's sandbox, per request | On the server, cached across users |

## Context cost

A qualitative comparison — these numbers are **not measured**, but the mechanics differ in ways worth understanding:

- **MCP**: the seven tool schemas are sent to the model in every session, whether or not weather comes up. In exchange, each actual query is cheap: one tool call, one compact JSON response.
- **Skill**: only a one-line trigger description is always present. When triggered, the agent loads `SKILL.md` (~120 lines), possibly `REFERENCE.md` (~200 lines), and then spends turns composing and running shell commands, with raw CSV output entering the context. Idle cost is near zero; active cost is higher and more variable.

So the skill is cheaper when weather questions are rare, the server is cheaper when they're frequent — and the server's structured output reduces the risk of the model misreading raw data. Measuring this properly would be a natural extension of the eval suite below.

## What the evals showed

[`packages/meteoswiss-forecast-evals`](../packages/meteoswiss-forecast-evals/) is the third piece of the showcase: a [promptfoo](https://promptfoo.dev/) suite that treats **tool output as an interface for a language model** and measures its legibility before shipping.

To be clear about what it is not: **it does not compare the skill against the MCP server.** It compares two candidate JSON formats for the `meteoswissLocalForecast` hourly-precipitation time-series — timestamps in **local time with UTC offset** (`2026-03-28T09:00:00+01:00`) vs. **UTC** (`2026-03-28T08:00:00Z`) — across 13 models in three price tiers, with 33 programmatically generated lookup questions and a small LLM-judged slice. Ground truth is computed from the fixture, never hand-typed.

The result was decisive: on exact-value lookups at a specific local hour, models scored **~100% with local-time labels vs. ~0% with UTC** — across every tier, including frontier models. That settled a real design decision (the feature shipped with local-time labels) and is documented in the [2026-07-09 results](../packages/meteoswiss-forecast-evals/docs/results/2026-07-09-forecast-json-comprehension.md).

The lesson generalizes to both approaches in this case study: whatever the transport — MCP tool response or CSV parsed by a skill — the format the model reads is an interface, and its legibility can and should be measured, not assumed.

## When to choose which

**Choose a skill when:**

- Your agents have shell access (coding agents, CLI agents).
- The data source is public, stable, and simple enough to describe in a few pages.
- You want zero infrastructure — nothing to deploy, monitor, or pay for.
- Occasional, exploratory use; the agent's flexibility matters more than consistency.

**Choose an MCP server when:**

- You need to reach clients without shell access (chat apps, desktop assistants).
- Location resolution, caching, or upstream-API etiquette require real logic.
- You want typed inputs, structured outputs, and a testable surface in CI.
- Many users share the same access — a hosted server amortizes the work and caching.

**Or do both**, as this repo does: the implementations share no code but encode the same domain knowledge, and the skill explicitly points agents to the MCP server for the cases it doesn't cover. The skill is also readable documentation of what the server automates.

## Limitations

Stated plainly, so the comparison stays honest:

- **No behavioral tests for the skill.** CI validates its structure (`skills` CLI), not whether the recipes still work against the live OGD endpoints. The MCP server has integration tests; the skill has none.
- **No head-to-head benchmark.** Nothing here measures "same question, both implementations, which answers better/cheaper/faster." The eval suite is the natural foundation for that — it is future work.
- **Context costs are reasoned, not measured** (see [Context cost](#context-cost)).
- **Coverage is asymmetric.** The skill covers 5 of the server's 7 tool areas; website search/fetch are server-only.
- **One dataset, one domain.** MeteoSwiss OGD is friendly: free, no auth, no rate-limit drama. Datasets requiring auth, pagination, or write operations would shift the trade-offs toward the server.

## Related reading

- [Eval results: forecast JSON comprehension (2026-07-09)](../packages/meteoswiss-forecast-evals/docs/results/2026-07-09-forecast-json-comprehension.md) — the full local-time-vs-UTC sweep
- [Eval suite design](../packages/meteoswiss-forecast-evals/docs/spec.md) — methodology, fixtures, scorer
- [The skill itself](../packages/meteoswiss-skills/skills/meteoswiss-ogd/SKILL.md) — short enough to read in one sitting
- [MCP server package](../packages/meteoswiss-mcp/) — tools, self-hosting, development
