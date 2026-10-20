---
"meteoswiss-mcp": patch
---

A JSON-RPC batch on `POST /mcp` now counts every message it carries against the per-client rate limit. Before, the batch counted as one request, so one POST could run up to 100 tool calls. A batch that goes over the remaining quota gets 429.
