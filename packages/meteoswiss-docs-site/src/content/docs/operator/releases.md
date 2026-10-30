---
title: Releases and upgrading
description: Release channels, version numbering, and how to upgrade a self-hosted MeteoSwiss MCP server.
---

## Channels

| Channel | Where | Use it for |
|---------|-------|------------|
| **Stable** | npm `latest`, Docker `latest` and `X.Y.Z` | Production |
| **Release candidate** | npm `next`, Docker `X.Y.Z-rc.N` | Trying changes before they ship |

The project follows [semantic versioning](https://semver.org/). A release candidate never moves `latest`. The public test instance runs
release candidates and is not stable (see [Connect](../../user/getting-started/#test-instance-early-adopters)).

## Upgrading

1. Read the [changelog](https://github.com/eins78/meteoswiss-llm-tools/blob/main/packages/meteoswiss-mcp/CHANGELOG.md), especially for a
   **major** version.
2. Pin the new tag: `ghcr.io/eins78/meteoswiss-mcp:X.Y.Z` (or `npm install meteoswiss-mcp@X.Y.Z`).
3. Restart and check `GET /health`: the `version` field shows the running build.

The cache directory can be kept across upgrades. Cached files are plain CSV text and are refreshed by their TTL.

### Notable changes

| Version | Change | Action |
|---------|--------|--------|
| **4.0.0** | **Breaking:** `TRUST_PROXY` now defaults to `0` (was `1`) | Behind one reverse proxy, set `TRUST_PROXY=1` **before** upgrading |
| 4.0.0 | New `MAX_SESSIONS_PER_CLIENT` (default 10); batch requests count per message; `fetch` canonicalises URLs | None required |
| 3.1.2 | Forecast CSVs parsed once and shared; new `OGD_PARSE_CACHE_MAX_BYTES`, `OGD_PARSE_WORKERS` | Size the memory bound for your host |
| 3.1.0 | Converted pages cached with stale-while-revalidate; new `CONTENT_*` variables | None required |

## Verifying a release

Releases are published from CI with npm provenance, so the npm package links back to the exact source commit. The Docker image is built
from the same tag, for `linux/amd64` and `linux/arm64`.
