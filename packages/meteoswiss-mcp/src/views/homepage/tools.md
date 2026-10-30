# Available Tools

Full reference with every parameter and example prompts: [documentation](https://code.178.is/meteoswiss-llm-tools/user/tools/).

## meteoswissLocalForecast

Get a multi-day weather forecast for any Swiss location.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `location` | string | Yes | Postal code ("8001"), station abbreviation ("SMA"), or place name ("Zurich") |
| `days` | number | No | Number of forecast days, 1-9 (default: 5) |

**Returns:** Daily forecasts with temperature (min/max), precipitation, sunshine, wind (speed + gust), weather description, and weather icons — plus an hourly breakdown of every series per day.

**Try:** "What's the weather forecast for Zurich this week?" or "Will it rain in Bern tomorrow?"

## meteoswissCurrentWeather

Get real-time measurements from any of ~300 Swiss measurement stations (~160 full weather + ~140 precipitation-only). Updated every 10 minutes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `station` | string | No | Station name ("Zurich"), abbreviation ("SMA"), or address ("Bahnhofplatz 1 Bern") |
| `coordinates` | object | No | `{ lat, lon }` in WGS84 — finds nearest station |

Provide either `station` or `coordinates` (not both).

**Returns:** Temperature, precipitation, wind speed/direction, humidity, pressure, sunshine duration, and more.

**Try:** "What's the temperature in Zurich right now?" or "How windy is it at Jungfraujoch?"

## meteoswissStations

Search and browse the MeteoSwiss automatic weather station network.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | No | Search by station name (supports diacritics) |
| `canton` | string | No | Filter by 2-letter canton code (e.g., "ZH", "BE") |
| `limit` | number | No | Maximum results, 1-200 (default: 20) |

**Returns:** Station name, abbreviation, coordinates, elevation, and canton.

## meteoswissPollenData

Get current pollen concentration data from ~15 MeteoSwiss monitoring stations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `station` | string | No | Filter by station name or abbreviation |

**Returns:** Pollen types and concentration levels per station.

## meteoswissClimateData

Get homogeneous climate series from Switzerland's National Basic Climatic Network (NBCN) — 29 climate stations + 46 precipitation stations, with data going back decades.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `station` | string | No | Climate station name ("Zurich") or abbreviation ("BAS") |
| `coordinates` | object | No | `{ lat, lon }` in WGS84 — finds nearest climate station |
| `resolution` | string | No | `daily`, `monthly` (default), or `yearly` |
| `start_date` | string | No | Start date filter (`YYYY-MM-DD`) |
| `end_date` | string | No | End date filter (`YYYY-MM-DD`) |
| `limit` | number | No | Maximum data rows, 1-365 (default: 30) |

**Returns:** Temperature, precipitation, sunshine, radiation, wind, pressure, and climate indicators (frost days, summer days, heat days).

**Try:** "What are typical January temperatures in Zurich?" or "How has precipitation changed in Basel over 50 years?"

## search

Search MeteoSwiss website content across topics and languages (DE, FR, IT, EN).

**Returns:** Search results with titles, descriptions, and URLs.

## fetch

Fetch full content from a MeteoSwiss webpage. Converts HTML to markdown or plain text.

**Returns:** Page content in the requested format.
