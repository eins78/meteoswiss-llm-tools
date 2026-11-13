---
"meteoswiss-mcp": minor
---

New tool `meteoswissWeatherSituation`: the weather over Switzerland at one hour. It counts MeteoSwiss's hourly weather symbol at all ~5800 forecast points in ten categories (sunny, clear night, partly sunny, cloudy, high cloud, fog or stratus, rain, sleet, snow, thunder) per MeteoSwiss forecast region and altitude band, for area questions such as "where is it sunny?" or "how high does the fog reach?". It counts one hour or a window of up to 12 hours (`until`), and can be narrowed to one region, a box (`bbox`), an air distance around a place (`near`, up to 150 km) and an altitude range. An overcast or partly sunny hour under a low cloud deck counts as fog or stratus, because the symbol alone often misses it. The tool reads the same files as `meteoswissLocalForecast` with `detail: "sky"`, so it adds no forecast download.

The seven forecast regions are not Open Data: the server downloads them from the MeteoSwiss website on first use and keeps them for 30 days in a part of the disk cache that the size limit never evicts (Source: MeteoSwiss). Two new optional settings: `FORECAST_REGIONS_BASE_URL` (where the files come from) and `FORECAST_REGIONS_CACHE_TTL` (how long they are kept). Points outside the seven regions are counted in the nearest one.
