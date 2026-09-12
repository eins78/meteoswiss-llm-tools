# 2026-04-18 — Plot-idea: geocoding workarounds review

## What happened

Filed draft PR #82 via `/plot-idea` to review the six geocoding workarounds that landed in rc.3 → rc.4. No code changes; review plan only.

- **Branch:** `idea/geocoding-workarounds-review`
- **Plan:** `docs/plans/2026-04-18-geocoding-workarounds-review.md`
- **Active symlink:** `docs/plans/active/geocoding-workarounds-review.md`
- **PR:** <https://github.com/eins78/meteoswiss-llm-tools/pull/82> (draft)

## What the plan says

Six workarounds, ~190 LOC, all landed on 2026-04-18 across three commits (`f0e3f28`, `da130ac`, `de9c937`). Grouped by root cause:

- **Group A — swisstopo overmatch** (1, 2, 5): blocklist, name-match guard, origin restriction — three angles on the same underlying issue (swisstopo fuzzy-matches to Swiss coordinates for non-Swiss or nonsensical input).
- **Group B — shape-dependent strategy** (3, 4): query classifier + postal-prefix fallback.
- **Group C — orthogonal** (6): `fetch` URL-param revert.

Key finding: **duplication smell** — `geocodedNameMatchesQuery` is duplicated verbatim in both `ogd-station-resolver.ts` and `ogd-smn-stations.ts`. Both resolvers each call the blocklist and the classifier separately. Architectural tell that a shared pipeline would dedupe 4 of the 5 non-orthogonal workarounds.

Four options in the plan:

- A — leave as-is (works; duplication compounds)
- B — extract shared geocode pipeline with explicit stages (**tentative recommendation**, low priority)
- C — swap swisstopo for a stricter geocoder (root-cause attack; probably not worth it)
- D — harden tool descriptions so the model self-filters upstream (complementary to A or B)

Decision is open — belongs in PR discussion.

## Method notes

- Dispatched 3 Explore agents in parallel (workaround code map, failure-case history, repo conventions) — rich context in ~3 min.
- Plan file follows repo conventions: `# Plan: Title` + blockquote summary, no frontmatter, file:line refs, Status/Motivation/Design/Branches/Notes sections, "Non-goals" section included.
- Type chosen: `docs` — this plan is documentation; whichever option gets picked becomes a separate plan of its own type (`infra` for B, `docs` for D).
- Didn't coordinate-ping the parallel release delegate; `origin/main` was unchanged from my branch point.

## Next

- Mark ready for review when Max has had a chance to read: `gh pr ready 82`.
- After discussion, run `/plot-approve geocoding-workarounds-review` and land the chosen option on its own branch.
