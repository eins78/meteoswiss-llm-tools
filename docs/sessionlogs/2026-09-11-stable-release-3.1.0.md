# Closing the prerelease: 3.1.0 stable, on npm, GHCR, TEST and PROD

**Date:** 2026-09-11
**Source:** Claude Code (Opus 5)
**Session:** Third and last phase of the day. `3.1.0-rc.0` had been verified on TEST and then on
PROD with zero `ENOENT`, so the instruction was to exit pre mode, cut the stable `3.1.0`, put it on
both environments, and verify PROD again. Stop conditions were the build or the deploy failing —
not the fix, which was already verified twice.

Prior logs for this release: `2026-09-11-rc-release-3.1.0-rc.0.md` (the RC, the changeset rewrite,
the deploy-script bug) and `2026-09-05-ogd-cache-enoent-races.md` (the fix itself).

## Summary

`meteoswiss-mcp@3.1.0` is on npm as `latest`, on GHCR as `3.1.0` and `latest`, and running on both
TEST and PROD. No stop condition fired.

Two things are worth reading beyond the mechanics:

1. The TEST deploy was the **first live case that discriminates the deploy-script fix**. Both compose
   image lines read `3.1.0-rc.0` going in, so the old file-wide `sed` would have rewritten PROD's
   line too. Only TEST's changed.
2. The generated changelog now carries `## 3.1.0` and `## 3.1.0-rc.0` with **identical content**.
   Left alone — see §2.

## 1. Exiting pre mode

`pnpm changeset pre exit` flips one field: `.changeset/pre.json`, `mode: "pre"` → `mode: "exit"`.
It does not version anything; `changeset version` is what consumes the file.

Rather than trust that, `pnpm run version` was run locally against the branch and then reverted, so
the Version Packages PR still generated the bump itself. What the dry run established, before any
of it was public:

- `meteoswiss-mcp` `3.1.0-rc.0` → **`3.1.0`** — not `3.1.1`, not `3.2.0`
- `meteoswiss-skills` untouched at `1.1.0`
- `.changeset/pre.json` is **deleted**, not left in `mode: "exit"` — so pre mode is genuinely closed
  once that PR merges, and the next changeset is a normal release again
- the three changeset files are consumed

Reverting needed care: `git checkout -- packages/meteoswiss-mcp/CHANGELOG.md
packages/meteoswiss-mcp/package.json .changeset/` and then re-running `pre exit`. A whole-tree
checkout would have reverted this worktree's tracked `node_modules` drift to a stale snapshot.

PR #153 (`ca0eb37`) carried exactly one changed line.

## 2. The duplicated changelog section

`changeset version` emits the stable section and keeps the prerelease section below it:

```
## 3.1.0 - 2026-09-11
  ### Minor Changes   — search/fetch converted-page cache
  ### Patch Changes   — security pins, ENOENT fix

## 3.1.0-rc.0 - 2026-09-11
  ### Minor Changes   — (identical)
  ### Patch Changes   — (identical)
```

The two are identical because the RC shipped exactly this code. Max's standing note on changelogs is
that users care about changes and not about our internals, and a duplicate section is noise by that
measure — but this is *generated* output describing a *real published release*
(`meteoswiss-mcp@3.1.0-rc.0` exists on npm under `next`), so it was left alone rather than
hand-edited. Flagged in the PR body as easy to collapse later if it reads badly.

## 3. Release

| step | result |
|---|---|
| #153 exit pre mode | `ca0eb37` |
| #155 Version Packages → `3.1.0` | `0d96ec3` |
| release `meteoswiss-mcp-v3.1.0` | targeted at `0d96ec3` |

The bot-CI gate behaved as documented again: #155's checks sat at `action_required` until
`gh run rerun 34578822220` re-ran them under a real identity. Still the standing manual step.

Release workflow, all three jobs green:

```
CI Validation      success  08:26:16Z
Publish to npm     success  08:26:42Z
Publish to GHCR    success  08:29:53Z
```

`release.yml` decides prerelease from the **version string**, not the release's `prerelease` flag:
`^[0-9]+\.[0-9]+\.[0-9]+-.+` . So `3.1.0` published to npm with the default dist-tag and pushed
`:3.1.0` **and** `:latest` to GHCR, where `3.1.0-rc.0` had gone to `@next` with `latest` untouched.
Confirmed rather than assumed:

```
$ npm view meteoswiss-mcp dist-tags
{ latest: '3.1.0', next: '3.1.0-rc.0' }
```

## 4. TEST — the deploy-script fix, proven live

The poller could not do this one: `meteoswiss-poll-rc.sh` filters `prerelease==true`, so a stable
release is structurally invisible to it. TEST was deployed by hand, deliberately.

Going in, both image lines were identical:

```
194:    image: ghcr.io/eins78/meteoswiss-mcp:3.1.0-rc.0    # PROD
220:    image: ghcr.io/eins78/meteoswiss-mcp:3.1.0-rc.0    # TEST
```

That is exactly the state in which the old `sed -i '' "s|$OLD_IMAGE|$NEW_IMAGE|"` rewrote both
lines while restarting only one. The RC's PROD deploy could not test this — PROD was on `3.0.0`
then, so the pattern matched one line by luck. This one could:

```
[10:30:18] Updating compose: …:3.1.0-rc.0 -> …:3.1.0 (the .services.meteoswiss_mcp_server_test.image line only)
[10:30:23] Health check passed (attempt 1): version=3.1.0
```

```diff
   meteoswiss_mcp_server_test:
-    image: ghcr.io/eins78/meteoswiss-mcp:3.1.0-rc.0
+    image: ghcr.io/eins78/meteoswiss-mcp:3.1.0
```

**One line. PROD's line 194 untouched.** The `--self-test` fixture predicted this; the deploy
confirmed it against the live file.

## 5. PROD

```
[10:30:38] Updating compose: …:3.1.0-rc.0 -> …:3.1.0 (the .services.meteoswiss_mcp_server.image line only)
[10:30:44] Health check passed (attempt 1): version=3.1.0
```

```diff
   meteoswiss_mcp_server:
-    image: ghcr.io/eins78/meteoswiss-mcp:3.1.0-rc.0
+    image: ghcr.io/eins78/meteoswiss-mcp:3.1.0
```

First attempt, no 429, 6 sessions connected. The rate-limiter tolerance in `classify_health` /
`decide_health` has now survived two real PROD deploys without ever being *exercised* — neither
deploy produced a 429. It remains covered by `--self-test` only.

Both endpoints after the fact:

```
:21080  {"status":"ok","version":"3.1.0","sessions":26,"endpoint":"https://meteoswiss-mcp.ars.is/mcp"}
:22080  {"status":"ok","version":"3.1.0","sessions":0,"endpoint":"https://meteoswiss-mcp-demo-test.cloud.kiste.li/mcp"}
```

## 6. Verification on PROD

Same protocol as the RC run, and the same caveat applies in reverse: this verifies the **`3.1.0`
artifact**, not the fix. The *source* is `3.1.0-rc.0` plus a version bump and the consumed
changesets. The *image* is not: GHCR reports `sha256:13eb6524…` for `3.1.0` against
`sha256:c2d466b9…` for `3.1.0-rc.0`, because it was rebuilt from scratch. So a fresh verification is
exactly the right thing here — what it rules out is a bad build or a bad deploy, which is what it
was asked to rule out.

Preconditions checked, not assumed: the container recreate left `/tmp` empty
(`find /tmp -type f | wc -l` → `0`), and `docker inspect` confirmed `DEBUG=mcp:data` on the running
container, so a failure would have been logged.

```
=== wave 1 — cold cache, 8 concurrent sessions ===
  8001  ok  90589 ms  Zürich        6900  ok  92360 ms  Paradiso
  3011  ok  74881 ms  Bern          7000  ok  86960 ms  Chur
  1200  ok  47279 ms  Genève        9000  ok  78245 ms  St. Gallen
  4051  ok  81714 ms  Basel         2000  ok  73151 ms  Neuchâtel
  wall 92404 ms | failed 0/8 | ENOENT in payload 0

=== wave 2 — warm cache, same 8 locations ===
  wall 81343 ms | failed 0/8 | ENOENT in payload 0

16/16 forecast calls ok, 0 ENOENT in payloads
```

Server log for the window:

```
  ENOENT              0
  rename              0
  cache write failed  0
  Cached             51   = 8 writers × 6 forecast CSVs + 3 metadata
  Cache hit          53
```

Reading these logs correctly needs one thing kept in mind: **two different lines begin with
"Downloading"**. `[ogd-forecast] Downloading <param>…` is logged per *request*, before the disk
cache is consulted (96 = 16 calls × 6 params); `[ogd-store] Downloading (binary/Latin1) <url>` is
the actual HTTP fetch (51). The raw grep count of 147 conflates them and makes a fully warm cache
look like it re-downloaded everything.

So: **8 concurrent writers per cache key across 6 keys, 48 writes, 0 `ENOENT`, 0 failed cache
writes** — the third consecutive clean run of this, after TEST and PROD on the RC.

Content path:

```
search: ok in 45 ms, 10 distinct page URLs

sequential fetch of …/emissionsszenarien.html
  226 / 5 / 3 ms   bytes 6545   identical payloads true

4 concurrent first-time fetches of …/klimaszenarien-verstehen.html
  wall 162 ms   per-call 161 / 161 / 162 / 162 ms   identical payloads true
```

Warm forecast calls are still 38–82 s. Unchanged, expected, and the same reason as before: the disk
cache saves the download, never the parse.

## Still open

- [ ] **Forecast parse cost.** ~178 MB of CSV per request, parsed on a single-threaded event loop,
      38–82 s under 8-way concurrency. The largest remaining user-visible problem, and nothing in
      this release touched it.
- [ ] The `## 3.1.0-rc.0` changelog section duplicates `## 3.1.0` verbatim — collapse it if the
      noise matters.
- [ ] Exempt `/health` from the global rate limiter in `streamable-http.ts` (apply `limiter` to
      `/mcp` rather than `app.use(limiter)`), so a deploy health check cannot be rate-limited at all.
      The script's 429 tolerance has still never fired in a real deploy.
- [ ] `Promise.allSettled` in `ogd-local-forecast.ts` — still open in #145.
- [ ] `void cacheWriteBestEffort(...)` to take the write off the critical path, keeping `fsync`.
- [ ] The RC poller has been installed but has not yet deployed anything — the next genuinely new
      pre-release is its first real test.

## What shipped

| | |
|---|---|
| #153 | `ca0eb37` — exit changesets prerelease mode |
| #155 | `0d96ec3` — Version Packages → `3.1.0` |
| release | [`meteoswiss-mcp-v3.1.0`](https://github.com/eins78/meteoswiss-llm-tools/releases/tag/meteoswiss-mcp-v3.1.0) — npm `latest`, GHCR `3.1.0` + `latest` |
| TEST | `3.1.0`, healthy, deployment 6389417815 |
| PROD | `3.1.0`, healthy, deployment 6389424101 |
| docker-infra | `b36fbcf` — TEST to 3.1.0 |
| docker-infra | `4d8dd55` — PROD to 3.1.0 |
