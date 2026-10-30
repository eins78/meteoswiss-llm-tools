---
title: Run your own instance
description: Install the MeteoSwiss MCP server with Docker, npm or from source, and put it behind a reverse proxy.
---

You can run the server yourself. It needs outbound HTTPS access to `data.geo.admin.ch`, `api3.geo.admin.ch` and the four MeteoSwiss website hosts, one per search
language: `www.meteoschweiz.admin.ch` (de), `www.meteosuisse.admin.ch` (fr), `www.meteosvizzera.admin.ch` (it) and `www.meteoswiss.admin.ch` (en)
(see [data sources](../../user/data-and-limits/)); it needs no API key and no database.

## Docker (recommended)

Images are published to GitHub Container Registry for `linux/amd64` and `linux/arm64`.

```bash
docker run -p 3000:3000 ghcr.io/eins78/meteoswiss-mcp:latest
```

The MCP endpoint is then `http://localhost:3000/mcp`. The image runs as a non-root user, listens on port 3000 and has a built-in
health check against `/health`.

Tags:

| Tag | Meaning |
|-----|---------|
| `latest` | The newest stable release |
| `X.Y.Z` | A specific stable release; pin this in production |
| `X.Y.Z-rc.N` | A release candidate. Never moves `latest` |

A minimal Compose file with a persistent cache:

```yaml
services:
  meteoswiss-mcp:
    image: ghcr.io/eins78/meteoswiss-mcp:latest
    ports:
      - "127.0.0.1:3000:3000"     # reachable only from the host; the reverse proxy connects here
    environment:
      PUBLIC_URL: https://meteoswiss-mcp.example.org
      TRUST_PROXY: "1"            # one reverse proxy in front
      OGD_CACHE_DIR: /cache
      METRICS_ENABLED: "true"
    volumes:
      - ogd-cache:/cache          # see "Persistent cache" below: must be writable by uid 1001
    restart: unless-stopped
volumes:
  ogd-cache:
```

**Bind the port to the loopback interface** (as above) when a proxy sits in front and `TRUST_PROXY=1`. If port 3000 is published on every
interface, clients can reach the server directly, send their own `X-Forwarded-For` header, and get a fresh rate-limit and session bucket per
request. The same goes for `/metrics`, which is unauthenticated. Alternatively keep the container on a private Docker network that only the proxy
joins.

### Persistent cache

The image runs as user `nodejs` (uid 1001), but a new named volume is owned by root, so cache writes would fail (requests still succeed; the
cache just stays empty). Give the volume to uid 1001 once, before the first start:

```bash
docker run --rm --user root --entrypoint chown -v ogd-cache:/cache ghcr.io/eins78/meteoswiss-mcp:latest 1001:1001 /cache
```

With Compose the volume is named `<project>_ogd-cache`; check `docker volume ls` and use that name.

:::note
The `docker-compose.yml` in the repository builds the image itself and sets `context: .`, but the `Dockerfile` expects the **repository root**
as its build context (it needs the workspace lockfile). If you build from source, run `docker build -f packages/meteoswiss-mcp/Dockerfile .`
from the root. Using the published image avoids the question.
:::

## npm

The package is published as [`meteoswiss-mcp`](https://www.npmjs.com/package/meteoswiss-mcp) (Node.js 22 or newer). It has no `bin` entry, so
there is no `npx meteoswiss-mcp` command; install it and start the entry point with Node from inside the package:

```bash
mkdir meteoswiss && cd meteoswiss
npm install meteoswiss-mcp
cd node_modules/meteoswiss-mcp
node dist/index.js
```

Start it from inside the package directory: the landing page reads its markdown from `src/views/homepage` relative to the working
directory, so from anywhere else `GET /` loses its content (the MCP tools are unaffected).

Release candidates are published under the `next` dist-tag (`npm install meteoswiss-mcp@next`). Note that `next` points at the most recent
*pre-release*, which can be older than `latest` after a stable release.

## From source

```bash
git clone https://github.com/eins78/meteoswiss-llm-tools.git
cd meteoswiss-llm-tools
pnpm install
pnpm --filter meteoswiss-mcp run build
pnpm --filter meteoswiss-mcp run start
```

## Transport

The only transport is **Streamable HTTP** (MCP spec 2025-11-25). There is no stdio mode. Clients that need stdio can bridge with `mcp-remote`
(see [Connect](../../user/getting-started/)).

| Route | Purpose |
|-------|---------|
| `POST /mcp` | MCP requests |
| `GET /mcp` | Server-sent notifications for a session |
| `DELETE /mcp` | End a session |
| `GET /health` | Health check ([monitoring](../monitoring/)) |
| `GET /metrics` | Prometheus metrics, only when `METRICS_ENABLED=true` |
| `GET /` | Landing page (HTML), or a JSON description for clients that ask for JSON |

## Behind a reverse proxy

Terminate TLS in a proxy such as Caddy or nginx and forward to port 3000. Two settings matter:

- **`TRUST_PROXY`** is the number of proxy hops in front of the server. It defaults to `0`. With one proxy, set `TRUST_PROXY=1`.
  Left at `0`, every client appears to come from the proxy's address and **shares one rate-limit bucket and one session quota**. The server logs
  a warning the first time it sees an `X-Forwarded-For` header while `TRUST_PROXY=0`.
- **`PUBLIC_URL`** is the full public URL (with protocol). It is used for the endpoint shown on the landing page and in `/health`.

The proxy must not buffer the `GET /mcp` event stream.
