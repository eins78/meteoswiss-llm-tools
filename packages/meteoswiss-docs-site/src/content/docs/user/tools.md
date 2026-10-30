---
title: Tools reference
description: Every tool of the MeteoSwiss MCP server - what it answers, its parameters, and example prompts.
---

The server exposes seven tools. The weather tools read [MeteoSwiss Open Government Data](https://opendatadocs.meteoswiss.ch/);
`search` and `fetch` read the MeteoSwiss website. Every tool declares an output schema, so clients see the response shape in `tools/list`
and receive the result as `structuredContent` (the same JSON also comes back as text).

| Tool | Answers | Source |
|------|---------|--------|
| [`meteoswissLocalForecast`](#meteoswisslocalforecast) | What will the weather be like at a place? | OGD forecast |
| [`meteoswissCurrentWeather`](#meteoswisscurrentweather) | What is the weather right now? | OGD measurements |
| [`meteoswissStations`](#meteoswissstations) | Which stations exist, and where? | OGD station metadata |
| [`meteoswissPollenData`](#meteoswisspollendata) | How high is the pollen load? | OGD pollen network |
| [`meteoswissClimateData`](#meteoswissclimatedata) | What is the long-term climate at a station? | OGD NBCN |
| [`search`](#search) | Which MeteoSwiss pages cover a topic? | MeteoSwiss website |
| [`fetch`](#fetch) | What does this MeteoSwiss page say? | MeteoSwiss website |

## meteoswissLocalForecast

A multi-day forecast for any Swiss location: ~6000 points (all postal codes, weather stations and mountain points), up to 9 days
ahead, updated hourly.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `location` | string (max 200) | yes | Postal code (`"8001"`), station abbreviation (`"SMA"`) or place name (`"Zurich"`) |
| `days` | integer 1-9 | no | Number of forecast days, default 5 |

**Returns** per day: minimum and maximum temperature, precipitation total, sunshine minutes, mean wind and maximum gust, a weather
description and the official icon URL. Each day also carries an `hourly` array with one object per hour covering every series
(`temperature_c`, `precip_mm`, `sunshine_minutes`, `wind_kmh`, `wind_gust_kmh`). `hourly` is `null` when a location has no hourly data at all, and `[]` for a day without data.

Things worth knowing:

- Hourly `time` values are **local wall-clock time** (Europe/Zurich) with the UTC offset, e.g. `2026-07-09T14:00:00+02:00`. They are not UTC.
  This was chosen by [measuring how models read the data](../../evaluations/).
- A dry hour is reported as `0`, not omitted. A field is `null` only when that one series has no reading for that hour.

**Try:** "Will it rain in Bern tomorrow afternoon?" · "Wie wird das Wetter in Lugano am Wochenende?"

## meteoswissCurrentWeather

Real-time measurements from ~300 automatic stations (~160 full weather stations plus ~140 precipitation-only stations), updated every
10 minutes. Includes temperature, precipitation, wind, humidity, pressure, sunshine and more; a value is present only when the station
reports it. Precipitation-only stations return rainfall only.

For eight stations (Zurich, Basel, Chur, Sion, Altdorf, Säntis, Jungfraujoch, Grand St-Bernard) the response also contains the daily
visual observations: cloud cover, fog, rain, snowfall, hail and snow cover.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `station` | string (max 200) | one of the two | Station name, abbreviation or an address (`"Bahnhofplatz 1 Bern"`) |
| `coordinates` | `{ lat, lon }` | one of the two | WGS84; the nearest station is used. Takes precedence if both are given |

Coordinates must lie within Switzerland's bounding box (lat 45.5-48, lon 5.9-10.6).

**Try:** "What's the temperature in Zurich right now?" · "How windy is it at Jungfraujoch?"

## meteoswissStations

Searches the station network.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string (max 200) | no | Name or abbreviation |
| `canton` | 2 letters | no | Canton code, e.g. `"ZH"`, `"BE"`, `"GR"` |
| `limit` | integer 1-200 | no | Default 20 |

**Returns** `total` and, per station: abbreviation, name, canton, elevation, coordinates and the date it started reporting.

**Try:** "Which weather stations are in canton Graubünden?"

## meteoswissPollenData

Current pollen concentrations from ~15 monitoring stations. Seven species are measured: alder, birch, hazel, beech, ash, oak and grasses.
Each species always appears; a species with no current reading (out of season) is reported with the status `no-current-data` rather than
omitted. Ragweed (ambrosia) is not part of the OGD measurement network and is therefore not included.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `station` | string (max 200) | no | Station name or abbreviation. Omit for an overview of all stations |

Concentrations are in particles/m³.

**Try:** "How bad are grass pollen in Zurich today?"

## meteoswissClimateData

Homogeneous long-term series from the National Basic Climatic Network (NBCN): 29 climate stations and 46 precipitation stations,
going back decades (monthly and yearly series hold the full history; **daily** data covers only roughly the last two years). Temperature, precipitation, sunshine, radiation, wind, pressure and the climate indicators (frost, summer, heat,
ice and tropical-night counts, rain days).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `station` | string (max 200) | one of the two | NBCN station name or abbreviation (`"Zurich"`, `"BAS"`, `"Davos"`) |
| `coordinates` | `{ lat, lon }` | one of the two | WGS84; takes precedence if both are given |
| `resolution` | `daily` \| `monthly` \| `yearly` | no | Default `monthly`. Daily has temperature min/max/mean; monthly and yearly have the full summary |
| `start_date`, `end_date` | `YYYY-MM-DD` | no | Inclusive filters. A daily request older than the ~2-year window returns no rows, with a note |
| `limit` | integer 1-365 | no | Maximum rows, default 30 |

**Try:** "How has precipitation changed in Basel over 50 years?" · "How many heat days did Lugano have last year?"

## search

Full-text search of the MeteoSwiss website.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string (max 200) | yes | Search text |
| `language` | `de` \| `fr` \| `it` \| `en` | no | Default `de` |
| `contentType` | `content` \| `press-release` \| `blog-article` \| `publication` | no | Default `content`; use `publication` for official reports |
| `page` | integer 1-1000 | no | The upstream API always returns 10 results per page; page size can't be changed, and pages may overlap |
| `sort` | `relevance` \| `date-desc` \| `date-asc` | no | Default `relevance`. `date-asc` degrades relevance badly |

**Try:** "Find MeteoSwiss articles about thunderstorms" · "Search the MeteoSwiss publications on climate change"

## fetch

Fetches a MeteoSwiss page and converts it to markdown or plain text. The `id` is a full page URL, normally one returned by `search`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (max 2048) | yes | Page URL, e.g. `https://www.meteoschweiz.admin.ch/klima/klimawandel/steigende-temperaturen.html` |
| `format` | `markdown` \| `text` | no | Default `markdown` |
| `includeMetadata` | boolean | no | Default `true` |

Query strings, fragments and credentials are dropped from the URL before fetching. The converted page is cached and served
stale-while-revalidate, so a short MeteoSwiss outage does not break repeat requests for pages already seen. `search` has no such fallback.

**Try:** "Get the MeteoSwiss page on rising temperatures and summarise it."

## Prompts

The server also registers four conversation starters: `wetterNordschweiz` and `wetterSchweiz` (German), `meteoSuisseRomande` (French) and `meteoTicino` (Italian).
They are optional; clients that don't surface MCP prompts simply don't show them.
