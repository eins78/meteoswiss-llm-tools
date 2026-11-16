---
"meteoswiss-mcp": minor
---

The server now sends short recipes in its `instructions` (the `initialize` result), so an agent knows which tools to call, in which order, for questions that need more than one call: where to catch the sun or get above the fog, where it is sunny or wet across Switzerland, how high the fog reaches, and one place now or later. A new `sunFinder` prompt takes a day, a start place and a travel radius in km and follows the first recipe; clients that list prompts show it (in Claude Code as `/mcp__meteoswiss-mcp__sunFinder`). The server's home page JSON now lists `meteoswissWeatherSituation` and the new prompt.
