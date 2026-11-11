# MeteoSwiss Open Data: Comprehensive Report & MCP Server Improvement Pitch

> Research date: 2026-03-28. All endpoints and data verified with live requests.

## Table of Contents

1. [Overview & Background](#1-overview--background)
2. [Data Categories & Collections](#2-data-categories--collections)
3. [Data Formats & Encodings](#3-data-formats--encodings)
4. [Access Methods & API Endpoints](#4-access-methods--api-endpoints)
5. [Geographic Coverage & Resolution](#5-geographic-coverage--resolution)
6. [Terms of Use & Attribution](#6-terms-of-use--attribution)
7. [Key Resources & Documentation](#7-key-resources--documentation)
8. [Third-Party APIs](#8-third-party-apis)
9. [Improvement Pitch: New MCP Server Tools](#9-improvement-pitch-new-mcp-server-tools)

---

## 1. Overview & Background

MeteoSwiss launched its Open Government Data (OGD) initiative on **May 22, 2025**, making Switzerland's official meteorological data freely available for any purpose. This was driven by:

- **Swiss federal law** mandating open access to government data
- **EU High-Value Datasets (HVD) Directive** requiring meteorological data publication
- Switzerland's commitment to open government data via [opendata.swiss](https://opendata.swiss)

All data is published under **Creative Commons CC BY 4.0** — free for any purpose including commercial use, requiring only source attribution.

Data is hosted on the **Federal Spatial Data Infrastructure (FSDI)** at `data.geo.admin.ch`, using the **OGC SpatioTemporal Asset Catalog (STAC) API** standard. No authentication is required for any data access.

---

## 2. Data Categories & Collections

MeteoSwiss publishes approximately 21 STAC collections across 5 major categories. Additional datasets are being released on an ongoing basis.

### A. Ground-Based Measurements (9 collections)

| Collection ID | Description | Stations | Temporal Resolution | Update Frequency |
|---|---|---|---|---|
| `ch.meteoschweiz.ogd-smn` | Automatic weather stations (SwissMetNet) | ~160 | 10-min, hourly, daily, monthly, yearly | ~10 min (now), daily (recent), yearly (historical) |
| `ch.meteoschweiz.ogd-smn-precip` | Automatic precipitation stations | ~140 | 10-min, hourly, daily, monthly, yearly | Same as above |
| `ch.meteoschweiz.ogd-smn-tower` | Tower stations (profiles) | 3 | 10-min, hourly, daily, monthly, yearly | Same as above |
| `ch.meteoschweiz.ogd-nime` | Manual precipitation stations | ~240 | Daily, monthly, yearly | Daily |
| `ch.meteoschweiz.ogd-obs` | Visual meteorological observations | ~20 | 2-8x daily, monthly, yearly | Several times daily |
| `ch.meteoschweiz.ogd-tot` | Totaliser precipitation stations | ~60 | Monthly, yearly | Monthly |
| `ch.meteoschweiz.ogd-pollen` | Pollen monitoring | ~15 | Hourly, daily | Daily |
| `ch.meteoschweiz.ogd-phenology` | Phenological observations (26 plant species) | ~160 | Seasonal, yearly | Seasonal |
| `ch.meteoschweiz.ogd-smn-soil` | Soil moisture stations | — | — | **Planned for 2026** |

#### Key parameters (automatic weather stations, `ogd-smn`):

| Code | Parameter | Unit |
|---|---|---|
| `tre200s0` | Air temperature (2m above ground) | C |
| `tre005s0` | Air temperature (5cm above ground) | C |
| `ure200s0` | Relative humidity (2m) | % |
| `tde200s0` | Dew point temperature (2m) | C |
| `rre150z0` | Precipitation (10-min sum) | mm |
| `sre000z0` | Sunshine duration (10-min sum) | min |
| `gre000z0` | Global radiation (10-min mean) | W/m2 |
| `dkl010z0` | Wind direction (10-min mean) | degrees |
| `fu3010z0` | Wind speed (10-min mean) | km/h |
| `fu3010z1` | Wind gust peak (max) | km/h |
| `prestas0` | Atmospheric pressure at station (QFE) | hPa |
| `pp0qffs0` | Pressure reduced to sea level (QFF) | hPa |
| `pp0qnhs0` | Pressure (QNH standard atmosphere) | hPa |
| `htoauts0` | Snow depth | cm |
| `wcc006s0` | Cloud cover (coded) | Code |

Full parameter list: download `ogd-smn_meta_parameters.csv` from the collection metadata assets (33 parameters at 10-min resolution).

### B. Atmosphere (1 collection, 5 more planned)

| Collection ID | Description | Location | Frequency |
|---|---|---|---|
| `ch.meteoschweiz.ogd-radiosounding` | Radio soundings (atmospheric profiles) | Payerne | 2x daily |

### C. Climate Data (5 collections)

| Collection ID | Description | Notes |
|---|---|---|
| `ch.meteoschweiz.ogd-nbcn` | Homogeneous climate series | Long-term quality-controlled data |
| `ch.meteoschweiz.ogd-nbcn-precip` | Homogeneous precipitation series | Long-term precipitation |
| `ch.meteoschweiz.ogd-climate-normals` | Climate normals (1991-2020) | 30-year averages by station |
| `ch.meteoschweiz.ogd-climate-scenarios` | CH2025 climate scenarios (local) | Future projections per station |
| `ch.meteoschweiz.ogd-climate-scenarios-gridded` | CH2025 climate scenarios (gridded) | Future projections on grid (NetCDF) |

### D. Radar Data (2 collections, 3 more planned)

| Collection ID | Description | Products | Update Frequency |
|---|---|---|---|
| `ch.meteoschweiz.ogd-radar-precip` | Precipitation radar | PRECIP, CPC (CombiPrecip) | Every 5 min (PRECIP) / 10 min (CPC) |
| `ch.meteoschweiz.ogd-radar-hail` | Hail radar | POH, MESHS | Every 5 minutes |

### E. Forecast Data (4 collections)

| Collection ID | Description | Resolution | Horizon | Update Freq |
|---|---|---|---|---|
| `ch.meteoschweiz.ogd-forecasting-icon-ch1` | ICON-CH1-EPS (high-res NWP) | 1 km grid | 33 hours | Every 3 hours |
| `ch.meteoschweiz.ogd-forecasting-icon-ch2` | ICON-CH2-EPS (extended NWP) | 2.1 km grid | 120 hours | Every 6 hours |
| `ch.meteoschweiz.ogd-nowcasting` | Nowcasting | Variable | 0-6 hours | **Planning pending** |
| `ch.meteoschweiz.ogd-local-forecasting` | Local point forecasts | ~6000 points | 9 days | Hourly |

#### Local forecast data (key details):

The local forecast collection is particularly valuable — it provides the **same forecast data powering the MeteoSwiss app and website**.

- **Coverage**: ~6000 points — all Swiss postal codes, SwissMetNet stations, and mountain POIs (peaks, passes, huts)
- **Horizon**: 9 full days including current day
- **Update frequency**: New forecasts available every hour
- **Parameters**: ~35 forecast parameters including:

| Code | Parameter | Granularity | Unit |
|---|---|---|---|
| `tre200h0` | Air temperature (2m, hourly mean) | Hourly | C |
| `tre200dx` | Air temperature (daily max) | Daily | C |
| `tre200dn` | Air temperature (daily min) | Daily | C |
| `treq10h0` | Temperature (10th percentile) | Hourly | C |
| `treq90h0` | Temperature (90th percentile) | Hourly | C |
| `rre150h0` | Precipitation (hourly total) | Hourly | mm |
| `rre003i0` | Precipitation (3-hour total) | Hourly (each value: preceding 3 h) | mm |
| `rka150d0` | Precipitation (daily total) | Daily | mm |
| `fu3010h0` | Wind speed (hourly mean) | Hourly | km/h |
| `fu3010h1` | Wind gust peak (hourly max) | Hourly | km/h |
| `dkl010h0` | Wind direction (hourly mean) | Hourly | degrees |
| `gre000h0` | Global radiation (hourly mean) | Hourly | W/m2 |
| `sre000h0` | Sunshine duration (hourly total) | Hourly | min |
| `nprolohs` | Low cloud cover | Hourly | fraction |
| `npromths` | Medium cloud cover | Hourly | fraction |
| `nprohihs` | High cloud cover | Hourly | fraction |
| `zprfr0hs` | Zero-degree level | Hourly | m |
| `jww003i0` | MeteoSwiss weather pictogram (3h) | Hourly (each value: preceding 3 h) | Code |
| `jp2000d0` | MeteoSwiss pictogram (daily) | Daily | Code |

---

## 3. Data Formats & Encodings

### CSV (Primary format for measurements and forecasts)

- **Delimiter**: Semicolon (`;`)
- **Encoding**: Windows-1252 (station data) or Latin1/ISO-8859-1 (forecast data)
- **Missing values**: Empty field between delimiters, or `-`
- **Timestamps**: `YYYYMMDDHHMM` format in UTC
- **Time reference**: "00:40 UTC = 02:40 local (CH) summer time, 01:40 winter time"

**Station measurement CSV example** (consolidated real-time, `VQHA80.csv`):
```
Station/Location;Date;tre200s0;rre150z0;sre000z0;gre000z0;ure200s0;tde200s0;dkl010z0;fu3010z0;fu3010z1;prestas0;pp0qffs0;pp0qnhs0;ppz850s0;ppz700s0;...
TAE;202603281520;4.00;0.00;0.00;98.00;67.80;-1.40;227.00;10.40;22.00;955.30;1020.30;1018.70;-;-;...
ABO;202603281520;-0.30;0.00;0.00;153.00;68.70;-5.30;70.00;7.90;12.60;866.60;-;1016.50;1480.40;-;...
```

**Per-station 10-min CSV** (`ogd-smn_{station}_t_now.csv`):
```
station_abbr;reference_timestamp;tre200s0;tre005s0;tresurs0;xchills0;ure200s0;tde200s0;...
ABO;28.03.2026 00:00;-5.1;-5.7;-5.9;-7.6;71;-9.5;...
ABO;28.03.2026 00:10;-5;-5.7;-5.8;-8.4;71.6;-9.3;...
```

**Local forecast CSV** (one file per parameter per forecast run):
```
point_id;point_type_id;Date;tre200h0
1;1;202603252100;-5.9
2;1;202603252100;2.0
965800;2;202604040000;-0.6
```

### Other Formats

| Format | Used For | Notes |
|---|---|---|
| **GRIB2** | NWP model output (ICON-CH1, ICON-CH2) | Binary, requires specialized libraries |
| **HDF5** | Radar data | Binary, hierarchical |
| **NetCDF** | Nowcasting, gridded climate scenarios | Binary, self-describing |
| **JSON/GeoJSON** | Legacy real-time endpoints | Coordinates in Swiss LV95 (EPSG:2056) |

### Legacy GeoJSON Format (real-time endpoints)

```json
{
  "type": "Feature",
  "id": "ARO",
  "geometry": {
    "type": "Point",
    "coordinates": [2771032.30, 1184823.00]
  },
  "properties": {
    "station_name": "Arosa",
    "value": -2.2,
    "unit": "°C",
    "reference_ts": "2026-03-28T15:20:00Z",
    "altitude": "1880.00"
  }
}
```

Note: Coordinates use **EPSG:2056 (Swiss LV95/CH1903+)**, not WGS84. Conversion is required for standard lat/lon.

---

## 4. Access Methods & API Endpoints

### 4.1 STAC API (Primary, recommended)

The OGC-compliant STAC API provides structured access to all collections and their data assets. No authentication required.

**Base URL**: `https://data.geo.admin.ch/api/stac/v1/`

| Endpoint | Description |
|---|---|
| `GET /collections` | List all available collections |
| `GET /collections/{id}` | Collection detail + metadata asset URLs |
| `GET /collections/{id}/items` | List items (stations/dates) with data asset URLs |
| `GET /collections/{id}/items/{itemId}` | Single item detail |

**Query parameters** (for items endpoint):
- `limit` — max items per page (default varies)
- `bbox` — bounding box filter `[minLon,minLat,maxLon,maxLat]`
- `datetime` — temporal filter

**Example workflow** — get current weather for Adelboden (ABO):
```
1. GET /collections/ch.meteoschweiz.ogd-smn/items/abo
   → Returns item with asset URLs

2. Download asset: ogd-smn_abo_t_now.csv
   → https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/abo/ogd-smn_abo_t_now.csv
```

**Example workflow** — get local forecast:
```
1. GET /collections/ch.meteoschweiz.ogd-local-forecasting/items?limit=1
   → Returns latest forecast item (e.g., "20260326-ch")

2. Download temperature forecast asset:
   → https://data.geo.admin.ch/ch.meteoschweiz.ogd-local-forecasting/20260326-ch/vnut12.lssw.202603260000.tre200h0.csv
```

### 4.2 Direct CSV Downloads

**Consolidated real-time measurements** (all ~160 stations, 20 parameters, updated every 10 minutes):
```
https://data.geo.admin.ch/ch.meteoschweiz.messwerte-aktuell/VQHA80.csv
```

**Per-station data** (URL pattern):
```
https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/{station_lower}/{filename}.csv
```

File naming convention: `ogd-smn_{station}_{granularity}_{period}.csv`
- **Granularity codes**: `t` (10-min), `h` (hourly), `d` (daily), `m` (monthly), `y` (yearly)
- **Period types**: `now` (real-time), `recent` (last ~year), `historical_YYYY-YYYY` (decade archives)

Examples:
```
ogd-smn_abo_t_now.csv          # Adelboden, 10-min, current data
ogd-smn_abo_h_recent.csv       # Adelboden, hourly, recent period
ogd-smn_abo_d_historical_2010-2019.csv  # Adelboden, daily, 2010s archive
```

**Forecast data** (URL pattern):
```
https://data.geo.admin.ch/ch.meteoschweiz.ogd-local-forecasting/{date}-ch/vnut12.lssw.{YYYYMMDDhhmm}.{param}.csv
```

### 4.3 Metadata Assets

Each STAC collection provides metadata CSV files at the collection level:

| File | Contents |
|---|---|
| `ogd-smn_meta_stations.csv` | Station names, codes, cantons, WGS84 + LV95 coordinates, elevation, data-since dates, detail page URLs |
| `ogd-smn_meta_parameters.csv` | Parameter codes, descriptions (4 languages), units, data types, decimal places |
| `ogd-smn_meta_datainventory.csv` | Station × parameter availability with start/end dates |
| `ogd-local-forecasting_meta_point.csv` | All ~6000 forecast points with type, postal code, name, coordinates, elevation |
| `ogd-local-forecasting_meta_parameters.csv` | All ~35 forecast parameter definitions |

**Station metadata sample** (CSV, semicolon-delimited):
```
station_abbr;station_name;station_canton;station_wigos_id;...;station_height_masl;station_coordinates_wgs84_lat;station_coordinates_wgs84_lon
ABO;Adelboden;BE;0-20000-0-06735;...;1321.0;46.491703;7.560703
```

**Forecast point metadata sample**:
```
point_id;point_type_id;station_abbr;postal_code;point_name;...;point_coordinates_wgs84_lat;point_coordinates_wgs84_lon
1;1;ARO;;Arosa;...;46.792661;9.679014
1000;2;;1000;Lausanne;...;46.533333;6.633333
```

Point types: `1` = weather station, `2` = postal code area, `3` = mountain point of interest.

### 4.4 Legacy Real-Time JSON Endpoints

Nine measurement parameters available as GeoJSON, updated every 10 minutes, covering all ~160 stations:

| Parameter | Endpoint |
|---|---|
| Temperature | `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-lufttemperatur-10min/ch.meteoschweiz.messwerte-lufttemperatur-10min_en.json` |
| Precipitation | `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-niederschlag-10min/ch.meteoschweiz.messwerte-niederschlag-10min_en.json` |
| Wind speed | `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-windgeschwindigkeit-kmh-10min/ch.meteoschweiz.messwerte-windgeschwindigkeit-kmh-10min_en.json` |
| Sunshine | `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-sonnenscheindauer-10min/ch.meteoschweiz.messwerte-sonnenscheindauer-10min_en.json` |
| Humidity | `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-luftfeuchtigkeit-10min/ch.meteoschweiz.messwerte-luftfeuchtigkeit-10min_en.json` |
| Snow depth | `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-schneehöhe/ch.meteoschweiz.messwerte-schneehöhe_en.json` |
| Foehn index | `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-foehn-10min/ch.meteoschweiz.messwerte-foehn-10min_en.json` |
| Radiation | `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-globalstrahlung-10min/ch.meteoschweiz.messwerte-globalstrahlung-10min_en.json` |
| Dew point | `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-taupunkt-10min/ch.meteoschweiz.messwerte-taupunkt-10min_en.json` |

Language suffixes: `_de.json`, `_fr.json`, `_it.json`, `_en.json`

**Important**: Coordinates are in Swiss LV95 (EPSG:2056), not WGS84. Conversion formula:
- Approximate: subtract 2,000,000 from easting, 1,000,000 from northing, then apply CH1903+ → WGS84 transform
- Station metadata CSVs include both LV95 and WGS84 coordinates

### 4.5 Planned: OGC API Features + EDR (Q2 2026)

MeteoSwiss is developing query-based APIs (OGC API - Features and Environmental Data Retrieval) for more targeted data access. GitHub placeholder: [github.com/MeteoSwiss/opendata-api](https://github.com/MeteoSwiss/opendata-api).

### 4.6 Caching & Best Practices

- Use **ETags** and conditional requests (`If-None-Match`) to avoid redundant downloads
- Default cache: **2 hours** for most data, **10 seconds** for 10-minute real-time data
- Each STAC asset includes `file:checksum` (SHA256) for integrity verification
- Avoid excessive download frequency — swisstopo reserves the right to throttle

---

## 5. Geographic Coverage & Resolution

### Station Networks

| Network | Stations | Coverage |
|---|---|---|
| SwissMetNet (automatic weather) | ~160 | All of Switzerland, various elevations (200m–3500m+) |
| Precipitation stations | ~140 | Supplementary to SwissMetNet across Swiss territory |
| Tower stations | 3 | Vertical profiles at 150–230m above ground |
| Manual precipitation | ~240 | Complementary to automatic network (190 rain+snow, 50 snow only) |
| Pollen monitoring | ~15 | Major climatic and vegetation regions |
| Phenological observations | ~160 | Distributed across climate zones |
| Totalisers | ~60 | Remote/alpine locations |

### Forecast Grid

| Product | Resolution | Coverage |
|---|---|---|
| ICON-CH1-EPS | 1 km | Switzerland + surrounding area |
| ICON-CH2-EPS | 2.1 km | Switzerland + wider region |
| Local forecasts | ~6000 points | All Swiss postal codes, stations, mountain POIs |

### Radar Coverage

Five radar sites provide **full coverage of Swiss territory** with 5-minute update cycles for both precipitation and hail detection.

---

## 6. Terms of Use & Attribution

### License

**Creative Commons Attribution 4.0 (CC BY 4.0)**

### What's Allowed

- Copy and redistribute in any format
- Remix, modify, and build upon the data
- **Commercial use permitted**
- No registration or authentication required

### Requirements

- **Attribution**: "Source: MeteoSwiss" (or language equivalent: "Quelle: MeteoSchweiz", "Source: MétéoSuisse", "Fonte: MeteoSvizzera")
- Attribution must not suggest MeteoSwiss endorses your specific use

### Restrictions

- Weather warnings may only be reproduced "promptly" with unaltered content
- Infrastructure use must be "only to the extent necessary to access the data"
- **Prohibited**: misuse intended to damage infrastructure, blocking availability, or excessive/high-frequency downloading of the same content
- Access may be "restricted or blocked" for violations
- No formal rate limits documented, but swisstopo reserves the right to throttle

### Liability

MeteoSwiss provides "no guarantee for the correctness of content, accuracy, up-to-dateness, reliability or completeness." All warranties excluded to the extent permitted by law.

---

## 7. Key Resources & Documentation

| Resource | URL |
|---|---|
| **Official OGD documentation** | [opendatadocs.meteoswiss.ch](https://opendatadocs.meteoswiss.ch) |
| **STAC API** | [data.geo.admin.ch/api/stac/v1/](https://data.geo.admin.ch/api/stac/v1/) |
| **STAC Browser** | [data.geo.admin.ch/browser/](https://data.geo.admin.ch/browser/) |
| **STAC API specification** | [data.geo.admin.ch/api/stac/static/spec/v1/api.html](https://data.geo.admin.ch/api/stac/static/spec/v1/api.html) |
| **GitHub: Main repo** | [github.com/MeteoSwiss/opendata](https://github.com/MeteoSwiss/opendata) |
| **GitHub: Download guide** | [github.com/MeteoSwiss/opendata-download](https://github.com/MeteoSwiss/opendata-download) |
| **GitHub: Forecast data** | [github.com/MeteoSwiss/opendata-forecast-data](https://github.com/MeteoSwiss/opendata-forecast-data) |
| **GitHub: Radar data** | [github.com/MeteoSwiss/opendata-radar-data](https://github.com/MeteoSwiss/opendata-radar-data) |
| **GitHub: Climate data** | [github.com/MeteoSwiss/opendata-climate-data](https://github.com/MeteoSwiss/opendata-climate-data) |
| **GitHub: NWP demos** | [github.com/MeteoSwiss/opendata-nwp-demos](https://github.com/MeteoSwiss/opendata-nwp-demos) |
| **GitHub: API (placeholder)** | [github.com/MeteoSwiss/opendata-api](https://github.com/MeteoSwiss/opendata-api) |
| **Swiss Open Data portal** | [opendata.swiss (MeteoSwiss)](https://opendata.swiss/en/organization/bundesamt-fur-meteorologie-und-klimatologie-meteoschweiz) |
| **MeteoSwiss contact** | [Contact form](https://www.meteoswiss.admin.ch/about-us/contact/contact-form.html) |

---

## 8. Third-Party APIs

These community-maintained APIs provide developer-friendly access to MeteoSwiss data:

### Open-Meteo

REST API wrapping MeteoSwiss NWP model data (ICON-CH1/CH2) with standard JSON responses and WGS84 coordinates.

```
https://api.open-meteo.com/v1/forecast?models=meteoswiss_icon_ch1&latitude=47.37&longitude=8.55&hourly=temperature_2m
```

- No authentication, generous rate limits
- Standard JSON with WGS84 coordinates
- Hourly and daily aggregations
- Multiple weather parameters

### Existenz.ch

Simplified REST API for MeteoSwiss station data with JSON responses and CORS support.

```
https://api.existenz.ch/apiv1/smn/latest?locations=BER,ZUR&parameters=tt,rr
```

- 32 days of history available
- JSON with CORS headers
- Simplified parameter naming

---

## 9. Improvement Pitch: New MCP Server Tools

### Current State: Fragile and Limited

The MCP server currently has 3 tools built on HTML scraping:

| Tool | Status | Issue |
|---|---|---|
| `meteoswissWeatherReport` | **BROKEN** | Endpoint returns HTTP 404. The `/product/output/weather-report/` path is dead. |
| `search` | Working | Scrapes MeteoSwiss Solr search API |
| `fetch` | Working | Fetches and converts web pages to markdown |

The weather report tool — our primary value proposition — is non-functional. The MeteoSwiss OGD initiative provides structured, reliable data that should replace and vastly expand what we offer.

### Proposed New Tools (Prioritized)

#### P1: `getCurrentWeather` — Real-time measurements (HIGH VALUE, easy)

**What**: Current weather conditions from any of ~160 automatic stations across Switzerland.

**Source**: Consolidated CSV at `https://data.geo.admin.ch/ch.meteoschweiz.messwerte-aktuell/VQHA80.csv` — all stations, 20 parameters, updated every 10 minutes.

**Use cases**:
- "What's the temperature in Zurich right now?"
- "Is it raining in Lugano?"
- "What's the wind speed on the Jungfraujoch?"

**Implementation approach**:
1. Fetch `VQHA80.csv` (single HTTP request, ~25KB)
2. Parse semicolon-delimited CSV
3. Accept station query by name, abbreviation, or canton (fuzzy match against station metadata)
4. Return structured data: temperature, precipitation, wind, humidity, pressure, sunshine, radiation
5. Cache with 10-second TTL (matches data update frequency)

**Parameters**: `station` (name/code), `language` (for station name display)

**Why it matters**: Answers the most common weather question — "What's the weather like right now?" — with authoritative, real-time data from the national weather service.

#### P2: `getLocalForecast` — Point forecasts (HIGH VALUE, replaces broken tool)

**What**: 9-day weather forecasts for any Swiss location — the **same forecasts powering the MeteoSwiss app and website**.

**Source**: STAC collection `ch.meteoschweiz.ogd-local-forecasting` — ~6000 points, ~35 parameters, hourly updates.

**Use cases**:
- "What's the forecast for Bern this week?"
- "Will it rain in Basel tomorrow?"
- "What's the temperature outlook for postal code 8001?"

**Implementation approach**:
1. Query STAC API for latest forecast item
2. Download key parameter CSVs (temperature, precipitation, wind, cloud cover, weather pictogram)
3. Filter by `point_id` matching the requested location (postal code or station)
4. Aggregate into a human-readable forecast (daily summary + hourly detail)
5. Cache full CSVs with 1-hour TTL (matches update frequency)

**Challenge**: Each parameter CSV is large (all ~6000 points × all forecast hours). Smart caching and filtering is essential. Consider downloading only the most-used parameters (temperature, precipitation, wind, pictogram).

**Parameters**: `location` (postal code, station name, or station code), `days` (1-9), `language`

**Why it matters**: Replaces the broken `meteoswissWeatherReport` with something dramatically better — location-specific, multi-day, hourly-resolution forecasts covering every Swiss postal code.

#### P3: `listStations` — Station discovery (MEDIUM VALUE, enables P1/P2)

**What**: Browse and search the MeteoSwiss station network.

**Source**: `ogd-smn_meta_stations.csv` and `ogd-local-forecasting_meta_point.csv` metadata assets.

**Use cases**:
- "What weather stations are in canton Bern?"
- "What's the nearest station to Zurich?"
- "List all stations above 2000m"

**Implementation**: Cache metadata CSVs (change rarely), provide filtered/sorted results.

**Alternative**: Expose as an MCP **resource** rather than a tool, since the data is relatively static. AI clients could use it as context for station name resolution.

**Parameters**: `canton` (optional filter), `type` (station/postal/mountain), `search` (name query), `minElevation`/`maxElevation`

#### P4: `getClimateNormals` — Historical averages (MEDIUM VALUE, unique)

**What**: 30-year climate averages (1991-2020) for any station.

**Source**: STAC collection `ch.meteoschweiz.ogd-climate-normals`.

**Use cases**:
- "What's the average July temperature in Lugano?"
- "How much rain does Zurich normally get in November?"
- "Compare current weather to historical averages"

**Parameters**: `station`, `month` (optional), `parameter` (temperature/precipitation/sunshine)

**Why it matters**: Enables comparative analysis — "Is today warmer than normal?" — and travel/planning questions about Swiss weather patterns.

#### P5: `getPollenData` — Pollen monitoring (NICHE, unique value)

**What**: Current pollen concentrations from ~15 monitoring stations.

**Source**: STAC collection `ch.meteoschweiz.ogd-pollen`.

**Use cases**:
- "What's the pollen situation in Zurich?"
- "Is the birch pollen count high today?"

**Parameters**: `station`, `pollenType` (optional)

**Why it matters**: Unique data not easily accessible elsewhere, highly valuable for allergy sufferers.

### Architecture Changes Needed

| Component | Purpose |
|---|---|
| `src/data/stac-client.ts` | Lightweight STAC API client — browse collections, list items, resolve asset URLs |
| `src/support/csv-parser.ts` | MeteoSwiss CSV parsing — semicolon delimiter, Windows-1252/Latin1 encoding handling |
| `src/support/coordinate-utils.ts` | Swiss LV95 (EPSG:2056) ↔ WGS84 conversion (for legacy JSON endpoints) |
| Cache layer enhancement | TTL-based caching for metadata CSVs (stations, parameters) and data CSVs (measurements, forecasts) |

### What NOT to Build (Yet)

| Data Type | Why Not |
|---|---|
| NWP model grids (ICON-CH1/CH2) | GRIB2 format requires specialized libraries; Open-Meteo already provides a developer-friendly REST API for this data |
| Radar images | HDF5 parsing in Node.js is painful; better served as links/metadata until a clear use case emerges |
| Full climate scenarios | NetCDF format, complex multi-dimensional data — too much for MCP tool responses |

### Migration Path

1. **Phase 1**: Add `getCurrentWeather` and `listStations` (quick wins, high value)
2. **Phase 2**: Add `getLocalForecast` (replaces broken weather report, needs caching infrastructure)
3. **Phase 3**: Add `getClimateNormals` and `getPollenData` (lower priority, incremental value)
4. **Phase 4**: Deprecate `meteoswissWeatherReport` (once `getLocalForecast` is stable)
5. **Ongoing**: Keep `search` and `fetch` tools for MeteoSwiss editorial content access

### Impact Summary

| Metric | Current | Proposed |
|---|---|---|
| Working tools | 2 of 3 | 6+ tools |
| Data freshness | N/A (broken) | 10-minute real-time, hourly forecasts |
| Location coverage | 3 regions | ~6000 specific locations |
| Forecast horizon | N/A (broken) | 9 days, hourly resolution |
| Data reliability | HTML scraping (fragile) | Structured CSV/STAC API (official OGD) |
| Parameters available | Weather text only | 35+ measured/forecast parameters |
