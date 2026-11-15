---
"meteoswiss-mcp": patch
---

Fixes found by a QA pass over `meteoswissWeatherSituation`:

- The tool now rejects a parameter it does not know (for example `min_altitude` for `min_altitude_m`) with an error that names it, instead of silently returning an unfiltered count.
- A window that begins before the run's first hour or ends after its last hour now says so in its warning ("2 before the run's first hour"), instead of blaming sparse steps.
- The legend lists only categories the answer shows, so it no longer names one whose share rounded to 0 %.
- The description now says that a few places have two points, that one clear sky can show as `sunny` and `clear_night` around sunrise and sunset, and that `fog_or_stratus` at high altitude usually means a summit in cloud.
- The text copy of the answer is compact JSON (about half the size); `structuredContent` is unchanged.
- `meteoswissLocalForecast`: `generated` is now the forecast run (for example `2026-11-15T11:00:00Z`) instead of the day's first upload (about 04:00 UTC).
- A postal code shared by several points (6900: Lugano, Massagno, Paradiso) now resolves to its own place, Lugano, instead of the last one listed.
