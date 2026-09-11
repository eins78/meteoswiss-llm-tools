---
"meteoswiss-mcp": minor
---

`search` and `fetch` now cache the converted page, not just the fetched HTML. Repeat requests for the same page skip the conversion entirely, several requests for one page while it is being fetched share a single fetch, and a page that has just expired is served immediately while it refreshes in the background — so a MeteoSwiss outage degrades to slightly-stale content instead of an error. Same page, three consecutive requests: **271 / 62 / 59 ms → 232 / 0 / 0 ms**.

When a page cannot be fetched, the 404 message now shows the full URL that was requested rather than the raw `id`, so a client that passed a bare path can see what it actually asked for.

New optional environment variables: `CONTENT_CACHE_TTL_MS`, `CONTENT_CACHE_SWR_MS`, `CONTENT_CACHE_MAX_ENTRIES`, `CONTENT_MEMO_MAX_ENTRIES`. An empty value is treated as unset rather than as zero, so `CONTENT_CACHE_TTL_MS=` does not silently disable the cache.
