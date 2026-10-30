---
title: Configuration
description: Every environment variable of the MeteoSwiss MCP server, with its default.
---

All configuration is through environment variables. The core settings (server, sessions, rate limiting) are validated at startup; an invalid value stops the server with a
message naming the variable. The cache variables are not validated: a non-numeric value is not rejected, so set them carefully.

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Listen port (1-65535) |
| `BIND_ADDRESS` | `0.0.0.0` | Interface to bind: an IPv4 address, `localhost`, `::` or `::1` |
| `NODE_ENV` | `production` | `development`, `production` or `test` |
| `PUBLIC_URL` | unset | Public URL including protocol, used to build the endpoint shown on `/` and `/health` |
| `TRUST_PROXY` | `0` | Number of trusted reverse-proxy hops. **Set `1` behind one proxy.** See [Run your own instance](../install/#behind-a-reverse-proxy) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `REQUEST_SIZE_LIMIT` | `10mb` | Maximum request body size (413 when exceeded) |
| `MAX_RESPONSE_BYTES` | `52428800` | Hard ceiling (50 MiB) on any single upstream response body |
| `METRICS_ENABLED` | `false` | Expose Prometheus metrics at `/metrics` |

## Sessions and rate limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_SESSIONS` | `100` | Maximum concurrent sessions; further initialisations get 503 |
| `MAX_SESSIONS_PER_CLIENT` | `10` | Sessions one client IP may hold; above it an initialise gets 429 |
| `SESSION_TIMEOUT_MS` | `300000` | Idle session timeout (5 minutes) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Requests per client per window. A JSON-RPC batch counts every message in it |

The client is identified by the IP address Express sees, which is why `TRUST_PROXY` must match your deployment.
The rate limiter runs before the body parser, so a client over quota is refused before its body is read.

## Data cache (OGD)

MeteoSwiss CSV files are cached on disk, with a time-to-live per tier. Writing the cache is best-effort: a failed write is logged and the
fetched data is still returned.

| Variable | Default | Description |
|----------|---------|-------------|
| `OGD_CACHE_DIR` | `<os tmpdir>/meteoswiss-ogd` | Directory for cached files. Mount a volume here to keep the cache across restarts |
| `OGD_CACHE_MAX_BYTES` | `268435456` | Size bound (256 MiB); oldest files are pruned beyond it |
| `OGD_CACHE_TTL_REALTIME` | `60000` | Current weather and pollen readings (ms) |
| `OGD_CACHE_TTL_FORECAST` | `3600000` | Forecast data, 1 hour (ms) |
| `OGD_CACHE_TTL_METADATA` | `86400000` | Station and forecast-point lists, 24 hours (ms) |
| `OGD_CACHE_TTL_CLIMATE` | `604800000` | Climate series, 7 days (ms) |
| `OGD_CACHE_DIR_REAP_MIN_AGE_MS` | `60000` | How long an empty cache directory must be idle before it is removed |

## Forecast parsing

Forecast files are large. Each cached file version is parsed once into a compact in-memory index, shared by all requests.

| Variable | Default | Description |
|----------|---------|-------------|
| `OGD_PARSE_CACHE_MAX_BYTES` | `134217728` | Memory bound (128 MiB) for parsed indexes; `0` disables retention. A full station forecast run retains about 100 MB |
| `OGD_PARSE_WORKERS` | `min(2, cores - 1)` | Worker threads that build the index; `0` builds on the main thread |

## Website content cache (`search`, `fetch`)

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTENT_CACHE_TTL_MS` | `300000` | How long a converted page is fresh (5 minutes) |
| `CONTENT_CACHE_SWR_MS` | `3300000` | Afterwards, how long a stale page is still served while it refreshes in the background (55 minutes) |
| `CONTENT_CACHE_MAX_ENTRIES` | `200` | Maximum converted pages kept |
| `CONTENT_MEMO_MAX_ENTRIES` | `200` | Maximum entries in the HTML-to-markdown conversion memo |
| `HTTP_CACHE_MAX_ENTRIES` | `1000` | Maximum entries in the in-memory HTTP response cache |
| `GEOCODE_CACHE_MAX_ENTRIES` | `2000` | Maximum cached address lookups |

For the two `CONTENT_CACHE_*` time settings an empty value counts as unset, so `CONTENT_CACHE_TTL_MS=` in a Compose file does not disable the cache. The `OGD_CACHE_*` variables behave differently: an empty value is read as `0`, which turns that tier's caching off. Leave a variable out rather than setting it empty.

## Logging and testing

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG` | unset | [`debug`](https://www.npmjs.com/package/debug) pattern, e.g. `mcp:*` or `mcp:transport,mcp:tools` |
| `DEBUG_MCHMCP` | `false` | `true` enables all `mcp:*` namespaces |
| `USE_TEST_FIXTURES` | `false` | Serve bundled fixture data instead of calling MeteoSwiss. For development and demos only |

Debug namespaces: `mcp:main`, `mcp:server`, `mcp:transport`, `mcp:tools`, `mcp:data`, `mcp:http`, `mcp:session`, `mcp:env`.
Logs go to stderr, so the same setting works in Docker (`docker logs`).
