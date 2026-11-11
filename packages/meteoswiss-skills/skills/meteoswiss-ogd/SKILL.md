---
name: meteoswiss-ogd
description: >-
  Use when the user asks about Swiss weather, MeteoSwiss data, or Swiss weather
  forecasts and no MCP server is available. Covers current weather, forecasts,
  pollen, and station discovery via direct HTTP. No API key required.
globs: []
license: CC0-1.0
metadata:
  author: eins78
  repo: https://github.com/eins78/meteoswiss-llm-tools
  version: 1.1.0
compatibility: claude-code, cursor
---

# MeteoSwiss Open Data

Access Swiss weather data from MeteoSwiss Open Government Data. Free, no API key. All data from `data.geo.admin.ch`. CSVs use **semicolon** (`;`) delimiters. Metadata CSVs are Latin1 — pipe through `iconv -f latin1 -t utf-8`.

## Quick Reference

| Data | URL / Method | Updates |
|------|-------------|---------|
| Current weather | `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-aktuell/VQHA80.csv` | 10 min |
| Station metadata | STAC `ch.meteoschweiz.ogd-smn` → asset `ogd-smn_meta_stations.csv` (Latin1) | Daily |
| Forecast metadata | STAC `ch.meteoschweiz.ogd-local-forecasting` → asset containing `meta_point.csv` (Latin1) | Daily |
| Forecast data | STAC items in `ch.meteoschweiz.ogd-local-forecasting` → parameter CSVs | Hourly |
| Pollen data | `https://data.geo.admin.ch/ch.meteoschweiz.ogd-pollen/{abbr}/ogd-pollen_{abbr}_d_recent.csv` (Latin1) | Daily |
| Climate data | `https://data.geo.admin.ch/ch.meteoschweiz.ogd-nbcn/{abbr}/ogd-nbcn_{abbr}_{res}.csv` (res: `m`, `y`, `d_recent`) | Daily (`d_recent`); `m`/`y` as periods close |

STAC API base: `https://data.geo.admin.ch/api/stac/v1`

## 1. Get Current Weather

<!-- mcp-tool: meteoswissCurrentWeather -->

```bash
# Get weather for Zurich (station SMA) — key columns: tre200s0 (temp °C),
# ure200s0 (humidity %), rre150z0 (precip mm), fu3010z0 (wind km/h)
curl -s 'https://data.geo.admin.ch/ch.meteoschweiz.messwerte-aktuell/VQHA80.csv' \
  | awk -F';' 'NR==1 || $1=="SMA"'
```

Full parameter list in `${CLAUDE_SKILL_DIR}/REFERENCE.md`. Missing values appear as empty fields or `-`. Timestamps are `YYYYMMDDHHmm` in UTC.

## 2. Find Stations

<!-- mcp-tool: meteoswissStations -->

```bash
# Search weather stations by name (Latin1 encoded)
curl -s 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/ogd-smn_meta_stations.csv' \
  | iconv -f latin1 -t utf-8 \
  | awk -F';' 'NR==1 || tolower($0) ~ /zurich/'
```

Columns: `station_abbr`, `station_name`, `station_canton`, `station_height_masl`, `station_coordinates_wgs84_lat`, `station_coordinates_wgs84_lon`.

```bash
# Search forecast locations (~6000 points: stations, postal codes, mountains)
# NOTE: Asset key has a known typo "forcasting" — always get URL from STAC
META_URL=$(curl -s 'https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-local-forecasting' \
  | jq -r '[.assets | to_entries[] | select(.key | contains("meta_point")) | .value.href] | first')
curl -s "$META_URL" | iconv -f latin1 -t utf-8 \
  | awk -F';' 'NR==1 || $3 ~ /8001/'  # search by postal code
```

Point columns: `point_id`, `point_type_id` (1=station, 2=postal_code, 3=mountain), `postal_code`, `station_abbr`, `point_name`.

## 3. Get Forecasts

<!-- mcp-tool: meteoswissLocalForecast -->

Two steps: get the latest STAC item, then download parameter CSVs.

```bash
# Step 1: Get latest forecast item WITH assets (a brand-new item can exist with its
# assets not yet uploaded — skip those or every parameter comes back empty)
ITEM=$(curl -s 'https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-local-forecasting/items?limit=10' \
  | jq -r '[.features[] | select((.assets | length) > 0) | .id] | sort | reverse | .[0]')

# Step 2: Get a parameter CSV (e.g., daily max temperature for Zurich station, point_id=71)
ASSET_URL=$(curl -s "https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-local-forecasting/items/$ITEM" \
  | jq -r '[.assets | to_entries[] | select(.key | contains("tre200dx"))] | sort_by(.key) | last | .value.href')
curl -s "$ASSET_URL" | awk -F';' 'NR==1 || $1=="71"'
```

**Station forecasts** (point_type_id=1) have official daily params: `tre200dx` (max temp), `tre200dn` (min temp), `rka150d0` (precip), `jp2000d0` (weather icon). **Every point type** (stations, postal codes, mountains) also has hourly params: `tre200h0` (temp), `rre150h0` (precip), `sre000h0` (sunshine), `fu3010h0` (wind speed), `fu3010h1` (wind gust) — plus `jww003i0` (weather pictogram code, one value per hour, describing the 3 hours that end at the timestamp) and the cloud cover `nprolohs`, `npromths`, `nprohihs` (low, medium, high; fraction 0-1, instantaneous). Timestamps are `YYYYMMDDHHmm` in UTC, so grouping on the first 8 chars aggregates by UTC calendar day. The MCP server instead buckets hourly readings by the **local Europe/Zurich calendar day** (DST-aware), so a UTC-day grouping and the MCP tool's `hourly[]` can disagree for late-evening UTC hours that fall on the next local day — convert to Europe/Zurich time first if you need exact parity with the MCP tool's daily buckets. For stations, prefer the official daily params for temp/precip (a separately-curated MeteoSwiss product that may not exactly match summing/averaging the hourly series); use the hourly params for sunshine/wind (no official daily product) and for an hourly breakdown. Common station point_ids: Zurich (SMA)=71, Bern (BER)=78, Geneva (GVE)=58.

**Weather icon SVGs**: `https://www.meteoschweiz.admin.ch/static/resources/weather-symbols/{CODE}.svg` — replace `{CODE}` with the numeric icon code (e.g., `1.svg` for sunny, `101.svg` for clear night). See `${CLAUDE_SKILL_DIR}/REFERENCE.md` for all codes.

## 4. Get Pollen Data

<!-- mcp-tool: meteoswissPollenData -->

```bash
# Stations: PBE, PBS, PBU, PCF, PDS, PGE, PJU, PLO, PLS, PLU, PLZ, PMU, PNE, PPY, PSN, PZH
# Use lowercase in URLs
curl -s 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-pollen/pzh/ogd-pollen_pzh_d_recent.csv' \
  | iconv -f latin1 -t utf-8 \
  | awk -F';' 'NR==1{print} {last=$0} END{print last}'
```

Columns: `station_abbr`, `reference_timestamp`, then pollen parameter codes (e.g. `kabetud1`=birch, `khpoacd1`=grasses) in particles/m³. See `${CLAUDE_SKILL_DIR}/REFERENCE.md` for all codes.

## 5. Get Climate Data

<!-- mcp-tool: meteoswissClimateData -->

Homogeneous climate series from the NBCN network (29 climate + 46 precipitation-only stations), going back decades. Monthly (`_m`) and yearly (`_y`) files hold all history; daily is `_d_recent` (last ~2 years, `_d_historical` for older).

```bash
# Yearly climate summary for Zurich (SMA) — key columns: ths200y0 (mean temp °C),
# rhs150y0 (precip mm), shs000y0 (sunshine min), ths30xy0 (heat days)
curl -s 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-nbcn/sma/ogd-nbcn_sma_y.csv' \
  | awk -F';' 'NR==1 || NR>2 {print}' | tail -5
```

Monthly columns use `m` in place of `y` (e.g. `ths200m0`); daily uses `d` (`ths200d0`). Timestamps are `DD.MM.YYYY HH:MM`. Station list: STAC `ch.meteoschweiz.ogd-nbcn` → asset `ogd-nbcn_meta_stations.csv` (Latin1). Precipitation-only stations live in `ch.meteoschweiz.ogd-nbcn-precip` with the same URL pattern. See `${CLAUDE_SKILL_DIR}/REFERENCE.md` for all parameter codes.

## Error Handling

- **Station not found**: Check metadata CSV (Section 2) for valid abbreviations
- **Empty data**: Station may be offline — try a nearby station
- **403/404 on pollen**: Verify abbreviation is lowercase and is a pollen station (16 total; see the list in the pollen section)
- **Garbled text**: You're reading Latin1 as UTF-8 — add `iconv -f latin1 -t utf-8`

## Bundled Scripts

Token-efficient CLI tools that output structured key=value pairs. Use these instead of raw curl when available — they handle encoding, error checking, and output parsing.

```bash
${CLAUDE_SKILL_DIR}/scripts/current-weather.sh SMA          # current weather for Zurich
${CLAUDE_SKILL_DIR}/scripts/search-stations.sh zurich        # find weather stations
${CLAUDE_SKILL_DIR}/scripts/search-forecast-points.sh 8001   # find forecast point_id by postal code
${CLAUDE_SKILL_DIR}/scripts/forecast.sh 71                   # forecast for Zurich (point_id=71)
${CLAUDE_SKILL_DIR}/scripts/pollen.sh PZH                    # pollen data for Zurich
```

All scripts accept `--help` for usage details. Requires: `curl`, `awk`, `iconv`. Forecast also needs `jq`.

## MCP Server Alternative

For complex queries (fuzzy search, geocoding, structured JSON), use the MCP server: `claude mcp add meteoswiss https://meteoswiss-mcp.ars.is/mcp`

## Full Reference

See `${CLAUDE_SKILL_DIR}/REFERENCE.md` for all parameters, weather icon codes, and STAC collections.
