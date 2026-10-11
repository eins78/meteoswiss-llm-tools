# Parse each cached forecast CSV once, then parse it 25x faster

**Date:** 2026-10-11
**Source:** Claude Code (Sonnet 5.5), delegated from homebot
**Session:** Max authorised the fix (Telegram, 19:23) for the warm-cache slowness noted in
`2026-09-11-rc-release-3.1.0-rc.0.md`: the disk cache saved the download but every request re-parsed
~178 MB of CSV on the event loop. At 19:56 Max asked for the parse itself to be sped up before the
PR merges ("in theory we don't even need generic code since we know the exact schema"), which is part
two below. Constraints: PR only, no merge/release/deploy, local runs only.

## Summary

Two steps. First, forecast CSVs are parsed once per cached file version into a compact in-memory
index. Second, that parse became a schema-specific byte scanner on worker threads. End to end, a cold
forecast call went from 11.7 s to 0.67 s, a repeat call from 11.4 s to 8 ms, and eight concurrent
calls from 91 s to 1.0 s. Peak RSS for concurrent calls is under half the original; for a single
call it is about the same.

## End-to-end measurement

`scripts/bench-forecast.ts`, committed before any change and run unchanged at each stage. Disk cache
warm, forecast run `20261011-ch`, each scenario in a fresh process, medians (3 reps before and after
step one, 5 reps after step two). Peak RSS is `process.resourceUsage().maxRSS`.

| Scenario | Before | Step 1 (parse once) | Step 2 (+ fast parse) |
|---|---|---|---|
| single call, first in process | 11.7 s / 564 MiB | 15.3 s / 549 MiB | 0.67 s / 600 MiB |
| second call, same process | 11.4 s / 606 MiB | 14 ms / 527 MiB | 8 ms / 605 MiB |
| 8 concurrent, fresh process | 91.2 s / 1500 MiB | 15.5 s / 520 MiB | 1.0 s / 707 MiB |
| 1 call, then 8 concurrent | 87.6 s / 1610 MiB | 305 ms / 545 MiB | 88 ms / 623 MiB |

The machine was shared with other sessions (load average 7–33 on 14 cores), so absolute numbers
move by tens of percent between runs; the ratios do not.

## Step 1: the parse memo

- Parsed `CsvRow` objects were out: 1.28 M rows per file would cost hundreds of MB. The index keeps,
  per `(point_id, point_type_id)`, interned timestamp ids plus a `Float64Array` (NaN means missing).
- `ogd-parse-memo.ts`: keyed by cache key, versioned `mtimeMs:size`, single-flight, rejections never
  cached, LRU eviction by bytes. The bound matters beyond tidiness: a new forecast run is a new cache
  key, so only eviction releases the previous run.
- `getIndexedCsvData` also single-flights the cold path (download, write, build). The 3.1.0 session
  saw 48 downloads for 8 concurrent cold callers.
- A failed disk write returns the freshly built value without memoising it.

## Step 2: autoresearch on the parse

Metric `parse_ms` (`scripts/bench-parse.ts`): read and index the six hourly forecast files of one run
(183 MiB, 7.7 M rows) from disk, median of 5–7 runs; lower is better. Guard: a SHA-256 over every
point's complete series for every file, recorded before the first change and required to be identical
(`--dump` / `--check`), plus the package test suite. Seven iterations, then stopped: what remained was
within the noise of a shared machine.

| # | parse_ms | Result | Change |
|---|---|---|---|
| 0 | 12826 | baseline | `csv-parse` via `parseCsv` + recording filter |
| 1 | 787 | keep | schema-specific byte scanner on the `Buffer`, generic fallback, counting sort into typed arrays |
| 2 | 682 | keep | direct id-to-point table instead of `Map.get` per row |
| 3 | 671 | keep | flat arrays with per-point slices (peak RSS 745 to 574 MiB, time flat) |
| 4 | 709 | dropped | reuse the previous row's `Date` when the bytes match: slower than parsing 12 digits |
| 5 | 337 | keep | worker pool, two workers, buffers transferred: six files in parallel, event-loop stall 254 to 7 ms |
| 6 | 251 | keep | estimate the row count from the first 64 KiB instead of 1.28 M `indexOf('\n')` calls (A/B, same load: 626 to 430 ms in-thread) |
| 7 | no gain | dropped | scan a plain `Uint8Array` view instead of the `Buffer` (A/B: 548/422 vs 565/473 ms) |

Iterations 5 and 6 were measured with workers on; the in-thread equivalents are 755 to 430 ms.
Bytes per second: the single-thread scanner reads about 400 MB/s, against 15 MB/s for the generic path.

**The scanner is strict on purpose.** It accepts only the OGD layout (exact header, `\n`, no quotes or
padding, integer ids without leading zeros, an all-digit `Date`, a plain decimal of at most 15 digits
or empty or `-`) and returns `null` on the first byte that deviates. The caller then runs the generic
parser, so unusual input keeps its exact semantics. Decimals are `m / 10^k` with `m < 2^53`, which is
correctly rounded and so bit-identical to `Number()`, including `-0`. Tests cover each fallback trigger
(CRLF, quotes, padding, exponent, long mantissa, leading zeros, BOM, wrong header, short and long
rows) and compare to the generic parser.

**The worker pool is an optimisation, never a dependency.** Inputs under 4 MiB, `OGD_PARSE_WORKERS=0`
and any worker failure all build on the calling thread. Buffers are transferred, not copied (a copy
cost ~300 MiB of peak RSS); the callers pass a `reload` function so a failed worker costs a re-read,
not the request. Workers are lazy and terminated after 30 s idle. When run from `.ts` the worker is
loaded through a tsx `register()` shim, because a bare `.ts` worker cannot resolve `.js` specifiers;
the compiled `dist` path was smoke-tested separately with plain `node` (about 340 ms warm).

### Dropped without trying, with reasons

- **Persisted binary index next to the cache file.** It would hold ~91 MB beside ~190 MB of CSV
  against a 256 MiB cache bound, forcing evictions, and the parse is now ~0.3 s: not worth the second
  cache-invalidation path.
- **Streaming the file.** Reading all six files takes ~40 ms (page cache); the cost was never I/O.
- **A faster CSV library.** None was needed: a purpose-built scanner is 25x faster than the generic
  parser and adds no dependency.

## Not verified

- The production container's memory limit, and its CPU count. The 128 MiB memo bound is sized from
  ~100 MB measured; the workers add a few hundred MB of transient peak during a cold parse (peak RSS
  600–700 MiB end to end). On a small container set `OGD_PARSE_WORKERS=0` and/or lower
  `OGD_PARSE_CACHE_MAX_BYTES`.
- Production traffic shape and TEST/PROD behaviour: nothing was deployed.
- Workers under the production image: only a local `node` run of the compiled output.
- Other tiers (realtime, climate, metadata) still parse per request; forecast came first.
