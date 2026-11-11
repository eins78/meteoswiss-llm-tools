<!-- Canonical source: packages/meteoswiss-mcp/src/support/weather-icons.ts and src/schemas/ogd-shared.ts -->
<!-- If MeteoSwiss updates parameters or icons, update both this file and the MCP server source. -->

# MeteoSwiss OGD — Parameter Reference

Full reference tables for MeteoSwiss Open Government Data parameters, weather icons, and STAC collections.

## Table of Contents

- [Current Weather Parameters (VQHA80.csv)](#current-weather-parameters)
- [Forecast Parameters — Daily (Stations)](#forecast-parameters--daily)
- [Forecast Parameters — Hourly (Postal Codes, Mountains)](#forecast-parameters--hourly)
- [Weather Icon Codes — Day](#weather-icon-codes--day)
- [Weather Icon Codes — Night](#weather-icon-codes--night)
- [Pollen Types](#pollen-types)
- [Pollen Stations](#pollen-stations)
- [Climate Parameters (NBCN)](#climate-parameters-nbcn)
- [STAC Collections](#stac-collections)

## Current Weather Parameters

Parameters in the `VQHA80.csv` real-time measurements file. All values from the most recent 10-minute observation.

| Parameter | Description | Unit |
|-----------|------------|------|
| `tre200s0` | Air temperature 2m above ground | °C |
| `ure200s0` | Relative humidity 2m above ground | % |
| `tde200s0` | Dew point temperature 2m | °C |
| `rre150z0` | Precipitation, 10-minute total | mm |
| `fu3010z0` | Mean wind speed 10min | km/h |
| `fu3010z1` | Wind gust peak (max) | km/h |
| `dkl010z0` | Wind direction | ° (0-360) |
| `sre000z0` | Sunshine duration, 10-minute total | min |
| `gre000z0` | Global radiation | W/m² |
| `prestas0` | Atmospheric pressure at station level | hPa |
| `pp0qffs0` | Pressure reduced to sea level (QFF) | hPa |
| `htoauts0` | Total snow depth | cm |

## Forecast Parameters — Daily

Available for stations (`point_type_id=1`). One value per day.

| Parameter | Description | Unit |
|-----------|------------|------|
| `tre200dx` | Daily maximum temperature 2m | °C |
| `tre200dn` | Daily minimum temperature 2m | °C |
| `rka150d0` | Daily precipitation total | mm |
| `jp2000d0` | Weather pictogram code (daytime, see icon tables) | — |

## Forecast Parameters — Hourly

Available for all point types (stations, postal codes, mountains). One value per hour.

| Parameter | Description | Unit |
|-----------|------------|------|
| `tre200h0` | Hourly temperature 2m | °C |
| `rre150h0` | Hourly precipitation | mm |
| `sre000h0` | Hourly sunshine duration | min |
| `fu3010h0` | Hourly mean wind speed | km/h |
| `fu3010h1` | Hourly wind gust peak (max) | km/h |
| `jww003i0` | Weather pictogram code, one value per hour, for the 3 hours ending at the timestamp | — |
| `nprolohs` | Low cloud cover | fraction 0-1 |
| `npromths` | Medium cloud cover | fraction 0-1 |
| `nprohihs` | High cloud cover | fraction 0-1 |

## Weather Icon Codes — Day

Codes used in `jp2000d0` (daily) and `jww003i0` (hourly) parameters.

SVG icon URL: `https://www.meteoschweiz.admin.ch/static/resources/weather-symbols/{CODE}.svg`

| Code | Description |
|------|------------|
| 1 | Sunny |
| 2 | Mostly sunny, some clouds |
| 3 | Partly sunny, thick passing clouds |
| 4 | Overcast |
| 5 | Very cloudy |
| 6 | Sunny intervals, isolated showers |
| 7 | Sunny intervals, isolated sleet |
| 8 | Sunny intervals, snow showers |
| 9 | Overcast, some rain showers |
| 10 | Overcast, some sleet |
| 11 | Overcast, some snow showers |
| 12 | Sunny intervals, chance of thunderstorms |
| 13 | Sunny intervals, possible thunderstorms |
| 14 | Very cloudy, light rain |
| 15 | Very cloudy, light sleet |
| 16 | Very cloudy, light snow showers |
| 17 | Very cloudy, intermittent rain |
| 18 | Very cloudy, intermittent sleet |
| 19 | Very cloudy, intermittent snow |
| 20 | Very overcast with rain |
| 21 | Very overcast with frequent sleet |
| 22 | Very overcast with heavy snow |
| 23 | Very overcast, slight chance of storms |
| 24 | Very overcast with storms |
| 25 | Very cloudy, very stormy |
| 26 | High clouds |
| 27 | Stratus |
| 28 | Fog |
| 29 | Sunny intervals, scattered showers |
| 30 | Sunny intervals, scattered snow showers |
| 31 | Sunny intervals, scattered sleet |
| 32 | Sunny intervals, some showers |
| 33 | Short sunny intervals, frequent rain |
| 34 | Short sunny intervals, frequent snowfall |
| 35 | Overcast and dry |

## Weather Icon Codes — Night

Night codes are day code + 100. Used in `jww003i0` for nighttime hours.

| Code | Description |
|------|------------|
| 101 | Clear |
| 102 | Slightly overcast |
| 103 | Heavy cloud formations |
| 104 | Overcast |
| 105 | Very cloudy |
| 106 | Overcast, scattered showers |
| 107 | Overcast, scattered rain and snow showers |
| 108 | Overcast, snow showers |
| 109 | Overcast, some showers |
| 110 | Overcast, some rain and snow showers |
| 111 | Overcast, some snow showers |
| 112 | Slightly stormy |
| 113 | Storms |
| 114 | Very cloudy, light rain |
| 115 | Very cloudy, light rain and snow showers |
| 116 | Very cloudy, light snowfall |
| 117 | Very cloudy, intermittent rain |
| 118 | Very cloudy, intermittent mixed rain and snowfall |
| 119 | Very cloudy, intermittent snowfall |
| 120 | Very cloudy, constant rain |
| 121 | Very cloudy, frequent rain and snowfall |
| 122 | Very cloudy, heavy snowfall |
| 123 | Very cloudy, slightly stormy |
| 124 | Very cloudy, stormy |
| 125 | Very cloudy, storms |
| 126 | High cloud |
| 127 | Stratus |
| 128 | Fog |
| 129 | Slightly overcast, scattered showers |
| 130 | Slightly overcast, scattered snowfall |
| 131 | Slightly overcast, rain and snow showers |
| 132 | Slightly overcast, some showers |
| 133 | Overcast, frequent rain showers |
| 134 | Overcast, frequent snow showers |
| 135 | Overcast and dry |
| 136 | Slightly overcast, slightly stormy |
| 137 | Slightly overcast, stormy snow showers |
| 138 | Overcast, thundery showers |
| 139 | Overcast, thundery snow showers |
| 140 | Very cloudy, slightly stormy |
| 141 | Overcast, slightly stormy |
| 142 | Very cloudy, thundery snow showers |

## Pollen Types

Parameter codes in daily pollen CSVs. Each species has two daily resolutions:
- `d0`: 6 UTC to 6 UTC following day (meteorological day)
- `d1`: 0 UTC to 0 UTC (standard calendar day) — **recommended**

| Prefix | Code (d1) | Pollen type | Latin name |
|--------|-----------|-------------|------------|
| `kaalnu` | `kaalnud1` | Alder | Alnus |
| `kabetu` | `kabetud1` | Birch | Betula |
| `kacory` | `kacoryd1` | Hazel | Corylus |
| `kafagu` | `kafagud1` | Beech | Fagus |
| `kafrax` | `kafraxd1` | Ash | Fraxinus |
| `kaquer` | `kaquerd1` | Oak | Quercus |
| `khpoac` | `khpoacd1` | Grasses | Poaceae |

Values are in particles/m³. Not all pollen types are measured at every station.

## Pollen Stations

| Abbreviation | Station name |
|-------------|-------------|
| PBE | Bern |
| PBS | Basel |
| PBU | Buchs (SG) |
| PCF | La Chaux-de-Fonds |
| PDS | Davos |
| PGE | Geneve |
| PJU | Jungfraujoch |
| PLO | Locarno |
| PLS | Lausanne |
| PLU | Lugano |
| PLZ | Luzern |
| PMU | Munsterlingen |
| PNE | Neuchatel |
| PPY | Payerne |
| PSN | Sion |
| PZH | Zurich |

URL pattern (lowercase abbreviation): `https://data.geo.admin.ch/ch.meteoschweiz.ogd-pollen/{abbr}/ogd-pollen_{abbr}_d_recent.csv`

## Climate Parameters (NBCN)

Column names encode the resolution: `…y0`/`…yx`/`…yn` yearly, `…m0` monthly, `…d0` daily.

| Yearly | Monthly | Description | Unit |
|--------|---------|-------------|------|
| `ths200y0` | `ths200m0` | Mean temperature | °C |
| `ths2dyyx` | `ths2dymx` | Mean daily maximum temperature | °C |
| `ths2dyyn` | `ths2dymn` | Mean daily minimum temperature | °C |
| `rhs150y0` | `rhs150m0` | Precipitation total | mm |
| `shs000y0` | `shs000m0` | Sunshine duration | min |
| `ghs000y0` | `ghs000m0` | Global radiation | W/m² |
| `fhs010y0` | `fhs010m0` | Wind speed | m/s |
| `phsstay0` | `phsstam0` | Air pressure at station | hPa |
| `ths00ny0` | `ths00nm0` | Frost days (min < 0 °C) | count |
| `ths25xy0` | `ths25xm0` | Summer days (max ≥ 25 °C) | count |
| `ths30xy0` | `ths30xm0` | Heat days (max ≥ 30 °C) | count |
| `ths00xy0` | `ths00xm0` | Ice days (max < 0 °C) | count |

Daily files carry `ths200d0` (mean), `ths200dx` (max), `ths200dn` (min) temperature only.

## STAC Collections

All collections available under `https://data.geo.admin.ch/api/stac/v1/collections/{ID}`.

| Collection ID | Description |
|---------------|-------------|
| `ch.meteoschweiz.ogd-smn` | SwissMetNet automatic stations — real-time measurements |
| `ch.meteoschweiz.ogd-local-forecasting` | Local forecasts for ~6000 Swiss locations |
| `ch.meteoschweiz.ogd-pollen` | Pollen concentration monitoring |
| `ch.meteoschweiz.ogd-smn-precip` | Precipitation measurements |
| `ch.meteoschweiz.ogd-smn-tower` | Tower measurements |
| `ch.meteoschweiz.ogd-nbcn` | Swiss NBCN climate stations |
| `ch.meteoschweiz.ogd-nbcn-precip` | NBCN precipitation-only stations |
| `ch.meteoschweiz.ogd-radiosounding` | Radiosounding data |
