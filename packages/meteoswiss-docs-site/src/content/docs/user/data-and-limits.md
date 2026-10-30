---
title: Data sources and limits
description: Where the data comes from, how fresh it is, what it does not cover, and the licence.
---

## Data sources

| Data | Source | Cache on the server |
|------|--------|---------------------|
| Forecasts | MeteoSwiss OGD local forecast, via the [STAC API](https://data.geo.admin.ch/api/stac/v1/collections) | 1 hour |
| Current weather | MeteoSwiss OGD automatic measurements (updated every 10 minutes) | 60 seconds |
| Station metadata | MeteoSwiss OGD station lists | 24 hours |
| Pollen | MeteoSwiss OGD pollen network | 60 seconds |
| Climate series | MeteoSwiss OGD NBCN | 7 days |
| Website search | meteoschweiz.admin.ch (and its French, Italian and English counterparts) | Short in-memory HTTP cache; an upstream failure is passed on |
| Website pages (`fetch`) | the same website | In memory, stale-while-revalidate: a short outage serves slightly stale pages |
| Address and place geocoding | swisstopo [SearchServer](https://api3.geo.admin.ch/) | In memory |

The server re-serves MeteoSwiss data in a form that suits language models. The five weather tools (forecast, current weather, stations, pollen, climate) carry a `source` attribution field in every response; `search` and `fetch` return website content and do not.
The authoritative data is always the one MeteoSwiss publishes at [opendatadocs.meteoswiss.ch](https://opendatadocs.meteoswiss.ch/).

## Limits

- **Switzerland only.** Coordinates outside lat 45.5-48 / lon 5.9-10.6 are rejected.
- **Forecast horizon:** 9 days.
- **Rate limit (default configuration):** 100 requests per minute per client. A JSON-RPC batch counts every message in it.
- **Sessions (default configuration):** at most 10 concurrent sessions per client; idle sessions expire after 5 minutes.
- **Pollen:** ragweed is not measured in the OGD network, so it is not reported.
- **`search` pagination:** 10 results per page, fixed by the upstream API.
- **Not an official MeteoSwiss service.** The hosted instance is a community-run showcase without an availability guarantee. Do not use it
  for safety-critical decisions. Official warnings are at [meteoschweiz.admin.ch](https://www.meteoschweiz.admin.ch/).

## Licence and attribution

The software in this repository is released under [CC0-1.0](https://github.com/eins78/meteoswiss-llm-tools/blob/main/LICENSE) (public domain).
MeteoSwiss Open Government Data is published under the terms stated at
[opendatadocs.meteoswiss.ch](https://opendatadocs.meteoswiss.ch/); check them before redistributing data, and credit MeteoSwiss as the source.
