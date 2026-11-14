# meteoswiss-forecast-evals

Eval suite measuring how well LLMs **understand** the JSON returned by `meteoswissLocalForecast`
— especially the new `precipitation.hourly` time-series added in
[PR #99](https://github.com/eins78/meteoswiss-llm-tools/pull/99). See
[`docs/spec.md`](./docs/spec.md) for the full design and methodology. This is a standalone
package: it does **not** depend on `meteoswiss-mcp`'s source, only on a static JSON sample
captured from it (see `fixtures/`).

In the repo's showcase framing, this package demonstrates **eval-driven interface design**: the
JSON an MCP tool returns is an interface for a language model, and its legibility can be measured
before shipping instead of assumed. This suite compares JSON *formats* across models —
it does **not** compare the agent skill against the MCP server; see
[docs/skill-vs-mcp.md](../../docs/skill-vs-mcp.md) for that (qualitative) comparison.

**The paid LLM evals are not run in CI** — they're a manual, on-demand suite you run when you're
about to change the forecast JSON shape, or periodically to catch regressions in legibility as
models change. The **offline scoring unit tests** (`pnpm test`) _do_ run in CI as a cheap
regression gate. See [CI policy](#ci-policy) below for the exact boundary.

**Not a pnpm workspace member.** This package has its own `pnpm-workspace.yaml` +
`pnpm-lock.yaml`, independent of the repo root's (see "Why this package isn't a workspace member"
below). Run `pnpm install` **inside this directory**, not from the repo root.

## The headline question

Does labeling hourly timestamps in **local time with a UTC offset** (what PR #99 ships,
e.g. `"2026-03-28T09:00:00+01:00"`) vs **UTC** (`"2026-03-28T08:00:00Z"`) change whether models
— especially the small/cheap ones real users actually run — can correctly answer real-world
local-time questions about the forecast. That result gates merging PR #99 / releasing the
hourly-precipitation feature to PROD.

**Answer, from a complete 13-provider sweep + judge slice — see the
[2026-07-09 results](./docs/results/2026-07-09-forecast-json-comprehension.md) "Full sweep
results, complete": keep local-time labeling. Do not switch to UTC.** The cleanest evidence
(`point-num`/`range-num` — exact-value lookups at a specific local hour) scores 100% local vs.
~0% UTC in every tier, every model tested (one single-row exception: `gpt-5.2` correctly converted
one UTC timestamp out of 13 — see that file's "Copilot review fixes" section — which doesn't
change the direction or the verdict).

## Quick start

```bash
cd packages/meteoswiss-forecast-evals   # this package is NOT installed by a root `pnpm install`
pnpm install                  # standalone install — own pnpm-lock.yaml, own node_modules
pnpm run generate            # builds generated/tests.json + generated/judge-tests.json from fixtures/
pnpm test                    # offline unit tests (ground truth + scorer), no network, no cost
pnpm run dryrun               # promptfoo's built-in `echo` provider — validates the whole
                              # pipeline (fixtures -> prompts -> scorer -> results file) for $0
pnpm run smoke                # ONE cheap model, real OpenRouter spend (~1-2 cents) — sanity
                              # check before committing to a full paid run
pnpm run eval                 # FULL programmatic sweep across all configured models (~$2-3)
pnpm run eval:judge            # small open-ended judge slice (~$1-2)
pnpm run summarize             # prints the gate table from the most recent generated/results.json
pnpm run view                  # opens promptfoo's local web UI over past runs
```

`pnpm run eval` / `smoke` / `eval:judge` all read the OpenRouter API key from the
`OPENROUTER_API_KEY` environment variable — **never hardcode or commit it**. Set it however you
like, or copy `.env.example` to `.env` (gitignored) and fill it in:

```bash
cp .env.example .env
# edit .env, set OPENROUTER_API_KEY=sk-or-... (get a key at https://openrouter.ai/keys)
```

`scripts/run.sh` sources `.env` automatically if present, and `promptfoo` itself also loads
`.env`. If `OPENROUTER_API_KEY` is still unset when a paid run starts, `run.sh` fails fast with
a message pointing back here.

## CI policy

Two clearly separated tiers — one runs in CI, one never does:

| Command | What it does | Cost | In CI? |
|---------|--------------|------|--------|
| `pnpm test` | **Offline scoring unit tests** — ground-truth + scorer, `node --test src/*.test.ts` | $0, no network, no keys | **Yes** — regression gate (`forecast-evals` job in `.github/workflows/pr-ci.yml`) |
| `pnpm eval` / `smoke` / `eval:judge` | **Paid LLM evals** — real OpenRouter model calls | Real money (~cents to ~$3), needs `OPENROUTER_API_KEY` | **Never** — local-dev-only |

- The **offline unit tests run in CI** so the ground-truth generator and scorer can't silently
  break. They make no network calls and need no secrets. Because this package is deliberately
  [not a workspace member](#why-this-package-isnt-a-workspace-member), they were previously
  uncovered by the repo-root CI; the dedicated `forecast-evals` job closes that gap.
- The **paid LLM evals must never run in CI.** They cost money and require `OPENROUTER_API_KEY`.
  Run them locally, on demand (see [Quick start](#quick-start)). Do not add them to any workflow,
  and do not put `OPENROUTER_API_KEY` in CI secrets for this package. This applies to the
  `mcp-vs-skills:*` commands below too — they are real OpenRouter spend, never CI.

## The MCP-vs-skills track

A second, independent track (`src/mcp-vs-skills/`) answers a different question: for
real-world weather Q&A, how do the two access methods this repo ships — the MCP server's
structured tools vs the `meteoswiss-ogd` skill's direct HTTP/bash approach — compare on
accuracy, tokens, and cost? Findings from the first run (2026-07-12): see
[`docs/results/2026-07-12-mcp-vs-skills.md`](./docs/results/2026-07-12-mcp-vs-skills.md).
That run had 12 questions; three area questions for `meteoswissWeatherSituation` (the share of
sunny points above 1500 m, fog over the Plateau, the wetter side of the Alps) came later and
have no run yet.

Unlike the fixture-based comprehension track above, this one runs **agentic loops against
live data**: custom promptfoo providers drive an OpenRouter tool-calling loop, where the
`mcp/*` providers talk to a locally started `meteoswiss-mcp` (real `tools/list` schemas,
real tool dispatch) and the `skill/*` providers get the SKILL.md body plus one guarded
`bash` tool (allowlisted read-only pipelines, MeteoSwiss-hosts-only URLs). Ground truth is
captured from the same live OGD data minutes before each run and scored with per-question
tolerances — see the results doc's Methodology section for the full story, including the
fairness rules and the budget guard (hard abort at `MCP_SKILLS_BUDGET_USD`, default $4).

```bash
pnpm run mcp-skills:smoke      # 1 model x both methods x 3 questions (~$0.05)
pnpm run mcp-skills:eval       # full sweep: 2 models x 2 methods x 17 questions (~$0.90; 12 questions cost ~$0.65)
pnpm run mcp-skills:summarize  # accuracy/token/cost tables from the last run
pnpm run mcp-skills:charts     # SVG charts into docs/results/<date>-mcp-vs-skills/
```

The runner starts the MCP server itself if none is listening (and reads the OpenRouter
key from the env, `.env`, or the macOS keychain item `openrouter-evals`). Results are
only comparable within one run — live data moves — so rows are never cached.

## The hourly symbol track (PR #183)

`src/symbol-cloud.ts` measures the five hourly fields PR #183 adds (`weather_code`, `weather`,
`cloud_low_pct`, `cloud_mid_pct`, `cloud_high_pct`): July's 14 multi-series questions plus 5 fog
and cloud questions, on the shipped shape vs the PR shape, at 1 and 5 days. Own tests file and
config (`generated/symbol-tests.json`, `promptfooconfig.symbol.yaml`), so `pnpm run eval` does not
grow. Results: [`docs/results/2026-11-11-hourly-symbol-cloud.md`](./docs/results/2026-11-11-hourly-symbol-cloud.md).

```bash
pnpm run symbol:dryrun         # echo provider, $0
pnpm run symbol:smoke          # gemini-3.1-flash-lite, 76 rows (~$0.19)
pnpm run symbol:eval           # 5 models x 4 arms (~$2.8; flash-lite rows come from the smoke's cache)
pnpm run symbol:eval:opus-1d   # opus-4.8 on the 1-day arms only (~$0.6)
pnpm run symbol:summarize generated/results-symbol.json generated/results-symbol-opus-1d.json
```

The opt-in follow-up (`detail: "sky"`) adds `pnpm run symbol:sky-recheck` (real tool output of
three checkouts, compared with `cmp`; header of `src/sky-recheck-fixtures.ts`) and
`pnpm run symbol:eval:tiny-5d-optin` (tiny tier on `main-5d`, `--no-cache`, ~$0.04).

## Reading the output

`pnpm run summarize` prints, in order:

1. **THE GATE** — tiny tier x `{local, utc}` on the primary (DST-spanning) fixture. This is
   the number that decides #99 / PROD.
2. Full tier x variant breakdown.
3. Question family x variant — tells you *what* is confusing (if anything), not just how much.
4. Secondary tracks: the 7-day longer-horizon fixture, and the multi-series mock (shape A vs
   shape B, a design input for the *next* feature — sunshine/wind time-series).
5. Estimated cost per provider (see the caveat below).

Pass `--rescore` (`pnpm run summarize -- --rescore [path]`) to recompute every row's grade from
its raw stored response using the *current* scorer instead of trusting what promptfoo graded at
run time — useful after a scorer bug fix, at zero additional API spend (see the
[2026-07-09 results](./docs/results/2026-07-09-forecast-json-comprehension.md) "Copilot review
fixes" for how this was used to reconcile the committed gate numbers after such a fix).

### Known limitation: promptfoo's own cost field is empty for OpenRouter

Confirmed empirically during the build smoke test: `promptfoo`'s `row.cost` comes back `0` for
every OpenRouter call, even though `tokenUsage` is populated correctly. `summarize.ts` computes
an estimated cost itself from `tokenUsage x` a hardcoded pricing table (checked against
`openrouter.ai/api/v1/models` when this suite was built). Cross-check the real total against
[OpenRouter's Activity page](https://openrouter.ai/activity) before trusting it hard against the
$10 ceiling, especially after OpenRouter re-prices any model.

## Publishing a results snapshot

`pnpm run view` (= `promptfoo view`) is a live, local-only browser over everything in your
`~/.promptfoo` database — great for interactive digging, but nothing is durable or shareable from
it. To turn a specific stored run into a permanent, shareable artifact:

```bash
promptfoo list evals                                    # find the eval id you want (check
                                                          # tokenUsage/numRequests to confirm it's
                                                          # the real run, not a dry-run/smoke test)
promptfoo export eval <evalId> -o generated/report.html # self-contained static snapshot
```

`generated/*.html` is gitignored scratch — exporting there does **not** publish anything.
**Publishing is a deliberate copy**, pairing the snapshot with its dated write-up:

```bash
cp generated/report.html docs/results/YYYY-MM-DD-<slug>.html   # same date-slug as the .md writeup
```

**This repo is public, and GitHub Pages serves the whole `/docs` folder from `main`** — committing
a snapshot to `docs/results/` publishes it at
`https://code.178.is/meteoswiss-llm-tools/results/YYYY-MM-DD-<slug>.html` (this account's Pages
custom domain — same site also resolves at the default `eins78.github.io/meteoswiss-llm-tools/`).
Treat `git commit` + merge to `main` as the publish action, not something that happens implicitly.
The snapshot export was checked to contain no API keys, hostnames, or other secrets before this
convention was adopted (provider config only carries model IDs/labels/generation params) —
re-check if a future provider integration changes what gets embedded in
`tokenUsage`/`vars`/`metadata`.

## Live viewer (persistent, Tailscale-only)

For interactive browsing of past runs without exporting anything, `promptfoo view` runs
persistently on `mac-zrh` as a launchd LaunchAgent — it survives reboots/sleep and restarts on
crash, and is exposed **only on the tailnet** (never the public internet) via `tailscale serve`.

`promptfoo view` has no host option and no authentication, and by default it listens on every
network interface. `scripts/start-viewer.sh` therefore loads `scripts/loopback-listen.cjs`
(`NODE_OPTIONS=--require`), which pins the listener to `127.0.0.1`; nothing on the local network
can reach it. The tailnet reaches it only through the `tailscale serve` mapping below.

- **Source of truth**: `scripts/start-viewer.sh` (starts the viewer on 127.0.0.1 via
  `scripts/loopback-listen.cjs`) + `scripts/li.kiste.meteoswiss-evals-viewer.plist` (launchd unit). The live
  `~/Library/LaunchAgents/` entry is a **symlink** to the plist in this checkout — edit the repo
  file, then bootout/bootstrap to reload, per this workspace's launchd convention.
- **Install** (from a `mac-zrh` checkout of this repo):
  ```bash
  ln -s "$(pwd)/packages/meteoswiss-forecast-evals/scripts/li.kiste.meteoswiss-evals-viewer.plist" \
        ~/Library/LaunchAgents/li.kiste.meteoswiss-evals-viewer.plist
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/li.kiste.meteoswiss-evals-viewer.plist
  ```
- **Tailnet mapping** (one-time; the script does not manage it). `tailscale serve` is denied to a
  non-operator user, so make your user the operator first, then create the mapping. tailscaled
  stores it and restores it after reboots and viewer restarts:
  ```bash
  sudo tailscale set --operator="$USER"
  tailscale serve --bg --https=15500 http://127.0.0.1:15500
  tailscale serve status
  ```
- **Check the bind**: the listener must be on `127.0.0.1`, not `*`. Tailscale holds separate
  listeners on the tailnet addresses, which is expected:
  ```bash
  netstat -anv -p tcp | grep '\.15500 '
  ```
- **Verify**: `launchctl print gui/$(id -u)/li.kiste.meteoswiss-evals-viewer | grep -E 'runs|last exit'`
  (liveness — ask launchd, not the log). Logs (events only, not heartbeats):
  `~/Library/Logs/meteoswiss-evals-viewer.log`.
- **Reload after editing** `start-viewer.sh`, `loopback-listen.cjs` or the plist:
  ```bash
  launchctl bootout   gui/$(id -u) ~/Library/LaunchAgents/li.kiste.meteoswiss-evals-viewer.plist
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/li.kiste.meteoswiss-evals-viewer.plist
  ```
- **URL** (tailnet-only — reachable from any device on the same Tailscale network, e.g. phone/iPad):
  `https://mac-zrh.siren-trout.ts.net:15500/`

## Package layout

```
fixtures/         committed, static, captured-or-hand-authored JSON samples
generated/        committed prompts/expected-answers; gitignored run outputs (results*.json, *.html)
docs/results/     published, dated findings (.md) + optional static run snapshots (.html)
src/              fixture/ground-truth/question generation, scorer, summarize — see docs/spec.md
scripts/          run.sh (wraps `promptfoo eval`), synth-7day-fixture.ts,
                  start-viewer.sh + loopback-listen.cjs + li.kiste.meteoswiss-evals-viewer.plist
                  (persistent viewer, see "Live viewer" above)
promptfooconfig.yaml         programmatic (lookup) slice — the primary eval
promptfooconfig.judge.yaml   open-ended, Opus-judged slice — secondary quality check
pnpm-workspace.yaml, pnpm-lock.yaml   this package's own, independent pnpm project
```

Full annotated layout, including what each `src/` file does and why every `.ts` file here runs
with no build step: [`docs/spec.md`](./docs/spec.md) "Package layout".

## Extending this suite

- **New question**: add it to `src/questions.ts` (or `src/multiseries.ts` for the secondary
  track), computing `expected` from `src/ground-truth.ts` — never hand-type an expected value.
- **New fixture**: capture real tool output the way `fixtures/forecast-8001-2day-local.json`
  was captured (see [`docs/spec.md`](./docs/spec.md) "Fixture & the two variants" for the exact
  gotcha to avoid), or follow `scripts/synth-7day-fixture.ts`'s pattern for a synthesized one
  (deterministic, no `Math.random`/`Date.now`, documented provenance in a header comment).
- **New model**: add a provider block to `promptfooconfig.yaml`, following the existing
  `tier/short-name` label convention — `summarize.ts` derives the tier from that prefix.
- **New run**: any rerun's dated findings go in a new file under `docs/results/`
  (`YYYY-MM-DD-<slug>.md`) — see [`docs/spec.md`](./docs/spec.md) for why results files are
  immutable and dated rather than one file that gets rewritten. Optionally pair it with a static
  HTML snapshot of the same run (`YYYY-MM-DD-<slug>.html`) — see "Publishing a results snapshot"
  above.

## Why plain TypeScript, no `.mjs`/`.cjs`

promptfoo's docs recommend pre-transpiling assertion files, but that turned out to be just a
recommendation — promptfoo does a plain dynamic `import()` on whatever path it's given, and this
repo's pinned Node version already resolves `.ts` natively. Full investigation, including how
this was verified empirically rather than taken on faith:
[`docs/spec.md`](./docs/spec.md) "Q-A: why plain TypeScript, not `.mjs`/`.cjs`".

## Why this package isn't a workspace member

`promptfoo` is large; declaring it as a normal `devDependency` would install its full transitive
tree for every contributor on a root `pnpm install`. This package instead excludes itself from
the root workspace glob and defines its own nested `pnpm-workspace.yaml`, giving it a real,
integrity-hashed lockfile that only installs when you `cd` in — after several other pnpm
mechanisms were investigated and ruled out. Trade-off: no longer covered by `pnpm -r lint/build/
test` at the repo root; verify standalone instead. Full investigation, with sources:
[`docs/spec.md`](./docs/spec.md) "Q-B (revisited)".
