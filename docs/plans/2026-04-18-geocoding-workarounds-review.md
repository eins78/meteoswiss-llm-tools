# Plan: Geocoding workarounds review

> Review the six geocoding workarounds that landed in rc.3 → rc.4 — inventory them, group by root cause, and weigh four options for a cleaner path. No implementation in this plan.

## Status

- **Phase:** Draft
- **Type:** docs
- **Sprint:** —

## Changelog

- (no user-facing change — this plan is a review document; the chosen option will land under its own plan)

## Motivation

Between rc.2 and rc.4, the geocoding path in `meteoswiss-mcp` accumulated six distinct workarounds in three same-day commits on 2026-04-18. Each layer fixed a real bug surfaced by E2E testing, but the cascade pattern — layer N exposing the failure that layer N+1 plugs — is worth examining before adding more. Three questions:

1. Are these truly independent defenses, or symptoms of a single deeper issue?
2. Is the duplication between the two station resolvers a tax we should pay, or a refactor trigger?
3. What's the cheapest path to make the *next* failure case a targeted addition instead of another patch?

This plan catalogues what's there, groups by root cause, and presents four options for Max to decide between. It does not change any code.

Ancestry: this work evolved from [`2026-03-28-geocoding-fallback.md`](./2026-03-28-geocoding-fallback.md) (the original geocoding feature plan). That plan landed clean; the workarounds here are everything that was added on top of it since.

## Design

### Findings: workarounds inventory

Six workarounds, ~190 LOC total, across 5 files. All are active on `main`.

| # | Workaround | Location | LOC | When it runs |
|---|---|---|---|---|
| 1 | International-city blocklist | `packages/meteoswiss-mcp/src/support/location-blocklist.ts` + call sites in `ogd-station-resolver.ts:132` and `ogd-smn-stations.ts:187` | ~60 | Pre-lookup, global |
| 2 | `geocodedNameMatchesQuery` (NOTASTATION guard) | `ogd-station-resolver.ts:96-111` *and* `ogd-smn-stations.ts:145-160` (duplicated verbatim) | ~32 (16×2) | Post-geocoding, all query shapes |
| 3 | Query classifier | `packages/meteoswiss-mcp/src/support/query-classifier.ts` | ~33 | Routes query to origin preset |
| 4 | Postal-code prefix fallback (`findPostalCodeNeighbour`) | `ogd-station-resolver.ts:146-161` + `:259-281` | ~39 | Only `postal_code` queries; station resolver only (NOT SMN) |
| 5 | swisstopo origin restriction | `packages/meteoswiss-mcp/src/support/geocode.ts:44-77` | ~34 | Shape-dependent (`place` / `address` / `all`) |
| 6 | `fetch` URL-param revert | `packages/meteoswiss-mcp/src/schemas/meteoswiss-fetch.ts:6-12` | <10 | Orthogonal schema change |

Commits (chronological, all 2026-04-18):

- `f0e3f28` — 14:40:12 UTC — Origin restriction + classifier (workarounds 3, 5 land)
- `da130ac` — 14:40:27 UTC — Wire classifier into resolvers + postal prefix (workarounds 3, 4, 5 wired)
- `de9c937` — 17:08:02 UTC — Blocklist + NOTASTATION guard + fetch revert (workarounds 1, 2, 6 land)

### Findings: concrete failure case per workaround

1. **Blocklist:** Query `"Paris"` → Payerne. swisstopo's `gg25` layer contains a legitimate Swiss hamlet named "Paris, VD" (~100 residents, near Payerne). The `origins='place'` restriction added in workaround 5 correctly blocks *Paris, France* but still returns *Paris, VD*. Bbox check never fires because the result IS inside the Swiss bbox. Similar: Tokyo, Moscow, Beijing all have tiny Swiss namesakes or fuzzy-match collisions.
2. **NOTASTATION guard:** Query `"NOTASTATION"` → CHA (Chasseral). Live swisstopo fuzzy-matches gibberish to *some* Swiss coordinate; the resolver then finds the nearest station to that noise-coordinate. Same class: `"ZZZZZZ"`, `"1234567890"`, `"ABCDE"`. The guard rejects the hit when no ≥3-char token of the query appears in the geocoded name.
3. **Query classifier:** One-size-fits-all geocoding gave wrong coverage for different query shapes. `"Bahnhofplatz 1 Bern"` needs `origins=all` (to include street addresses); `"Zürich"` needs `origins=place` (to exclude Swiss street labels that happen to share foreign city names).
4. **Postal-prefix fallback:** Query `"1200"` (Geneva) → Cousset (46.82°N). MeteoSwiss's `ogd-local-forecasting_meta_point.csv` only lists per-grid-point postal codes, not round-number parents (1200, 3000). Exact lookup misses; the old geocoding fallback returned whichever village swisstopo matched first. Fix: find the numerically closest indexed neighbour sharing the 3- or 2-digit prefix (1200 → 1201 Genève, 3000 → 3001 Bern).
5. **Origin restriction:** rc.2 design assumed swisstopo would return non-Swiss coords for non-Swiss queries, so a bbox gate would suffice. Reality: swisstopo happily matches international names against Swiss `address` or `gazetteer` labels — the bbox check never fired. Fix: restrict `origins` at the URL-builder level.
6. **Fetch URL-param revert:** rc.3 incidentally renamed the `fetch` tool schema parameter from `url` to `id` during a description update. Broke the contract for a field that holds a full URL. Reverted to `url` in rc.4. Orthogonal to the geocoding work; included only because it shared the same commit.

Evidence: `docs/sessionlogs/2026-04-18-b2-location-resolver-completion.md` narrates 1, 3, 4, 5; `docs/sessionlogs/2026-04-18-rc4-e2e-verification.md` narrates 1, 2, 6.

### Architectural critique

**Root-cause grouping.** The six don't split evenly into "problems"; they split into three root-cause groups:

- **Group A — swisstopo overmatch** (workarounds 1, 2, 5). swisstopo's fuzzy-match semantics produce Swiss coordinates even for clearly non-Swiss or nonsensical inputs. Each workaround in this group is a different angle on the same root cause: filter the input (blocklist), filter the output (name-match guard), narrow the search space (origin restriction). None alone is sufficient for all cases — blocklist handles Paris-VD, origin restriction handles address-vs-place confusion, name-match handles gibberish.
- **Group B — shape-dependent strategy** (workarounds 3, 4). The right lookup genuinely depends on what kind of input came in. The classifier is the router; the postal prefix is shape-specific fallback logic.
- **Group C — orthogonal** (workaround 6). Schema revert. Only bundled here by calendar, not by topic. The review should note it and set it aside.

**Duplication smell.** Workaround 2 (`geocodedNameMatchesQuery`) is duplicated *verbatim* in `ogd-station-resolver.ts:96-111` and `ogd-smn-stations.ts:145-160`. The blocklist check is called from both. The classifier is called from both. We have two parallel resolvers each carrying their own defensive wiring — that's the architectural tell that a shared pipeline stage would dedupe 4 of the 5 non-orthogonal workarounds.

**Cascade pattern.** These three commits didn't land as a designed set. They landed as a cascade — each one exposed what the previous was missing. `f0e3f28` restricted origins; `da130ac` wired the classifier; testing then surfaced Paris-VD (needed blocklist) and NOTASTATION (needed name guard), which arrived together in `de9c937` three hours later. That pattern strongly suggests there's a *next* failure case the current stack won't catch. Making that next one a one-line addition to an explicit pipeline stage is the payoff of Option B below.

### Options

**Option A — Leave as-is.**

- Steelman: It works. rc.4 E2E verified (see `2026-04-18-rc4-e2e-verification.md`). ~190 LOC of defensive code is cheap in absolute terms. The six failure modes are covered by six specific defenses — there's a clear mapping from symptom to code site.
- Critique: Duplication between the two resolvers will keep compounding every time a new defense is needed (we'd add to both). No single place to trace "why did query X resolve to point Y?". Future contributors must understand a cascade that was discovered, not designed.

**Option B — Extract a shared geocode pipeline with explicit stages.**

- Shape: one `resolveSwissLocation(query, { kind })` function with named stages:
  `classify → guard-input (blocklist) → geocode-with-origins → guard-output (name-match) → match-station`.
  Both `ogd-station-resolver.ts` and `ogd-smn-stations.ts` call it; the postal-prefix fallback plugs into the `match-station` stage as a `kind='forecast'` specialization.
- Steelman: Deduplicates `geocodedNameMatchesQuery` and the blocklist call site. Makes the order of defenses explicit and per-stage testable. A new failure case becomes "add logic to stage X" instead of "add another layer to two resolvers."
- Critique: Refactor cost is real — rough sizing ~1-2 days, dominated by making sure rc.4 behavior doesn't regress. The integration tests (`test/integration/ogd-current-weather.test.ts`, `ogd-local-forecast.test.ts` — Paris, London, Berlin, NOTASTATION cases) are the safety net, and they're good. Risk is low but not zero.

**Option C — Replace swisstopo with a stricter geocoder.**

- Shape: stop compensating for swisstopo's overmatch; use a geocoder that returns empty for non-Swiss queries. Would eliminate workarounds 1, 2, 5 entirely.
- Steelman: Attacks the root cause of Group A directly. One fewer abstraction (no origin restriction, no blocklist, no name-match guard).
- Critique: No obvious Swiss-only geocoder under our control. swisstopo IS the official public option — that's why we chose it originally. Third-party alternatives (Nominatim with CH bbox, Pelias) trade one overmatch problem for a new set: correctness on lesser-known Swiss place names, availability SLA, rate limits, legal/privacy of routing user queries to a third party. Probably not worth it. But this option exists and deserves explicit rejection rather than silent dismissal.

**Option D — Push filtering into the MCP tool description.**

- Shape: make the tool descriptions for `meteoswissCurrentWeather`, `meteoswissLocalForecast`, `meteoswissStations` explicitly state "Swiss locations only; queries outside Switzerland return an error." Trust the model to self-filter upstream.
- Steelman: Most of the Paris/Berlin/Tokyo failures are the model asking for weather in a non-Swiss city when the user obviously means the non-Swiss one. A clearer contract at the tool boundary eliminates that class without code. Zero runtime cost. Improves the tool's self-documentation too.
- Critique: Model reliability as a correctness gate is fragile — Opus 4.7 today isn't Opus 4.5 from last year, and we'd be coupling correctness to a model's adherence to tool descriptions. Doesn't address NOTASTATION (gibberish input, not a model choice) or postal-prefix fallback (legitimate Swiss input). Complementary to A or B, not a replacement.

### Tentative recommendation

**Option B, at low priority.** The cascade pattern is the strongest signal: we've shipped three layers in three hours and the structure says a fourth is coming. Extracting the pipeline once makes the next failure case a 10-line addition to a named stage instead of another parallel layer bolted onto two resolvers. But not urgent — rc.4 ships cleanly and the E2E suite pins the current behavior.

Open for discussion — the decision belongs in the PR thread, not this plan.

### Open Questions

- [ ] Is Option B's cost sizing (~1-2 days) realistic given the test coverage we have? Spot-checking `test/integration/ogd-current-weather.test.ts` suggests yes, but worth verifying before committing.
- [ ] Should workaround 6 (fetch URL-param revert) be extracted from this review — it's genuinely orthogonal and including it muddies the critique?
- [ ] Any seventh workaround I missed? Grep turned up only the six listed, but diacritic normalization and substring matching in the station resolver are adjacent pre-existing utilities worth an honest eye.

### Non-goals

- No implementation in this plan. Whichever option is chosen becomes a separate plan.
- No changes to rc.4 or the 2.3.0 release. Parallel session owns that.
- No changes to resolver code — not even formatting.
- Not a complete audit of all resolver logic; the six are representative of the workaround pattern. Pre-existing resolver utilities (diacritic normalization, substring matching, fuzzy name matching) are out of scope — they weren't added as workarounds.

## Branches

- `idea/geocoding-workarounds-review` — this branch, plan only
- Follow-ups (to be created when an option is chosen):
  - If Option B: `infra/geocode-pipeline-extract`
  - If Option D: `docs/geocoding-tool-description-hardening`

## Notes

### Critical file references

- `packages/meteoswiss-mcp/src/support/location-blocklist.ts`
- `packages/meteoswiss-mcp/src/support/query-classifier.ts`
- `packages/meteoswiss-mcp/src/support/geocode.ts:44-77`
- `packages/meteoswiss-mcp/src/resolvers/ogd-station-resolver.ts:96-111,132,146-161,259-281`
- `packages/meteoswiss-mcp/src/resolvers/ogd-smn-stations.ts:145-160,187`
- `packages/meteoswiss-mcp/src/schemas/meteoswiss-fetch.ts:6-12`

### Source commits

- `f0e3f28` — geocode: restrict swisstopo origins via option + add query classifier
- `da130ac` — resolvers: restrict geocoding by query shape + postal-code prefix fallback
- `de9c937` — Fix international city blocklist, NOTASTATION geocoding guard, fetch url param

### Related sessionlogs

- `docs/sessionlogs/2026-04-18-b2-location-resolver-completion.md`
- `docs/sessionlogs/2026-04-18-rc4-e2e-verification.md`

### Related plans

- `docs/plans/2026-03-28-geocoding-fallback.md` — the original geocoding feature plan (ancestor of this review)
