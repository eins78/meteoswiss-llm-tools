---
"meteoswiss-mcp": patch
---

Update dependencies to fix published security advisories: `zod` 4.6.7 (GHSA-mrhx-c7xc-m3w5), `body-parser` 2.4.0 (GHSA-27r3-jxmh-p828), `qs`, `undici`, `fast-uri`, `ip-address`, `hono` and `@hono/node-server`, reached through `@modelcontextprotocol/sdk` 1.32.2, `express` 5.3.0 and `express-rate-limit`. No tool behaviour changes. `tools/list` now advertises nullable fields as `"type": ["string", "null"]` instead of `anyOf`; the two forms are equivalent JSON Schema.
