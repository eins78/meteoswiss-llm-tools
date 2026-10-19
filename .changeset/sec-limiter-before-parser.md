---
"meteoswiss-mcp": patch
---

The rate limiter now runs before the JSON body parser, so a client over its quota is refused before its body is read. The parser only runs on `/mcp`, and it refuses compressed request bodies (415) instead of inflating them. Malformed JSON now gets 400 with a JSON-RPC parse error, and an oversize body gets 413. Both returned 500 before.
