---
"meteoswiss-mcp": patch
---

Bump runtime dependencies for security advisories: `@modelcontextprotocol/sdk` ^1.32.1 (GHSA-6qxp-vccf-f47h), `js-yaml` ^5.4.3 (GHSA-r3ph-w7gj-g6xm), plus refreshed `pnpm.overrides` security pins (`shell-quote`, `fast-uri`, `undici`, `ws`, `brace-expansion`, `proxy-addr`, `ip-address`, `@typescript-eslint/utils`). Ignore unpatchable `braces` advisory GHSA-vfj7-8cjw-p6xm (no fixed release exists yet).
