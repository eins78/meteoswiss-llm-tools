---
"meteoswiss-mcp": minor
---

`meteoswissLocalForecast` now returns the weather symbol and the cloud cover for every hour. Each `hourly[]` entry has `weather_code` and `weather` (for example "fog" or "stratus") and `cloud_low_pct`, `cloud_mid_pct`, `cloud_high_pct` in percent. Before, the symbol came once per day, so a foggy morning read as "very cloudy". Weather stations get the hourly symbol too. A forecast call now reads three more files, so the default `OGD_PARSE_CACHE_MAX_BYTES` is now 256 MiB (was 128 MiB) and the default `OGD_CACHE_MAX_BYTES` is now 512 MiB (was 256 MiB). If you set them yourself, make sure they hold one forecast run: about 140 MB parsed and 290 MB on disk. Answers get larger: the hourly part of a 5-day forecast grows by about 75 % (about 27 KB to 47 KB).
