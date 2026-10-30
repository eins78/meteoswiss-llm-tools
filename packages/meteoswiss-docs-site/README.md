# meteoswiss-docs-site

Astro + Starlight static site, published to GitHub Pages at https://code.178.is/meteoswiss-llm-tools/.
It is the public documentation for the repo, in four sections: **Use it** (`user/`), **Run it** (`operator/`),
**Build on it** (`development/`) and **Evaluations** (the skill-vs-MCP case study and the promptfoo eval runs).
See [`docs/plans/2026-10-30-public-docs-site.md`](../../docs/plans/2026-10-30-public-docs-site.md) for the 2026-10-30
decision to widen the site (it was runs-only after the 2026-07-18 re-scope; original design in
[`docs/plans/2026-07-11-pages-starlight-implementation-plan.md`](../../docs/plans/2026-07-11-pages-starlight-implementation-plan.md)).
This site does **not** publish plans, sessionlogs, research, test reports or any other internal/process docs —
that's deliberate, not an oversight.

Standalone project (own `pnpm-workspace.yaml`, excluded from the monorepo's root install —
same pattern as `meteoswiss-forecast-evals`, see the root `pnpm-workspace.yaml` comment).

## Content sources

This package's own hand-authored content is the homepage (`src/content/docs/index.mdx`), the
`user/`, `operator/` and `development/` pages, the `evaluations/index.mdx` landing page, and a
directory of editorial stubs (`editorial/<run-slug>.md`, one per eval run — a required `teaser`
field plus light "what this tests / how to read it" prose). Everything else is assembled at
build time by `scripts/sync-content.ts`:

- `packages/meteoswiss-forecast-evals/docs/results/*.md` (the run write-ups) →
  `src/content/docs/runs/` (public URL: `/runs/<slug>/` — a deliberate, final choice since this
  site is linked to publicly; do not rename without checking with Max first, it breaks every
  external link already handed out), each with its paired `editorial/<slug>.md` content injected
  right after the frontmatter. **A run without a paired editorial stub is skipped entirely** —
  not published without the explanatory framing.
- `packages/meteoswiss-forecast-evals/docs/results/*.html` (the promptfoo static snapshots) →
  `public/forecast-evals-results/`, served byte-for-byte, outside the content-collection
  pipeline, linked inline from the matching run page.
- `docs/skill-vs-mcp.md` → `src/content/docs/evaluations/skill-vs-mcp.md` (relative links rewritten:
  to this site's run pages where they point at eval results, to GitHub blob URLs otherwise).
- `src/data/runs.generated.json` — a `{slug, title, teaser, href}` manifest of every published
  run, imported by the homepage to render its teaser list.

The sync script is idempotent and destructive on its own output — it clears
`src/content/docs/runs/`, `src/content/docs/evaluations/skill-vs-mcp.md` and `public/forecast-evals-results/`
before every run (the hand-authored sections are untouched). Never hand-edit synced files; edit the source in
`packages/meteoswiss-forecast-evals/docs/results/` or this package's `editorial/` instead.

## Commands

Run from this directory:

```bash
pnpm install
pnpm run dev       # sync content + start dev server at localhost:4321
pnpm run build     # sync content + build production site to ./dist/
pnpm run preview   # preview a production build locally
```

## Deploy

Published via GitHub Actions to GitHub Pages on push to `main` — see
[`../../.github/workflows/pages.yml`](../../.github/workflows/pages.yml) (repo root, not this
package).
