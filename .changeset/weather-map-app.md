---
"meteoswiss-mcp": minor
---

New, experimental and off by default: a weather map as an MCP App. With `METEOSWISS_MAP_APP=true` the server offers `meteoswissWeatherMapExperimental` (title "Weather map (experimental)"; it may change or go away) to clients that render MCP Apps (Claude, ChatGPT, VS Code, Cursor and others). It takes the inputs of `meteoswissWeatherSituation` and returns the same answer with the 5 km grid; the client shows a map of Switzerland with the weather per cell, the regions and a legend. Clients that do not render MCP Apps see no change, and neither do the answers of the existing tools.
