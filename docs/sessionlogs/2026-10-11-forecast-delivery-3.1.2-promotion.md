# Delivering #171, cutting 3.1.2-rc.0, promoting 3.1.2 to TEST and PROD

**Date:** 2026-10-11
**Source:** Claude Code (Sonnet 5.5), delegated from homebot
**Session:** Continues `2026-10-11-forecast-parse-cache.md`, which covers building the parse cache and the
fast parser. Max's go-aheads came via homebot: deliver #171 then RC and TEST (20:39), then "promote
3.1.2" to TEST and PROD (21:46). Worker-thread and memo design are in that earlier log; this one is the
delivery path and what the real deployments showed.

## Summary

#171 was reviewed, one real bug fixed, and merged. Version Packages (#172) produced 3.1.2; the RC went to
TEST by the poller, the stable release to TEST and PROD by the deploy scripts. Everything ran clean:
health on all three endpoints, 7-tool smoke on TEST and PROD, no restarts, no OOM, no worker errors.

| | |
|---|---|
| #171 | merged `903dc65` (merge commit, no squash) |
| #172 Version Packages | merged `7bef624`; its CI was `action_required` (bot gate) and was re-run under a real identity, 5/5 green |
| RC | `meteoswiss-mcp-v3.1.2-rc.0` pre-release from #172's head `e14b0e7`; npm `next`, GHCR `3.1.2-rc.0` |
| Stable | `meteoswiss-mcp-v3.1.2` (`--latest`, target `7bef624`); npm `latest=3.1.2`, GHCR `:3.1.2` multi-arch, digest `sha256:fd971ca3…` |
| TEST | RC deployed by the poller at 18:50 UTC; `3.1.2` by `meteoswiss-deploy.sh test 3.1.2` (deployment 7000904890) |
| PROD | `meteoswiss-deploy-prod.sh 3.1.2` (deployment 7000909489); 13 live sessions at recreate |

## The review found a real bug

`/code-review 171 high` reported one finding, and it held up. When a pool worker died, only that worker's own
job was rejected; jobs queued behind it were never started. With `OGD_PARSE_WORKERS=1` (or a 2-CPU host)
those queued promises are the memo's single-flight promises, so every later request for the same files
would have hung until restart. Fix: `refill()` starts replacement workers while work is queued, and
rejects the queue if a replacement cannot start so callers take their in-thread fallback.

The test kills the only worker with four large jobs queued. I confirmed it fails without the fix (the jobs
never settle, 40 s timeout) and passes with it; my first run passed in 0.7 s, which is why I checked that
it was not vacuous. The fix went in as a `--fixup` and an autosquash rebase, so history has no fixup commits.
The one snag: `pnpm install` leaves `node_modules/jsdom` modified in this repo, which blocks a rebase, so
it was hidden with `skip-worktree` for the rebase instead of using the shared stash.

## What TEST and PROD showed

Eight concurrent forecasts, empty cache for the cold wave. The 3.1.1 reference ran in a throwaway container
with the same image and env, because the poller had already upgraded TEST before my baseline started.

| | 3.1.1 | 3.1.2-rc.0 (TEST) | 3.1.2-rc.0 (clean container) |
|---|---|---|---|
| cold wave | 134 s | 3.4 s | 3.9 s |
| container peak, cold wave | 2697 MiB | 962 MiB | 976 MiB |
| slowest cheap request during the wave | 7.3 s | 0.66 s | 0.37 s |
| warm wave | 122 s | 65–128 ms | 67 ms |
| single warm call | 16–18 s | 13–24 ms | 11 ms |

PROD, first cold forecast after the 3.1.2 deploy (empty cache): Zurich 2.8 s, Bern 83 ms; container
memory 157 MiB to a cgroup peak of 883 MiB, then 658 MiB, then about 475 MiB after the workers idled out.
That is one call, not the 8-way wave: the live service was not loaded further.

The 3.1.1 cold wave exceeded the MCP client's default 60 s request timeout, so the first reference run
failed with `-32001` until the timeout was raised. That is also a fair description of 3.1.1 for a client.

## Things that went wrong or nearly did

- **My "baseline" on TEST was not a baseline.** I started it expecting 3.1.1; the poller had deployed the
  RC about a minute earlier, and a cold 8-way wave in 3.4 s was the tell. I confirmed with `StartedAt` and
  the poller state file, then rebuilt the reference with throwaway containers.
- **The smoke's `fetch` failed on a stale URL.** The page from the old e2e script now returns 404
  upstream. The smoke takes the id from a live `search` result instead, as the 3.1.1-rc.0 session had
  already learned. The e2e script still has the stale URL.
- **The deploy poller's log is blocked for this session by `.ckignore`.** I did not work around it; state
  came from `docker inspect`, the poller's state file and `/health`.

## Not verified

- The rollback path of the deploy scripts: every health check passed on the first attempt.
- Behaviour of the worker pool under sustained production traffic: it had been live for minutes.
- PROD under an 8-way cold wave; its cold peak is inferred from one call and from TEST (962 MiB).

## Open items

- [ ] Commit the compose tags (`3.1.2` on both services) to docker-infra `main`; the live file is already
      edited, and this session's sandbox refuses git outside its worktree. Owner: homebot / Max.
- [ ] `scripts/e2e-test.mjs` still fetches a page that now 404s (`wind.html`).
- [ ] Other tiers (realtime, climate, metadata) still parse per request.
