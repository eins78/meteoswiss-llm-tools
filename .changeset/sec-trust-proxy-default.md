---
"meteoswiss-mcp": minor
---

**Breaking for deployments behind a reverse proxy:** `TRUST_PROXY` now defaults to `0` (was `1`). With the old default, a client that reached the server directly could send a different `X-Forwarded-For` on each request and get a fresh rate-limit bucket every time. If the server runs behind one proxy such as Caddy, set `TRUST_PROXY=1` before upgrading, or every client shares the proxy's rate-limit bucket.

The server logs a warning the first time a request with `X-Forwarded-For` arrives while `TRUST_PROXY=0`.
