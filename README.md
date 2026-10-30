# 🌦️ MeteoSwiss LLM Tools

[![License: CC0-1.0](https://img.shields.io/badge/license-CC0--1.0-blue)](LICENSE)
[![npm: meteoswiss-mcp](https://img.shields.io/npm/v/meteoswiss-mcp?label=npm%3A%20meteoswiss-mcp)](https://www.npmjs.com/package/meteoswiss-mcp)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://ghcr.io/eins78/meteoswiss-mcp)
[![live](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmeteoswiss-mcp.ars.is%2Fhealth&query=%24.version&label=live&color=brightgreen)](https://meteoswiss-mcp.ars.is/)
[![next](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmeteoswiss-mcp-demo-test.cloud.kiste.li%2Fhealth&query=%24.version&label=next&color=lightgrey)](https://meteoswiss-mcp-demo-test.cloud.kiste.li/)
[![Cursor Directory](https://img.shields.io/badge/Cursor_Directory-Add_to_Cursor-blue)](https://cursor.directory/plugins/meteoswiss-llm-tools)

Swiss weather data for AI assistants — powered by [MeteoSwiss Open Government Data (OGD)](https://opendatadocs.meteoswiss.ch/), the same data behind the MeteoSwiss app and website. Free, no API key required.

**[meteoswiss-mcp.ars.is](https://meteoswiss-mcp.ars.is/)** — try the hosted service instantly, no setup needed.

📖 **[Read the documentation → code.178.is/meteoswiss-llm-tools](https://code.178.is/meteoswiss-llm-tools/)** — for [users](https://code.178.is/meteoswiss-llm-tools/user/getting-started/) (every tool, example prompts, limits), [operators](https://code.178.is/meteoswiss-llm-tools/operator/install/) (Docker, configuration, monitoring) and [developers](https://code.178.is/meteoswiss-llm-tools/development/architecture/) (architecture, tests, releases).

This repo is also a working answer to a design question: **how should you give AI agents access to a public dataset?** It implements the same MeteoSwiss data access twice — as an [agent skill](packages/meteoswiss-skills/) (markdown instructions plus bash scripts, no server) and as an [MCP server](packages/meteoswiss-mcp/) (structured tools, fuzzy matching, caching, hosted). The two approaches are compared honestly in the [skill vs. MCP case study](docs/skill-vs-mcp.md).

A third piece, [meteoswiss-forecast-evals](packages/meteoswiss-forecast-evals/), demonstrates eval-driven interface design: a [promptfoo](https://promptfoo.dev/) suite measuring how well 13 LLMs read the forecast JSON, which settled a real design decision — local-time timestamps beat UTC, with hour-level lookups scoring ~100% vs. ~0%.

What the tools provide:

- **Multi-day forecasts** for ~6000 Swiss locations (postal codes, stations, place names)
- **Real-time measurements** from ~300 stations (~160 full weather + ~140 precipitation-only), updated every 10 minutes
- **Station discovery** by name, canton, or GPS coordinates
- **Pollen monitoring** from ~15 stations across Switzerland
- **Climate series** from the National Basic Climatic Network (NBCN), going back decades
- **MeteoSwiss website** search and content retrieval

## What this repo demonstrates

- **An agent skill** — teach an agent to fetch open data directly with `curl`/`awk`/`jq`: ~630 lines of markdown and bash, zero infrastructure. → [packages/meteoswiss-skills](packages/meteoswiss-skills/)
- **An MCP server** — the same data as structured, validated tools with fuzzy station matching, geocoding, TTL-tiered caching, a real test suite, Docker, and a hosted instance. → [packages/meteoswiss-mcp](packages/meteoswiss-mcp/)
- **Eval-driven interface design** — treat tool output as an interface for a language model, and measure its legibility before shipping. → [packages/meteoswiss-forecast-evals](packages/meteoswiss-forecast-evals/)

Read the comparison: **[Skill vs. MCP Server: Two Ways to Give AI Agents the Same Data](docs/skill-vs-mcp.md)**.

## Choose your approach

Both approaches answer the same weather questions. Which to install depends on your agent:

| | [MCP Server](packages/meteoswiss-mcp/) | [Agent Skill](packages/meteoswiss-skills/) |
|---|---|---|
| **What it is** | Standalone server exposing 7 structured tools via MCP | Markdown instructions + 5 bash scripts the agent runs directly |
| **Works with** | Claude Desktop, Claude.ai, Cursor, any MCP client | Claude Code, Cursor, any agent with shell access |
| **Coverage** | Forecasts, current weather, stations, pollen, climate series, website search | Forecasts, current weather, stations, pollen |
| **Extras** | Fuzzy matching, geocoding, caching, DE/FR/IT prompts, structured JSON | No server, no Node.js — just `curl`, `awk`, `jq` |
| **Size** | ~6.6k lines TypeScript, tested in CI | ~630 lines markdown + bash |
| **Install** | One-liner (hosted), npm, or Docker | Plugin marketplace, Skills CLI, or symlink |

Full comparison — parity matrix, engineering trade-offs, context cost, when to choose which: [docs/skill-vs-mcp.md](docs/skill-vs-mcp.md).

### MCP server — quickstart

Use the hosted instance (no installation):

```bash
# Claude Code
claude mcp add --transport http meteoswiss https://meteoswiss-mcp.ars.is/mcp
```

For **Cursor**, install from the [Cursor Directory](https://cursor.directory/plugins/meteoswiss-llm-tools) or add manually via Settings → MCP.

Or self-host with Docker:

```bash
docker run -p 3000:3000 ghcr.io/eins78/meteoswiss-mcp:latest
```

See the [meteoswiss-mcp README](packages/meteoswiss-mcp/README.md) for Claude Desktop setup, environment variables, and full documentation.

### Agent skill — quickstart

Install via the Claude Code plugin marketplace:

```bash
/plugin marketplace add eins78/meteoswiss-llm-tools
/plugin install meteoswiss-skills@meteoswiss-marketplace
```

Or with the [Skills CLI](https://github.com/anthropics/skills):

```bash
pnpx skills add https://github.com/eins78/meteoswiss-llm-tools.git#packages/meteoswiss-skills --global --agent claude-code --all
```

See the [meteoswiss-skills README](packages/meteoswiss-skills/README.md) for manual installation and details.

## Available tools (MCP server)

| Tool | Description |
|------|-------------|
| `meteoswissLocalForecast` | Multi-day forecasts by postal code, station, or place name |
| `meteoswissCurrentWeather` | Real-time measurements (temperature, wind, humidity, pressure) |
| `meteoswissStations` | Search station network by name, canton, or coordinates |
| `meteoswissPollenData` | Pollen concentration data from monitoring stations |
| `meteoswissClimateData` | NBCN climate series — temperature, precipitation, sunshine, and climate indicators going back decades |
| `search` | Search MeteoSwiss website content (DE, FR, IT, EN) |
| `fetch` | Fetch full content from MeteoSwiss pages |

## Example questions

Works with both approaches — just ask in any of Switzerland's four languages:

- "What's the weather forecast for Zurich this week?"
- "Wie wird das Wetter in Bern morgen?"
- "Quelle est la météo à Genève?"
- "Che tempo fa a Lugano?"

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`meteoswiss-mcp`](packages/meteoswiss-mcp/) | [![npm](https://img.shields.io/npm/v/meteoswiss-mcp)](https://www.npmjs.com/package/meteoswiss-mcp) | MCP server with structured tools, fuzzy matching, and geocoding |
| [`meteoswiss-skills`](packages/meteoswiss-skills/) | 1.1.0 | Agent skill — direct HTTP access, no server needed |
| [`meteoswiss-forecast-evals`](packages/meteoswiss-forecast-evals/) | — | LLM eval suite for the forecast JSON format (standalone, not a workspace member) |

## Documentation

The documentation site is at **[code.178.is/meteoswiss-llm-tools](https://code.178.is/meteoswiss-llm-tools/)**:

- [Use it](https://code.178.is/meteoswiss-llm-tools/user/getting-started/) — connect a client, tools reference, the Agent Skill, data sources and limits
- [Run it](https://code.178.is/meteoswiss-llm-tools/operator/install/) — Docker and npm, configuration, monitoring, releases and upgrading
- [Build on it](https://code.178.is/meteoswiss-llm-tools/development/architecture/) — architecture, testing, release process, contributing
- [Evaluations](https://code.178.is/meteoswiss-llm-tools/evaluations/) — the [skill vs. MCP case study](docs/skill-vs-mcp.md) and the eval runs, including the local-time-vs-UTC sweep

In the repository: [documentation index](docs/README.md).

## Development

```bash
git clone https://github.com/eins78/meteoswiss-llm-tools.git
cd meteoswiss-llm-tools
nvm use && pnpm install
```

See each package's README for package-specific commands. The repo uses [changesets](https://github.com/changesets/changesets) for versioning.

Manual, point-in-time test reports (e.g. live MCP tool test passes) live in `docs/test-reports/`.

## Data source

All weather data comes from [MeteoSwiss Open Government Data (OGD)](https://opendatadocs.meteoswiss.ch/) — the official free data offering from Switzerland's Federal Office of Meteorology and Climatology. The same data powers the MeteoSwiss app and website.

## License

[CC0-1.0](LICENSE) — public domain
