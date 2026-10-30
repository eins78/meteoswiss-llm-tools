# Get Started

No installation required — this server is hosted and ready to use.

## Claude Code

```bash
claude mcp add --transport http meteoswiss $$$___TEMPLATE_MCP_URL___$$$
```

## Claude Desktop

Add to your configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "meteoswiss": {
      "command": "npx",
      "args": ["mcp-remote", "$$$___TEMPLATE_MCP_URL___$$$"]
    }
  }
}
```

Restart Claude Desktop and you're ready to go.

## Claude.ai

Go to **Settings** → **Integrations** → **Add MCP Server** → paste the MCP endpoint URL.

## Example Questions

- **German:** "Wie wird das Wetter in Zürich diese Woche?"
- **French:** "Quelle est la météo à Genève demain?"
- **Italian:** "Che tempo fa a Lugano?"
- **English:** "What's the current temperature at Jungfraujoch?"

## Self-Hosting & Development

See the [documentation](https://code.178.is/meteoswiss-llm-tools/operator/install/) for Docker, self-hosting and configuration, and the [GitHub repository](https://github.com/eins78/meteoswiss-llm-tools/tree/main/packages/meteoswiss-mcp) for the source.
