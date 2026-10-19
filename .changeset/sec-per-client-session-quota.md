---
"meteoswiss-mcp": minor
---

New `MAX_SESSIONS_PER_CLIENT` setting (default `10`) limits how many sessions one client IP can hold open. Before, one client could open every one of the `MAX_SESSIONS` slots and keep them alive with pings, so all new clients got 503 for as long as it kept pinging. An initialize over the client's quota now gets 429; the client's other sessions keep working. The client IP is the one the rate limiter sees, so set `TRUST_PROXY` correctly behind a proxy.
