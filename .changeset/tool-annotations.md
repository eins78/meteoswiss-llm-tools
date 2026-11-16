---
"meteoswiss-mcp": patch
---

All 8 tools now declare that they only read (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`) and carry a human `title`. Clients that ask before every tool without a read-only hint, such as ChatGPT developer mode, no longer treat weather calls as write actions.
