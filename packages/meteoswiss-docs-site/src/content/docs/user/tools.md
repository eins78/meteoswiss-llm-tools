---
title: Tools reference
description: Every tool of the MeteoSwiss MCP server - what it answers, its parameters, and example prompts.
---

The server exposes eight tools. The weather tools read [MeteoSwiss Open Government Data](https://opendatadocs.meteoswiss.ch/);
`search` and `fetch` read the MeteoSwiss website. Every tool declares an output schema, so clients see the response shape in `tools/list`
and receive the result as `structuredContent` (the same JSON also comes back as text).

| Tool | Answers | Source |
|------|---------|--------|
| [`meteoswissLocalForecast`](#meteoswisslocalforecast) | What will the weather be like at a place? | OGD forecast |
| [`meteoswissWeatherSituation`](#meteoswissweathersituation) | Where in Switzerland is it sunny, foggy or wet at a given hour? | OGD forecast, MeteoSwiss forecast regions |
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
(`temperature_c`, `precip_mm`, `sunshine_minutes`, `wind_kmh`, `wind_gust_kmh`). The optional input `detail` defaults to `"basic"`;
with `detail: "sky"` each hourly object also has `weather_code`, `weather`, `cloud_low_pct`, `cloud_mid_pct` and `cloud_high_pct` —
`weather` is MeteoSwiss's symbol for the hour (for example fog or stratus) and the cloud fields are % of the sky. The five sky fields
come only with `"sky"`, which makes the answer about 75 % larger. If one of the extra files cannot be loaded, the call still
succeeds: the fields from that file are null and `warnings` names the file. `hourly` is `null` when a location has no hourly data at all, and `[]` for a day without data.

Things worth knowing:

- Hourly `time` values are **local wall-clock time** (Europe/Zurich) with the UTC offset, e.g. `2026-07-09T14:00:00+02:00`. They are not UTC.
  This was chosen by [measuring how models read the data](../../evaluations/).
- A dry hour is reported as `0`, not omitted. A field is `null` only when that one series has no reading for that hour.

**Try:** "Will it rain in Bern tomorrow afternoon?" · "Wie wird das Wetter in Lugano am Wochenende?"

## meteoswissWeatherSituation

The weather over the whole country at one hour: MeteoSwiss's hourly weather symbol at all ~5800 forecast points, grouped into ten
weather categories and counted per [forecast region](https://www.meteoswiss.admin.ch/services-and-publications/applications/forecast-regions.html)
and altitude band. For area questions: where it is sunny, how high the fog reaches, whether the sun shines above it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `time` | string | yes | The hour, in local Swiss time: `"2026-11-14T10:00"`. A time with an offset (as `meteoswissLocalForecast` returns it) works too |
| `until` | string | no | Last hour of a window (included), at most 12 h after `time`; every hour in between is counted |
| `region` | string | no | One of the seven region ids below; default all seven |
| `bbox` | number[4] | no | Only points in a WGS84 box `[west, south, east, north]` |
| `near` | object | no | Only points within `radius_km` (air distance, at most 150 km) of `lat`/`lon` |
| `min_altitude_m`, `max_altitude_m` | integer | no | Only points at or above / at or below this altitude |
| `bands` | number[] | no | Altitude band edges in m, ascending; default `[500, 1000, 1500, 2000]`, `[]` for one band |

`region`, `bbox`, `near` and the altitude limits combine: a point must pass all of them.

**Returns** the counted hours (`valid`), the forecast run, the number of points, and per region its points, its most frequent category
and its altitude bands. Each band has its points, the share of each category in whole percent (`pct`, adding up to 100) and the most
frequent category. Over a window the points stay points, and the shares are shares of point-hours. A `legend` explains the categories
in the answer. The answer is about 3–4 KB.

| Region id | MeteoSwiss name |
|-----------|-----------------|
| `jura` | Jura |
| `mittelland` | Mittelland (Swiss Plateau) |
| `alpennordhang` | Alpennordhang (northern Alps and Prealps) |
| `wallis` | Wallis (Valais) |
| `engadin` | Engadin |
| `nordundmittelbuenden` | Nord- und Mittelbünden (northern and central Grisons) |
| `alpensuedseite` | Alpensüdseite (southern side of the Alps) |

Categories: `sunny`, `clear_night`, `partly_sunny`, `cloudy`, `high_cloud`, `fog_or_stratus`, `rain`, `sleet`, `snow`, `thunder`.

Things worth knowing:

- **Fog and low stratus need the cloud cover.** MeteoSwiss's symbol often shows a low cloud deck as "overcast". An overcast or partly
  sunny hour with low cloud of at least 80 % and medium and high cloud below 50 % counts as `fog_or_stratus`. If a cloud cover file
  cannot be loaded, this rule is off and `warnings` says so.
- **Fog top (experimental).** Jura, Mittelland and Alpennordhang also carry `fog_top_m`: the top of a fog sea to the nearest 100 m.
  It is found in 100 m bands with at least 5 points: the layer starts at the lowest band that is mostly `fog_or_stratus` (it must
  start below 1000 m; the lowest corners of a region may stay clear), goes up as long as the bands stay so, and at least 60 % of
  the points in the 300 m above must be sunny, partly sunny or a clear night (`sunny_above_fog_pct`). Otherwise it is `null`: no
  fog layer low down, or cloud above it. The thresholds are a first guess and are being checked against observed fog mornings.
- **Points, not area.** The forecast points are postal code centres, weather stations and mountain points: dense in towns and the
  lowlands, sparse in the mountains. A band with few points says little.
- **Regions.** The seven regions are MeteoSwiss's own split of the country. MeteoSwiss does not publish them as Open Data: the server
  downloads them from the MeteoSwiss website and keeps them for 30 days (Source: MeteoSwiss; see
  [Configuration](../../operator/configuration/)). About 50 points (the Urseren valley, some border peaks and passes) lie outside
  all seven; they are counted in the nearest region.
- An hour the forecast run does not cover is an error that names the hours it has.

**Try:** "Where is it sunny on Saturday at 10:00?" · "Wie hoch reicht der Nebel morgen früh?"

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
