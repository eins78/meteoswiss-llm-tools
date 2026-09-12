# Changesets pre-release research (PR #117 grounding)

**Date:** 2026-07-16
**Source:** Claude Code (Opus 4.8, plan-mode + dossier skill)
**Session:** Single-session research task, no compaction

## Summary
Researched how `@changesets/cli` handles pre-releases (pre mode vs. snapshot releases vs. manual approaches), documented best practices and pitfalls, and produced a copy-pasteable, empirically-verified walkthrough for cutting an `-rc.1` release grounded in this repo's actual `.changeset/config.json`, release workflows, and the open "Version Packages" PR ([#117](https://github.com/eins78/meteoswiss-llm-tools/pull/117)). No product code changed — this is a research-only deliverable.

## Key Accomplishments
- Read the repo's actual release wiring: `.changeset/config.json`, root/package `package.json`s, `pnpm-workspace.yaml`, and all three relevant workflows (`version-packages.yml`, `release.yml`, `release-skill.yml`), plus PR #117's real diff via `gh pr view`.
- Fetched and cited the official changesets docs (`docs/prereleases.md`, `docs/snapshot-releases.md`), the `PreState`/`pre.json` reference, `changesets/action`, and a real-world CI writeup (Apollo Client's automated release pipeline) for the branch-isolated-`pre.json` pattern.
- **Empirically verified** the exact version outputs in this worktree rather than inferring them: ran `pnpm changeset pre enter rc && pnpm run version`, confirmed `meteoswiss-mcp: 2.3.2 → 3.0.0-rc.0` and `meteoswiss-skills: 1.0.0 → 1.1.0-rc.0`, observed that `.changeset/*.md` files are **not** deleted while pre mode is active (they're tracked in `pre.json`'s `changesets[]` array instead — a detail not obvious from the docs alone), then fully reverted the dry-run.
- Delivered `docs/research/2026-07-16-changesets-prereleases.md`: Key Facts, Glossary, three sections (mechanisms / best-practices+pitfalls / repo-specific walkthrough), and a fully cited §Sources — passed the dossier skill's review checklist (citation integrity, dated-claim freshness, section ordering, Key Facts accuracy).

## Decisions
- **Recommended CI-native path for #117**: commit only `.changeset/pre.json` to `main`, let `changesets/action` regenerate PR #117 in place with `-rc.0` suffixes, merge, then publish via `gh release create` (this repo's actual publish trigger — `release.yml` is already prerelease-aware, publishing `npm --tag next` and skipping Docker `:latest`). Rejected recommending `changeset publish` directly — nothing in this repo's CI ever calls it.
- **Recommended on-`main` pre mode over Apollo's branch-isolated pattern**, given this repo's solo-maintainer, single-branch cadence — but stated the accidental-stable-release-lockout risk explicitly (§3.5) rather than silently picking a side.
- **Did not recommend snapshot releases** for this repo's workflow: nothing in `.github/workflows/` runs `changeset publish`, so adopting snapshots would require building a net-new publish workflow from scratch — out of scope for "how to cut an rc from #117."
- Matched the repo's existing `docs/research/` flat-file convention (dated-slug filename, no nested folder) rather than the dossier skill's default `research/YYYY-MM-DD-slug/` folder structure, since an established repo convention already existed.

## Verification
- All 5 external citation URLs spot-checked with `curl -I` — all 200.
- All 8 relative repo-file links in §3.0 verified to resolve on disk.
- Internal `§3` anchor link verified against GitHub's anchor-generation algorithm.
- `git status` confirmed clean (no stray `pre.json`, no version-bump diffs) after the empirical dry-run revert, before writing the report.
- One malformed reference-link (accidental self-memory-path citation) caught and fixed during the citation-integrity pass.

## Next Steps
- Max reviews the draft PR and decides whether/when to actually cut an RC of `meteoswiss-mcp@3.0.0` following §3 of the report.
- No further action needed from the agent — do not merge (standing "Max merges, never the agent" policy).
