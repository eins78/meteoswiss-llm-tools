---
title: Architecture
description: How the MeteoSwiss MCP server is built - components, data flow, caching and the design decisions behind them.
---

## Repository layout

`meteoswiss-llm-tools` is a monorepo:

| Package | What it is |
|---------|------------|
| `packages/meteoswiss-mcp` | The MCP server (TypeScript, Node.js 22+) |
| `packages/meteoswiss-skills` | The `meteoswiss-ogd` Agent Skill (markdown and bash) |
| `packages/meteoswiss-forecast-evals` | promptfoo eval suites (standalone, not a workspace member) |
| `packages/meteoswiss-docs-site` | This site (Astro Starlight, standalone) |
| `docs/` | Plans, session logs, research and the skill-vs-MCP case study |

## The server

Built with the MCP TypeScript SDK (`McpServer`), Express, Zod 4, and Streamable HTTP. Paths below are relative to `packages/meteoswiss-mcp/`.

| Path | Role |
|------|------|
| `src/index.ts` | Entry point: validates the environment, starts the HTTP server |
| `src/server.ts` | Creates one `McpServer` per session and registers the seven tools and three prompts |
| `src/transports/streamable-http.ts` | Express app: `/mcp`, `/health`, `/metrics`, `/`; CORS, rate limiting, session handling |
| `src/tools/` | `search` and `fetch` (MeteoSwiss website) |
| `src/data/` | OGD clients and caches: STAC client, CSV store, station and location resolvers, forecast index |
| `src/schemas/` | Zod input **and output** schemas for every tool |
| `src/support/` | Logging, validation, HTTP client, session manager, metrics, geocoding |
| `src/views/homepage/` | Markdown for the landing page served at `/` |
| `test/` | Unit and integration tests, and fixtures |

### Data flow

1. A client connects over Streamable HTTP and initialises a session (one `McpServer` instance per session).
2. A tool call is validated against its Zod input schema.
3. The data layer resolves the request: a location or station string goes through the resolver (exact match, then substring match with
   diacritics normalised, then swisstopo geocoding as the last resort).
4. Data comes from the OGD STAC API and CSV downloads, through the caches below. In test mode, from fixtures.
5. The result is validated against the tool's **output schema** and returned as `structuredContent`, with the same JSON as text.

## Design decisions

**Open Government Data, not scraping.** Since MeteoSwiss opened its data in May 2025, structured data comes from the STAC API and CSVs. Only
`search` and `fetch` still read the website.

**Disk cache for CSVs, with TTL tiers.** Raw CSV text is cached on disk: 60 s for realtime data, 1 h for forecasts, 24 h for metadata, 7 days
for climate series. Memory stays low and a restart is cheap.

**A cache is an optimisation, never a failure mode.** A failed cache write logs and returns the fetched data. An awaited write on the success path once
caused a production outage. Atomic writes use `write-file-atomic`, and empty-directory cleanup is age-gated, because both were sources of
intermittent `ENOENT … rename` errors.

**Forecast files are parsed once.** The forecast CSVs are about 178 MB. Instead of re-parsing on every request, each cached file version is
parsed once into a columnar, typed-array index, shared by concurrent requests (one download and one parse for N callers) and bounded by
`OGD_PARSE_CACHE_MAX_BYTES`. The parse is a schema-specific byte scanner that accepts only the exact OGD layout and falls back to the generic
CSV parser on any deviation; large files are built on worker threads. A cold forecast request dropped from about 12 s to under 1 s.

**Two independent caches for website content.** An HTTP cache holds fetched bytes; a conversion memo holds converted markdown, keyed by a hash of
the HTML. `cachified` sits on top for single-flight and stale-while-revalidate, so a MeteoSwiss outage degrades to slightly stale content.

**Local time in forecast JSON.** Hourly timestamps carry the Europe/Zurich offset. This was decided by an
[eval](../../evaluations/): models read hour-level values at about 100% accuracy with local-time labels and about 0% with UTC.

**Fail fast on configuration.** Invalid environment values stop the server at startup with a message that names the variable.

**`meteoswiss` prefix on tool names.** It helps models tell these tools apart from other weather tools on the same client.

## The skill and parity

The skill and the server implement the same data access twice. A parity check (`pnpm --filter meteoswiss-mcp run lint:parity`, part of `lint`
and CI) fails when a tool exists without a matching `<!-- mcp-tool: name -->` marker in the skill, unless the exception is recorded with a
reason in `parity/parity-exceptions.yml`.
