# Parse each cached forecast CSV once, not once per request

**Date:** 2026-10-11
**Source:** Claude Code (Sonnet 5.5), delegated from homebot
**Session:** Max authorised the fix (Telegram, 19:23) for the warm-cache slowness noted in
`2026-09-11-rc-release-3.1.0-rc.0.md`: the disk cache saved the download but every request re-parsed
~178 MB of CSV on the event loop. Constraints: PR only, no merge/release/deploy, local runs only.

## Summary

Forecast CSVs are now parsed once per cached file version into a compact in-memory index. A warm call
went from ~11 s to ~15 ms and eight concurrent calls from ~91 s to ~15 s, at about a third of the peak
RSS. The one regression: the first, cold parse is ~30% slower (11.7 s to 15.3 s).

## Measurement

`scripts/bench-forecast.ts`, committed before the change and run unchanged after. Disk cache warm,
forecast run `20261011-ch`, each scenario in a fresh process, 3 reps, medians. Peak RSS is
`process.resourceUsage().maxRSS`.

| Scenario | Before | After |
|---|---|---|
| single call, first in process | 11.7 s / 564 MiB | 15.3 s / 549 MiB |
| second call, same process | 11.4 s / 606 MiB | 14 ms / 527 MiB |
| 8 concurrent, fresh process | 91.2 s / 1500 MiB | 15.5 s / 520 MiB |
| 1 call, then 8 concurrent | 87.6 s / 1610 MiB | 305 ms / 545 MiB |

Retained memo after a station forecast (9 files): 84 MB; after a postal-code forecast as well
(10 files): 100 MB. `process.memoryUsage().heapUsed` read 113 MB, so the size estimate holds.

## Design

- Parsed `CsvRow` objects were out: 1.28 M rows per file would cost hundreds of MB. The index keeps,
  per `(point_id, point_type_id)`, interned timestamp ids plus a `Float64Array` (NaN means missing).
  It is built by running the existing `parseCsv` with a recording filter, so quoting and null
  handling are unchanged. A test checks it against the old path field for field.
- `ogd-parse-memo.ts`: keyed by cache key, versioned `mtimeMs:size`, single-flight, rejections never
  cached, LRU eviction by bytes. The bound matters beyond tidiness: a new forecast run is a new
  cache key, so only eviction releases the previous run.
- `getIndexedCsvData` also single-flights the cold path (download, write, build). The 3.1.0 session
  saw 48 downloads for 8 concurrent cold callers.
- A failed disk write returns the freshly built value without memoising it.

## Not verified

- The production container's memory limit. The 128 MiB default is sized from the 100 MB measured
  here; if the limit is tight, set `OGD_PARSE_CACHE_MAX_BYTES` lower (down to `0`).
- Production traffic shape and TEST/PROD behaviour: nothing was deployed.
- Other tiers (realtime, climate, metadata) still parse per request; forecast came first.
