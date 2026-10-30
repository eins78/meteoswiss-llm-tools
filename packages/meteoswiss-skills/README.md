# 🌦️ MeteoSwiss Skills

Agent skill that teaches AI agents to access [MeteoSwiss Open Government Data](https://opendatadocs.meteoswiss.ch/) directly via HTTP — no MCP server or API key required.

Part of the [meteoswiss-llm-tools](../../README.md) monorepo. This package is the *skill* half of the repo's [skill vs. MCP case study](../../docs/skill-vs-mcp.md): the same data access as [`meteoswiss-mcp`](../meteoswiss-mcp/), implemented in ~630 lines of markdown and bash instead of a server. For structured JSON and fuzzy matching, use the MCP server — or try it hosted at **[meteoswiss-mcp.ars.is](https://meteoswiss-mcp.ars.is/)**.

📖 **[Documentation](https://code.178.is/meteoswiss-llm-tools/user/agent-skill/)** — what the skill covers and when to choose it over the MCP server.

## Skills

| Skill | Description |
|-------|-------------|
| [`meteoswiss-ogd`](skills/meteoswiss-ogd/) | Access Swiss weather data (current conditions, forecasts, pollen, climate series) via curl/HTTP |

## Installation

### Claude Code Plugin Marketplace

```bash
/plugin marketplace add eins78/meteoswiss-llm-tools
/plugin install meteoswiss-skills@meteoswiss-marketplace
```

### Skills CLI

```bash
pnpx skills add https://github.com/eins78/meteoswiss-llm-tools.git#packages/meteoswiss-skills --global --agent claude-code --all
```

### Manual

```bash
ln -s /path/to/packages/meteoswiss-skills/skills/meteoswiss-ogd ~/.claude/skills/meteoswiss-ogd
```

## Relationship to MCP Server

The [`meteoswiss-mcp`](../meteoswiss-mcp/) package in this monorepo provides a full MCP server with structured JSON responses, fuzzy station matching, and geocoding. This skill is for agents that don't have the MCP server available — it teaches them to call the same underlying data sources directly.

The skill covers forecasts, current weather, station search, pollen, and climate series (NBCN). MeteoSwiss website search/fetch is MCP-only — see the [capability parity matrix](../../docs/skill-vs-mcp.md#capability-parity) for the full comparison.

## Development

```bash
pnpm test        # Validate skills with: skills add . --list
```

## License

[CC0-1.0](../../LICENSE) — public domain
