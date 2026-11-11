---
"meteoswiss-mcp": minor
---

`meteoswissLocalForecast` has a new input `detail`. With `detail: "sky"`, each `hourly[]` entry also has `weather_code` and `weather` (for example "fog" or "stratus") and `cloud_low_pct`, `cloud_mid_pct`, `cloud_high_pct` in percent. Before, the symbol came once per day, so a foggy morning read as "very cloudy". Weather stations get the hourly symbol too. The default (`"basic"`) answer is the same as before: a forecast eval showed that the larger answer costs small models about 12 points on 5-day questions. A `"sky"` call reads three more files, so the default `OGD_PARSE_CACHE_MAX_BYTES` is now 256 MiB (was 128 MiB) and the default `OGD_CACHE_MAX_BYTES` is now 512 MiB (was 256 MiB). If you set them yourself, make sure they hold one forecast run: about 140 MB parsed and 290 MB on disk.
