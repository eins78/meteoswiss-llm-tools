---
"meteoswiss-mcp": patch
---

The `fetch` tool now drops the query string, fragment and userinfo from a page URL before it fetches and caches the page. Before, every `?…` or `#…` variant of one page was a new cache entry and a new upstream fetch, so the cache could be bypassed without limit.
