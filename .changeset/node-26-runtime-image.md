---
"meteoswiss-mcp": patch
---

The container image now runs on Node.js 26 LTS (`node:26-alpine`, was `node:24-alpine`), and `@types/node` is `^26`. The supported range is unchanged: `engines.node` stays `>=22.0.0`, so installs from npm on Node 22 and 24 keep working.
