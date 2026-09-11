# meteoswiss-mcp

## 3.1.0-rc.0 - 2026-09-11

### Minor Changes

- 28a5ad8: `search` and `fetch` now cache the converted page, not just the fetched HTML. Repeat requests for the same page skip the conversion entirely, several requests for one page while it is being fetched share a single fetch, and a page that has just expired is served immediately while it refreshes in the background — so a MeteoSwiss outage degrades to slightly-stale content instead of an error. Same page, three consecutive requests: **271 / 62 / 59 ms → 232 / 0 / 0 ms**.

  When a page cannot be fetched, the 404 message now shows the full URL that was requested rather than the raw `id`, so a client that passed a bare path can see what it actually asked for.

  New optional environment variables: `CONTENT_CACHE_TTL_MS`, `CONTENT_CACHE_SWR_MS`, `CONTENT_CACHE_MAX_ENTRIES`, `CONTENT_MEMO_MAX_ENTRIES`. An empty value is treated as unset rather than as zero, so `CONTENT_CACHE_TTL_MS=` does not silently disable the cache.

### Patch Changes

- e8ee6f7: Security: the published Docker image is now built with every dependency override applied, and those overrides have been refreshed to close the advisories outstanding against the bundled dependencies.

  Dependencies only — no API, tool or behaviour change.

- 83dd2f1: Fix intermittent failures in the forecast and current-weather tools. A request could fail with `ENOENT: no such file or directory, rename …` even though the weather data had been fetched successfully — a failing _cache_ write was taking down the whole request.

  Caching is now treated as the optimisation it is: if a cache write fails the data is still returned, and the failure is logged where it can actually be seen. The conditions that produced the error in the first place are gone.

  New optional environment variable: `OGD_CACHE_DIR_REAP_MIN_AGE_MS` (default `60000`) — how long an empty cache directory must have been idle before it is reclaimed.

## 3.0.0 - 2026-07-18

### Major Changes

- ee27745: **Breaking:** `meteoswissLocalForecast`'s daily forecast shape has changed. The nested `temperature: { min, max, unit }` and `precipitation: { total, unit, hourly }` objects are removed, replaced by flat, unit-suffixed daily fields plus a unified hourly breakdown across all series (previously precipitation-only, and only for postal codes/mountain points):
  - `temperature.min`/`temperature.max` → `temperature_min_c`/`temperature_max_c`
  - `precipitation.total` → `precipitation_total_mm`
  - `precipitation.hourly` → merged into the new `hourly` array below (alongside temperature/sunshine/wind, not precipitation-only)
  - New: `sunshine_total_minutes`, `wind_avg_kmh`, `wind_gust_max_kmh`

  Each day now includes `hourly: Array<{ time, temperature_c, precip_mm, sunshine_minutes, wind_kmh, wind_gust_kmh }> | null` — one unified per-hour object per series (`time` is local Europe/Zurich, DST-aware; each field is independently `null` on a per-series data gap). Weather stations now receive this hourly breakdown too (previously always `null`).

  For postal codes/mountain points, every summary field is derived from the same hourly series shown alongside it. For weather stations, `temperature_min_c`/`temperature_max_c`/`precipitation_total_mm` remain MeteoSwiss's own official daily aggregates (a separately-curated product that may not exactly match summing/averaging the attached hourly series — expected, not a data error); `sunshine_total_minutes`/`wind_avg_kmh`/`wind_gust_max_kmh` have no official daily product and are always derived from the hourly series, even for stations.

  Consumers parsing the old nested `temperature`/`precipitation` objects must update to the flat field names.

- 833345e: Fix nine findings from a 3-model QA sweep of v2.3.2 (issue #110):
  - **BREAKING:** `fetch` no longer returns the duplicate `content` field (`text` is now the sole, canonical body field — halves payload size for every fetch call).
  - **BREAKING:** `search` no longer accepts a `pageSize` parameter. The upstream Solr API silently ignores `rows` and always returns 10 results per page; the parameter gave a false impression of control. Response metadata now reports the actual delivered count instead of echoing back the (unhonored) request, and pagination offsets are fixed so `page` navigation is consistent.
  - `meteoswissCurrentWeather` coordinate lookups now skip a geometrically-nearer station that lacks temperature data (e.g. Uetliberg) in favor of the nearest station that reports it (e.g. SMA/Fluntern for central Zürich).
  - `meteoswissCurrentWeather("Zurich")` now resolves to SMA (Fluntern), matching how `meteoswissClimateData` already resolves "Zurich" — previously it resolved to KLO (Kloten) due to a same-city name-scoring tie-break.
  - `meteoswissPollenData` now always reports all 7 species the OGD network measures, with an explicit `status: "no-current-data"` marker for any species absent from the latest reading (e.g. out of season) instead of silently omitting it. Ambrosia (ragweed) is documented in the tool description as a forecast-only category not present in this measurement feed.
  - `meteoswissLocalForecast` weather icon codes 36–42 (previously "unknown") are now mapped to descriptions and SVG URLs.
  - `meteoswissLocalForecast`'s tool description no longer references the invalid station abbreviation `"ZUE"` (replaced with the valid `"SMA"`).
  - `meteoswissClimateData` now includes a `note` explaining the available date range and suggesting `resolution="monthly"` when a daily query's date filter returns no data, instead of a bare empty array.
  - `fetch` markdown/text output no longer leaks decorative icon labels (e.g. "chevron-small-right") from MeteoSwiss's web components.

### Minor Changes

- 19535c2: All 7 tools now declare Zod output schemas and return MCP `structuredContent` alongside the JSON text content. Tool registrations migrated from the deprecated `server.tool()` to `registerTool()`, so `tools/list` now advertises each tool's full output shape (with per-field descriptions) in addition to its input schema, and the SDK validates every response against the declared schema at runtime. Response shapes are unchanged — the previously hand-written TypeScript response types are now derived from the schemas via `z.infer`.
- 838a31e: Round numeric measurement values in tool output by unit (e.g. temperature and wind to 1 decimal place) for cleaner, more consistent display. Coordinates, elevations, IDs, and timestamps are unaffected.

### Patch Changes

- d88c8dc: Functional correctness fixes from the 2026-07-11 review, all addressing cases where a tool returned confidently wrong or empty data instead of an error:
  - **Session-capacity rejection returns 503, and `stop()` closes the listener (FUN-13, FUN-12):** hitting `MAX_SESSIONS` now surfaces as a clean 503 checked before transport creation (it previously threw deep inside request handling and returned a generic 500 with a possible double-close); and `stop()` now actually closes the HTTP listener instead of leaking it.
  - **Root `/` endpoint and doc drift fixed (FUN-14, FUN-19):** the capability list now includes `meteoswissClimateData` (via a single shared const), the climate `network` field description matches its real values, unused `validation-errors.ts` is removed, and the STAC client fails fast in fixture mode instead of falling through to the live API.
  - **Reverse-geocode failures are no longer cached (FUN-10):** a single transient error while resolving a station's municipality was stored as a permanent `null`, suppressing that field until restart. Only resolved outcomes (a hit or a genuine no-result) are cached now; transient errors are retried on the next request.
  - **Input schemas are hardened (FUN-16, FUN-17, FUN-18, FUN-15):** free-text inputs (`query`, `location`, `station`, `search`) are capped at 200 chars and `fetch.id` at 2048; `search.page` is capped at 1000; `parseNumeric` now rejects non-finite values (`Infinity`, `1e309`); and the `station`/`coordinates` precedence ("coordinates wins") is documented on both tools that accept them.
  - **Search fixture resolver no longer masks missing fixtures (TEST-2, TEST-3):** the test-mode search resolver fell back to "read the first file in the language directory and substring-filter it," which could return unrelated results for a missing/renamed fixture. Query slugs are now diacritic-insensitive (so `météo` resolves to `meteo-results.json` by exact match) and an absent fixture returns empty (a genuine no-match) instead of arbitrary content. The multi-word search tests now assert real result content, not just array shape.
  - **The Solr search response is Zod-validated (FUN-9):** it was cast (`as SolrResponse`) with all-optional fields and `|| 0` / `|| []` fallbacks, so a valid-JSON error payload or shape change silently became "0 results". It's now validated (requiring `response.docs` to be an array) and throws on mismatch.
  - **Non-retryable 4xx responses are no longer retried (FUN-8):** 404/400 etc. were retried 3× (≈3.6 s wasted latency per missing resource); the retry loop now skips 4xx except 408/429.
  - **Station forecasts no longer drop all days when the `tre200dx` asset is missing (FUN-6):** the station day list derived solely from the `tre200dx` (daily max-temp) timestamps, so a run missing just that asset returned `forecast: []` even with all hourly data fetched. It now unions every daily-aggregate's dates with the hourly days, matching the non-station path.
  - **Climate date filters are validated as YYYY-MM-DD (FUN-5):** `start_date`/`end_date` were plain strings compared lexicographically against `YYYY-MM-DD` row dates, so `2020-1-1`, `01.01.2020`, or `2020/01/01` were accepted and silently mis-filtered (e.g. `"2020-01-15" >= "2020-1-1"` is false). Both fields now require `^\d{4}-\d{2}-\d{2}$`.
  - **Pollen tool fails loudly on a total outage (FUN-4):** when every per-station fetch failed, `meteoswissPollenData` returned `{stations: []}` as a success, which the model reported as "no pollen data available." It now throws (surfacing the underlying error) when no station yields any data.
  - **Measurement timestamps are now genuine ISO 8601 (FUN-3):** `meteoswissCurrentWeather` and `meteoswissPollenData` returned raw CSV cells (`202603281940` or `08.04.2026 14:30`) despite advertising ISO 8601, so an LLM could misparse the measurement time. Both fixed-width formats are now normalized to `YYYY-MM-DDTHH:mm:ssZ` (UTC).
  - **Forecast day filtering uses the Europe/Zurich date (FUN-2):** the "drop past days" filter compared Zurich-bucketed forecast dates against a UTC "today", so every night between local midnight and 01:00 (winter) / 02:00 (summer) it dropped a genuinely-future day and surfaced yesterday. It now computes "today" in Europe/Zurich, matching how the days are bucketed.
  - **Climate station resolution no longer accepts international city names (FUN-1):** the NBCN resolver behind `meteoswissClimateData` gained the same blocklist and geocoded-name-match guards its SMN/forecast siblings already had, so `{station: "Paris"}` now errors instead of silently returning Payerne's climate data. The shared name-match guard was de-duplicated into `name-matcher.ts` so it can't drift between the three resolvers again.

- fc3750a: Security hardening from the 2026-07-11 security review, focused on the unauthenticated DoS chain and defense-in-depth:
  - **Rate limiting now works behind the proxy (SEC-2):** set Express `trust proxy` (configurable via `TRUST_PROXY`, default 1 hop) so `req.ip` reflects the real client via `X-Forwarded-For` instead of collapsing every client into a single shared rate-limit bucket. A fixed hop count is used (not `trust proxy: true`) so clients cannot spoof their IP.
  - **The `fetch` tool no longer blocks the event loop unboundedly (SEC-1):** removed the dead `Promise.race` "10 s timeout" (which never interrupted the synchronous JSDOM parse), added a hard 5 MB pre-parse size cap, and parse the HTML once (the text format previously instantiated a second JSDOM).
  - **Outbound response bodies are now bounded in bytes and time (SEC-3):** both the HTML and CSV fetch paths stream into a capped buffer (configurable via `MAX_RESPONSE_BYTES`, default 50 MiB) and reject oversized bodies up front via `Content-Length`; the content-fetch path also regained its 30 s default timeout (previously it silently passed no timeout, leaving requests unbounded in time).
  - **The `fetch` allowlist is now re-checked on redirects and pins scheme/port (SEC-4, SEC-8):** the content path follows redirects manually and re-runs the domain allowlist on every `Location` hop (an upstream open redirect can no longer escape it), and requires `https:` on the default port. Adds direct unit coverage of the allowlist rejection path, which fixture-mode integration tests never exercised (TEST-1).
  - **CORS no longer allows credentials (SEC-7):** set `credentials: false` so the server never combines a reflected `Origin` with `Access-Control-Allow-Credentials` — harmless today (no auth/cookies) but a latent credential-theft footgun the day one is added.
  - **User input is sanitized in log lines (SEC-10):** free-text parameters are truncated and JSON-escaped before interpolation into stderr logs, so a newline in the input can no longer forge additional log lines.
  - **The in-memory HTTP and geocode caches are now LRU-bounded (SEC-6):** both gained an entry cap with least-recently-used eviction (`HTTP_CACHE_MAX_ENTRIES` default 1000, `GEOCODE_CACHE_MAX_ENTRIES` default 2000), so distinct URLs / query strings can no longer grow them without bound.
  - **The disk CSV cache is now bounded and traversal-safe (SEC-5):** cache keys are resolved and asserted to stay under the cache directory (a future user-derived key can no longer traverse out), orphaned `.tmp` files are swept, and the cache is pruned LRU-by-mtime once it exceeds a total-bytes ceiling (`OGD_CACHE_MAX_BYTES`, default 256 MiB).

- 41330a2: Document the `meteoswissClimateData` tool on the service homepage, correct the station count in tool descriptions and docs (~300 measurement stations: ~160 full weather + ~140 precipitation-only), and link the new skill-vs-MCP case study from the homepage.

## 2.3.2 - 2026-04-20

### Patch Changes

- 7eb1e59: Restore ChatGPT Deep Research / Connectors compatibility for the `fetch` tool. The v2.3.1 release renamed the `fetch` argument from `id` to `url`, which broke the canonical contract that ChatGPT (and the OpenAI Responses API Deep Research models) expects. This release renames it back to `id`, adds the canonical `text` and top-level `url` fields to the `fetch` response, keeps `content` as a back-compat alias of `text`, and adds an integration test suite + tool-manifest snapshot to prevent the regression from recurring. See `docs/plans/2026-04-19-chatgpt-fetch-compat.md` for the full investigation and references.

## 2.3.1 - 2026-04-18

### Patch Changes

- fa7ab7b: Expose `meteoswiss_mcp_build_info{version, node_version}` Prometheus gauge for version observability. Enables the Grafana dashboard to show the deployed version of each environment (TEST and PROD) at a glance without querying MCP endpoints.

## 2.3.0 - 2026-04-18

### Minor Changes

- 615eb7a: Add Tier 1 OGD features: SMN-precip stations, climate data tool, visual observations.
  - **SMN-precip**: Merge ~248 precipitation-only stations into meteoswissCurrentWeather (per-station CSV fallback)
  - **meteoswissClimateData**: New tool for NBCN homogeneous climate series (29 climate + 46 precip stations, daily/monthly/yearly)
  - **Visual observations**: Enrich currentWeather with cloud cover, fog, rain, snowfall, hail, snow coverage for 8 OBS stations
  - **CSV parser**: Replace custom parser with csv-parse/sync library

### Patch Changes

- de9c937: Fix location resolver robustness across all MCP tools. Non-Swiss inputs, invalid station codes, and gibberish now return helpful errors instead of silently resolving to wrong Swiss locations.
  - **International city blocklist**: Reject well-known non-Swiss city names (Paris, London, Tokyo, etc.) before geocoding, preventing false-positive Swiss station matches (e.g. Paris → Payerne)
  - **Post-geocoding name guard**: Reject gibberish inputs (NOTASTATION, ABCDE) that the swisstopo API resolves to unrelated Swiss coordinates
  - **Non-Swiss error messages**: Return descriptive errors with examples and a pointer to `meteoswissStations` for invalid inputs, matching the `meteoswissPollenData` reference pattern
  - **Postal-code prefix fallback**: Round-number parent postal codes (1200 → Geneva, 3000 → Bern) now resolve correctly
  - **Geocoder origin restriction**: swisstopo queries restricted to `zipcode`, `gg25`, `district`, `kantone` origins to prevent non-Swiss city names from matching Swiss street labels
  - **Scored name matching**: Prevents "Bern" from resolving to Bernina; Swiss bounding box and distance threshold reject out-of-country inputs
  - **OBS visual observations**: Boolean fields (`has_rain`, `has_snowfall`, etc.) always return `true`/`false` instead of being stripped when MeteoSwiss reports "-" (not observed)
  - **`fetch` tool**: Revert unintentional breaking parameter rename — `id` reverted to `url`

## 2.2.1 - 2026-04-03

### Patch Changes

- 32373ae: Fix fetch tool returning empty content bodies, pollen data empty results, and forecast stale-day entries.
  - **fetch:** Extract content from MeteoSwiss web component attributes (`<mch-text html="...">`) that JSDOM cannot render via shadow DOM
  - **fetch:** Clarify that `id` parameter must be a full URL from search results
  - **pollen:** Update data URL from `_d_now.csv` to `_d_recent.csv` after MeteoSwiss OGD rename
  - **forecast:** Filter out past dates before slicing to requested days count
  - **search:** Document upstream pagination overlap and date-asc sort behavior

## 2.2.0 - 2026-04-03

### Minor Changes

- ff0cf3b: Add opt-in Prometheus metrics via `prom-client` (#58). Set `METRICS_ENABLED=true` to expose a standard `/metrics` endpoint; when unset or `false` (default), `/metrics` returns 404 and all recording functions are no-ops.
  - **Metrics exposed**: `mcp_tool_calls_total{tool_name}` (counter), `mcp_tool_call_duration_seconds{tool_name}` (latency histogram), `mcp_active_sessions` (gauge), `mcp_requests_total{method}` (HTTP request counter), and `nodejs_*` runtime metrics (memory, GC, event loop)
  - **Privacy**: No user data is collected — only tool names, HTTP methods, and session counts

## 2.1.0 - 2026-03-29

### Minor Changes

- 0ba372a: Add weather icon SVG URLs to forecast responses. Each daily forecast now includes a `weather_icon_url` field linking to the official MeteoSwiss SVG pictogram. The skill documentation is updated with the URL pattern.

## 2.0.2 - 2026-03-29

### Patch Changes

- a976037: Add MCP Registry metadata (`mcpName` + `server.json`) and register with the official MCP Registry.

## 2.0.1 - 2026-03-29

### Patch Changes

- 63f6f7f: Add an automated GitHub Actions release pipeline (#50). Publishes to npm via Trusted Publishers (OIDC, no tokens) and builds multi-platform Docker images (amd64 + arm64) to GHCR. Also fixes the published npm package size (65 kB, previously 81 MB) and adapts the Docker build and release workflow to the monorepo layout.

## 2.0.0 - 2026-03-29

### Major Changes

- d6b1c62: Complete rewrite on MeteoSwiss Open Government Data (OGD) — the same data powering the MeteoSwiss app and website (#43).
  - **Monorepo restructure** under `meteoswiss-llm-tools`, ready for future packages
  - **New tools**: `meteoswissLocalForecast` (multi-day forecasts for ~6000 Swiss locations by postal code, station, or place name), `meteoswissCurrentWeather` (real-time measurements from ~160 automatic weather stations), `meteoswissStations` (station discovery and search), `meteoswissPollenData` (pollen data from ~15 monitoring stations), plus `search` and `fetch` for MeteoSwiss website content
  - **Removed** the region-based `meteoswissWeatherReport` tool
  - **Transport**: Migrate from SSE to MCP Streamable HTTP (SDK 1.28+)
  - **Dependencies**: Upgrade to Zod 4

## 1.0.0 - 2025-06-09

### Major Changes

- 74b8c37: First stable release — MCP server for MeteoSwiss weather data.
  - **`meteoswissWeatherReport`** tool: weather reports for Swiss regions (north / south / west)
  - Multi-language support (DE, EN, FR, IT)
  - HTTP/SSE transport with `mcp-remote` integration
  - Docker support and a homepage with installation instructions
