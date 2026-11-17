---
name: meteoswiss-situation-recipes
description: >-
  Use when the user asks a Swiss weather question that needs more than one call:
  where to catch the sun tomorrow, how to get above the fog, where it is sunny, wet
  or snowing across Switzerland, how high the fog reaches, or a forecast for one
  place. Gives the order of the meteoswiss MCP server tools and how to read their
  answers. Needs the meteoswiss MCP server of this plugin.
license: CC0-1.0
metadata:
  author: eins78
  repo: https://github.com/eins78/meteoswiss-llm-tools
  version: 1.0.0
compatibility: claude-code, cursor
---

# MeteoSwiss situation recipes

Short recipes for the tools of the `meteoswiss` MCP server (bundled with this plugin). Use them for questions that need more than one call. All times are Europe/Zurich; forecasts reach about 9 days ahead.

The server sends the same recipes in its `instructions`; clients that do not pass those to the model (for example claude.ai) get them from this skill. The tools are `meteoswissLocalForecast`, `meteoswissWeatherSituation` and `meteoswissCurrentWeather`; the client may show them with a prefix such as `mcp__meteoswiss__`.

## Recipes

1. Where to catch the sun, or get above the fog, on a day from a start place: call meteoswissLocalForecast for the start place (its location.coordinates), then meteoswissWeatherSituation for the morning and noon hours (time, until at most 12 h later, near = {lat, lon, radius_km}, bands such as [600, 800, 1000, 1200, 1500]) and compare the sunny share per altitude band. Then call meteoswissLocalForecast for the 2-3 best places and check sunshine_minutes per hour. Answer with place, altitude and hours.
2. Where is it sunny, wet or snowing across Switzerland: one meteoswissWeatherSituation call per hour or window, not one forecast per place. Read pct and dominant per region and band. "Sunny or mostly sunny" is the category sunny. Points are not area: a band with few points says little.
3. How high does the fog reach: meteoswissWeatherSituation with region mittelland, jura or alpennordhang. fog_top_m is the top of a fog sea with sun above it; null means none, so read the bands. fog_or_stratus on summits is cloud, not a fog sea: set max_altitude_m.
4. One place: meteoswissLocalForecast with a place name, postal code or station code; detail "sky" for fog and cloud, hourly for timing. Measured values now: meteoswissCurrentWeather (a measurement, not a forecast).

## Example

"Where can I catch the sun tomorrow? I start from Zurich and travel up to 60 km."

1. `meteoswissLocalForecast` for "Zurich": note `location.coordinates` and the weather there.
2. `meteoswissWeatherSituation` for 08:00 to 16:00 tomorrow in one call, `near` = the coordinates with `radius_km` 60, `bands` [600, 800, 1000, 1200, 1500]. Compare the sunny share per band; `fog_top_m` is the top of a fog sea.
3. `meteoswissLocalForecast` for the 2-3 most promising places, checking `sunshine_minutes` per hour.
4. Answer briefly: the best 2-3 places, from which hour, at which altitude, and how far from Zurich.
