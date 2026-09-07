---
"meteoswiss-mcp": patch
---

Fix intermittent `ENOENT … rename` failures that made forecast requests fail.

**The outage.** A failing *cache write* was taking down the whole request. A cache is an optimisation; a failed optimisation must not fail the request. Cache writes are now best-effort — the fetched data is returned and served regardless, with the failure logged to stderr rather than only to the `DEBUG` channel.

Three races produced that identical error, and all three are closed:

- `pruneDiskCache` deleted every `.tmp` file it found, including ones a concurrent write was still using — so the write's own temp file vanished before its `rename`. Writes now go through `write-file-atomic`, whose per-path queue and collision-free names leave the sweep with nothing worth the risk it carried, and the sweep is gone. (It also removes its own temp file on a *clean* exit; a SIGKILL can still orphan one, but orphans are bounded — they count toward the cache ceiling and are age-evicted like anything else, and are never served, since reads go by exact path.)
- Temp names were built from `Date.now()`, so two writers to the same key in the same millisecond picked the same name; one renamed it away and the other hit `ENOENT`. `write-file-atomic`'s names mix pid, thread id and a monotonic counter, which cannot collide that way.
- `pruneDiskCache` now also reaps cache directories once they are empty, so the per-day `forecasts/<date>-ch/` husks no longer accumulate indefinitely — but a directory is created by `mkdir` and only populated a few awaits later, when the atomic write opens its temp file inside it. Reaping one in that window would fail the write with the very `ENOENT` this release removes, so reaping is gated on the directory being at least a minute old, and the write re-creates the directory and retries once if it loses that race anyway.

Measured against the built artifact: six concurrent 30 MB writers went from 4–5 of 6 failing to **0 of 6** at every stagger tested, 40 same-key writers from 30 `ENOENT` to **0**, and the directory race from 35–56 of 100 trials to **0 of 100**.

New optional environment variable: `OGD_CACHE_DIR_REAP_MIN_AGE_MS` (default 60000).
