---
title: Agent Skill
description: The MeteoSwiss Agent Skill - the same open data without a server, for agents that can run shell commands.
---

The `meteoswiss-ogd` skill teaches an agent to read MeteoSwiss Open Data **directly**, using `curl`, `awk` and `jq`. There is no server,
no Node.js and no API key. It is the lighter alternative to the MCP server for agents that have a shell, such as Claude Code or Cursor.

## What it covers

| Question | Skill | MCP server |
|----------|:-----:|:----------:|
| Current weather | yes | yes |
| Forecasts | yes | yes |
| Station search | yes | yes |
| Pollen | yes | yes |
| Climate series (NBCN) | yes | yes |
| MeteoSwiss website search and fetch | no | yes |
| Structured, schema-validated output | no | yes |

The skill ships five scripts (`current-weather.sh`, `forecast.sh`, `pollen.sh`, `search-stations.sh`, `search-forecast-points.sh`) and a
reference document. For the cases it doesn't cover, it points the agent to the MCP server.

## Install

Skills CLI (works straight from the GitHub URL):

```bash
pnpx skills add https://github.com/eins78/meteoswiss-llm-tools.git#packages/meteoswiss-skills --global --agent claude-code --all
```

Claude Code plugin marketplace, from a local checkout (the marketplace manifest sits in the skills package, not at the repository root):

```bash
git clone https://github.com/eins78/meteoswiss-llm-tools.git
```

```text
/plugin marketplace add ./meteoswiss-llm-tools/packages/meteoswiss-skills
/plugin install meteoswiss-skills@meteoswiss-marketplace
```

Manually: symlink `packages/meteoswiss-skills/skills/meteoswiss-ogd` into `~/.claude/skills/`.

## Which one should I use?

The [Skill vs. MCP case study](../../evaluations/skill-vs-mcp/) compares both: capability parity, effort, operations and context cost.
Short version: choose the **MCP server** for structured output, broad coverage and many users; choose the **skill** when you
want zero infrastructure and your agent has a shell.
