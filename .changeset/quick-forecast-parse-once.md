---
"meteoswiss-mcp": patch
---

Forecast requests are much faster. The cached forecast CSVs are no longer re-parsed on every request: each file is parsed once per cached version into a compact in-memory index, and concurrent requests share one download and one parse. The parse itself is also more than 25x faster (a schema-specific byte scanner that falls back to the generic parser on any unexpected input) and runs on up to two worker threads, so it no longer blocks the event loop. A cold forecast call drops from about 12 s to under 1 s, a warm one to a few milliseconds, and eight concurrent calls from about 90 s to about 1 s. Retained memory is bounded by `OGD_PARSE_CACHE_MAX_BYTES` (default 128 MiB, `0` disables retention); `OGD_PARSE_WORKERS` sets the worker count (default 2, `0` parses on the main thread).
