---
"meteoswiss-mcp": patch
---

Fix intermittent failures in the forecast and current-weather tools. A request could fail with `ENOENT: no such file or directory, rename …` even though the weather data had been fetched successfully — a failing *cache* write was taking down the whole request.

Caching is now treated as the optimisation it is: if a cache write fails the data is still returned, and the failure is logged where it can actually be seen. The conditions that produced the error in the first place are gone.

New optional environment variable: `OGD_CACHE_DIR_REAP_MIN_AGE_MS` (default `60000`) — how long an empty cache directory must have been idle before it is reclaimed.
