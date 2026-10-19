# 🌦️ MeteoSwiss MCP Server

[![npm version](https://img.shields.io/npm/v/meteoswiss-mcp)](https://www.npmjs.com/package/meteoswiss-mcp)
[![License: CC0-1.0](https://img.shields.io/badge/license-CC0--1.0-blue)](../../LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![Cursor Directory](https://img.shields.io/badge/Cursor_Directory-Add_to_Cursor-blue)](https://cursor.directory/plugins/meteoswiss-llm-tools)

MCP server for MeteoSwiss weather data — powered by [MeteoSwiss Open Data](https://opendatadocs.meteoswiss.ch/), the same data behind the MeteoSwiss app and website.

This package is the *server* half of the repo's [skill vs. MCP case study](../../docs/skill-vs-mcp.md) — the same data is also available as a no-infrastructure [agent skill](../meteoswiss-skills/).

**[meteoswiss-mcp.ars.is](https://meteoswiss-mcp.ars.is/)** — try it now, no setup needed.

- **Multi-day forecasts** for ~6000 Swiss locations (postal codes, stations, place names)
- **Real-time measurements** from ~300 stations (~160 full weather + ~140 precipitation-only), updated every 10 minutes
- **Station discovery** by name, canton, or GPS coordinates
- **Pollen monitoring** from ~15 stations across Switzerland
- **Climate series** from the National Basic Climatic Network (NBCN), going back decades
- **MeteoSwiss website** search and content retrieval

## Use the Hosted Service

No installation required — the server is hosted at `https://meteoswiss-mcp.ars.is`.

### Claude Code

```bash
claude mcp add meteoswiss https://meteoswiss-mcp.ars.is/mcp
```

### Claude Desktop

Add to your configuration file (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "meteoswiss": {
      "command": "npx",
      "args": ["mcp-remote", "https://meteoswiss-mcp.ars.is/mcp"]
    }
  }
}
```

### Cursor

Install from the [Cursor Directory](https://cursor.directory/plugins/meteoswiss-llm-tools), or add manually via **Settings** → **MCP** → **Add Server** → paste `https://meteoswiss-mcp.ars.is/mcp`.

### Claude.ai

Go to **Settings** → **Integrations** → **Add MCP Server** → paste `https://meteoswiss-mcp.ars.is/mcp`.

### Example Questions

- "What's the weather forecast for Zurich this week?"
- "Wie wird das Wetter in Bern morgen?"
- "Quelle est la météo à Genève?"
- "Che tempo fa a Lugano?"
- "How windy is it at Jungfraujoch right now?"
- "Show me pollen data for Zurich"

## Available Tools

| Tool | Description |
|------|-------------|
| `meteoswissLocalForecast` | Multi-day forecasts for any Swiss location by postal code, station, or place name |
| `meteoswissCurrentWeather` | Real-time measurements from automatic weather stations (temperature, wind, humidity, pressure) |
| `meteoswissStations` | Search and browse the MeteoSwiss station network by name, canton, or coordinates |
| `meteoswissPollenData` | Current pollen concentration data from monitoring stations |
| `meteoswissClimateData` | NBCN climate series — temperature, precipitation, sunshine, and climate indicators going back decades |
| `search` | Search MeteoSwiss website content (DE, FR, IT, EN) |
| `fetch` | Fetch full content from MeteoSwiss pages in markdown, text, or HTML |

## Prompts

Pre-configured prompts for common weather queries:

| Prompt | Language | Description |
|--------|----------|-------------|
| `wetterNordschweiz` | German | Forecast and current weather for Northern Switzerland |
| `wetterSchweiz` | German | Weather for any Swiss location |
| `meteoSuisseRomande` | French | Forecast and current weather for Western Switzerland |
| `meteoTicino` | Italian | Forecast and current weather for Southern Switzerland |

---

## Self-Hosting

### Docker

```bash
docker run -p 3000:3000 ghcr.io/eins78/meteoswiss-mcp:latest
```

With custom URL:

```bash
docker run -p 3000:3000 -e PUBLIC_URL=https://your-domain.com ghcr.io/eins78/meteoswiss-mcp:latest
```

### Docker Compose

```bash
docker compose up
```

### From Source

```bash
git clone https://github.com/eins78/meteoswiss-llm-tools.git
cd meteoswiss-llm-tools/packages/meteoswiss-mcp
pnpm install
pnpm build
pnpm start
```

The server will be available at `http://localhost:3000`. MCP endpoint: `http://localhost:3000/mcp`.

### Local MCP Configuration

```json
{
  "mcpServers": {
    "meteoswiss-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `PUBLIC_URL` | — | Full public URL for URL generation (e.g. `https://meteoswiss-mcp.ars.is`) |
| `USE_TEST_FIXTURES` | `false` | Use local test data instead of live API |
| `BIND_ADDRESS` | `0.0.0.0` | Interface to bind to |
| `MAX_SESSIONS` | `100` | Maximum concurrent sessions |
| `SESSION_TIMEOUT_MS` | `300000` | Session timeout in milliseconds |
| `TRUST_PROXY` | `0` | Number of reverse-proxy hops to trust for the client IP (`X-Forwarded-For`). Set `1` behind one proxy such as Caddy; leave `0` when clients reach the server directly, or they can spoof their IP past the rate limit |
| `DEBUG` | — | Debug namespaces (e.g. `mcp:*`) |

---

## Development

### Prerequisites

- Node.js v22+ ([nvm](https://github.com/nvm-sh/nvm) recommended)
- [pnpm](https://pnpm.io/)

### Setup

```bash
nvm use
pnpm install
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start with hot reloading |
| `pnpm start` | Start the server |
| `pnpm build` | Build TypeScript |
| `pnpm test` | Run tests |
| `pnpm run lint` | Type checking + ESLint |
| `pnpm run fix` | Auto-fix lint errors |
| `pnpm run ci` | Full CI (lint + build + test) |
| `pnpm run dev:inspect` | Test with MCP Inspector |

### Project Structure

```
src/
  index.ts              # Entry point
  server.ts             # MCP server (factory pattern)
  data/                 # Data access and transformation
  schemas/              # Zod schemas for validation
  tools/                # MCP tool implementations
  support/              # Logging, validation, HTTP, sessions
  views/homepage/       # Server homepage content
test/
  integration/          # Integration tests for all tools
  __fixtures__/         # Test data
```

### Debugging

Enable debug output with the `DEBUG` environment variable:

```bash
DEBUG=mcp:* pnpm dev          # All debug output
DEBUG=mcp:tools pnpm dev      # Tool execution only
DEBUG=mcp:transport pnpm dev  # Transport layer only
```

See [docs/debugging-guide.md](docs/debugging-guide.md) for more.

## Contributing

Contributions are welcome! Run `pnpm run fix && pnpm run ci` before committing.

See [docs/releasing.md](docs/releasing.md) for the release process.

## License

[CC0-1.0](../../LICENSE) — public domain
