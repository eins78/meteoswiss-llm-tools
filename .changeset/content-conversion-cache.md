---
"meteoswiss-mcp": minor
---

Cache the converted page, not just the fetched HTML.

`search` and `fetch` cached the HTML but re-ran the HTML→markdown conversion on every request, reproducing a byte-identical result each time — the compute the cache existed to save was never saved. Two layers now sit on that path:

- a **memo keyed on a hash of the input HTML**, so it can never serve markdown staler than the source it was derived from and needs no TTL of its own;
- **`@epic-web/cachified`** above it for **single-flight** (six sessions asking for the same page during a cold fetch now do one fetch and one conversion, not six) and **stale-while-revalidate** (an expired page is handed to the caller before the refresh is dispatched, so nobody waits on a conversion).

The generous stale window also means an unreachable MeteoSwiss degrades to slightly-old content instead of an error — for a briefing that runs once a morning, an hour-old article beats a failure. A background refresh that fails is now reported on stderr; previously it was invisible, so an upstream outage looked like business as usual right up until requests started failing.

Same page, three consecutive requests: **271/62/59 ms → 232/0/0 ms**.

The 404 message for a page that cannot be fetched now shows the normalised URL rather than the raw `id`, so a client that passed a bare path sees the full URL that was actually requested.

New optional environment variables: `CONTENT_CACHE_TTL_MS`, `CONTENT_CACHE_SWR_MS`, `CONTENT_CACHE_MAX_ENTRIES`, `CONTENT_MEMO_MAX_ENTRIES`. An empty value is treated as unset rather than as zero, so `CONTENT_CACHE_TTL_MS=` in a compose file does not silently disable the cache.
