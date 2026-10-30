---
title: Monitoring
description: Health check, Prometheus metrics, logging and troubleshooting for a self-hosted MeteoSwiss MCP server.
---

## Health check

`GET /health` returns JSON:

```json
{ "status": "ok", "version": "4.0.0", "sessions": 2, "endpoint": "https://meteoswiss-mcp.example.org/mcp" }
```

The Docker image runs this check every 30 seconds. The route sits behind the global rate limiter, so a monitor that polls far more often than
`RATE_LIMIT_MAX_REQUESTS` allows will see `429` responses. Treat a `429` as "up" and poll once a minute or less. The image's own Docker health check does not: it fails on any status other than 200, so a container under heavy load can be marked unhealthy.

## Metrics

Set `METRICS_ENABLED=true` to expose Prometheus metrics at `GET /metrics`.

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `mcp_requests_total` | counter | `method` | HTTP requests that pass the rate limiter, on any route (including `/health`) |
| `mcp_tool_calls_total` | counter | `tool_name` | Tool invocations |
| `mcp_tool_call_duration_seconds` | histogram | `tool_name` | Tool latency (buckets 10 ms to 10 s) |
| `mcp_active_sessions` | gauge | | Open sessions |
| `meteoswiss_mcp_build_info` | gauge | `version`, `node_version` | Always 1; identifies the running build |

The default Node.js process metrics (memory, event loop, GC) are included. `/metrics` is not authenticated: do not publish it. Scrape it on
an internal network, or block the path at your reverse proxy.

## Logs

Logs go to stderr. Set `DEBUG=mcp:*` for detail, or narrow it (`mcp:tools,mcp:data`). Tool failures are logged as one sanitised line; the
full error is in the debug log.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| All clients get `429` quickly | `TRUST_PROXY=0` behind a proxy: every client shares the proxy's bucket. Set it to the hop count |
| `503` when connecting | `MAX_SESSIONS` reached |
| `429` on initialise only | `MAX_SESSIONS_PER_CLIENT` reached for that client |
| `415` / `413` / `400` on `POST /mcp` | Compressed body (refused), body over `REQUEST_SIZE_LIMIT`, or malformed JSON |
| First forecast request is slow | Cold cache: the forecast file is downloaded and parsed once; later requests are served from memory |
| Forecast tool memory grows | Bound it with `OGD_PARSE_CACHE_MAX_BYTES`, or set `0` |
| Tools fail with network errors | The server cannot reach `data.geo.admin.ch` or `api3.geo.admin.ch` |
