---
title: Connect to the hosted server
description: Add the MeteoSwiss MCP server to Claude, Cursor or any MCP client. No installation, no API key.
---

The hosted server is free to use and needs no API key.

| | URL |
|---|---|
| **MCP endpoint** | `https://meteoswiss-mcp.ars.is/mcp` |
| Landing page | <https://meteoswiss-mcp.ars.is/> |
| Health check | <https://meteoswiss-mcp.ars.is/health> |

It speaks MCP over **Streamable HTTP**. Any client that supports a remote MCP server can use the URL directly.
Clients that only support local (stdio) servers can bridge to it with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote).

## Claude Code

```bash
claude mcp add --transport http meteoswiss https://meteoswiss-mcp.ars.is/mcp
```

## Claude Desktop

Claude Desktop reaches remote servers through `mcp-remote`. Add this to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json`)
and restart the app:

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

## Claude.ai

**Settings → Integrations → Add MCP Server**, then paste the endpoint URL.

## Cursor

Install from the [Cursor Directory](https://cursor.directory/plugins/meteoswiss-llm-tools), or add the endpoint URL manually under
**Settings → MCP**.

## Any other MCP client

Point it at `https://meteoswiss-mcp.ars.is/mcp` using the Streamable HTTP transport.
To check that the server is up from a terminal:

```bash
curl https://meteoswiss-mcp.ars.is/health
```

## Test instance (early adopters)

A second instance tracks the pre-release (`next`) builds:

`https://meteoswiss-mcp-demo-test.cloud.kiste.li/mcp`

:::caution
The test instance is **unstable**. It runs release candidates, may be restarted or changed without notice, and is meant for
early adopters who want to try upcoming changes. Use the main endpoint for anything you depend on.
:::

## Try it

Once connected, ask in any of Switzerland's four languages:

- "What's the weather forecast for Zurich this week?"
- "Wie wird das Wetter in Bern morgen?"
- "Quelle est la météo à Genève?"
- "Che tempo fa a Lugano?"
- "How windy is it at Jungfraujoch right now?"

Next: [what each tool answers](../tools/).

## No MCP client?

The same data is available without a server through the [Agent Skill](../agent-skill/).
