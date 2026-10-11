---
"meteoswiss-mcp": patch
---

Forecast requests no longer re-parse the cached forecast CSVs. Each file is parsed once per cached version into a compact in-memory index, and concurrent requests share one download and one parse. A warm forecast call drops from about 11 s to about 15 ms, and eight concurrent calls from about 91 s to about 15 s. Retained memory is bounded by `OGD_PARSE_CACHE_MAX_BYTES` (default 128 MiB; `0` disables retention).
