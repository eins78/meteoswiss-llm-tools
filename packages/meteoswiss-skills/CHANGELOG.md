# meteoswiss-skills

## 1.1.1 - 2026-11-13

### Patch Changes

- f3aac54: The skill no longer calls the weather pictogram `jww003i0` 3-hourly: it has one value per hour. It also lists the cloud cover parameters `nprolohs`, `npromths` and `nprohihs`.

## 1.1.0 - 2026-07-18

### Minor Changes

- fbb1904: Add climate data (NBCN) coverage to the `meteoswiss-ogd` skill: a new "Get Climate Data" section in SKILL.md with a live-verified curl workflow for the homogeneous climate series (yearly/monthly/daily), a Climate Parameters table in REFERENCE.md, and the `ch.meteoschweiz.ogd-nbcn-precip` collection in the STAC table. Closes the long-standing gap where the MCP server's `meteoswissClimateData` tool had no skill counterpart — the first gap caught (deliberately, red-first) by the new skills↔MCP parity lint.

### Patch Changes

- 57ce753: Fix forecast STAC item selection to skip items whose assets are not yet uploaded. A brand-new
  daily item can exist with zero assets (observed just after midnight), and the previous
  "latest by id" logic in `forecast.sh` and the SKILL.md example then returned `no_data` for
  every parameter. Found by the new MCP-vs-skills eval track.
- a6eaccf: Skill correctness fixes from the 2026-07-11 review:
  - Fix the pollen example: `pollen.sh ZUE` was an invalid station (404); Zurich's pollen station is `PZH` (SKILL-1). Reconcile the pollen station count to 16 everywhere.
  - Fix a broken exit-code idiom in all five bundled scripts: `--help`/`-h` now exits 0 and a missing required argument exits 1 (previously `exit "${VAR:+1}"` made `--help` exit 1 and no-args exit 2 with a `numeric argument required` error) — SKILL-2.
  - Make `pnpm install` side-effect-free: the global skill install moved from `postinstall` (which ran on every root install, mutating the developer's global agent config) to an explicit `pnpm run install-skill` (SKILL-3).

- ee27745: Document the new hourly forecast parameters (sunshine `sre000h0`, wind speed `fu3010h0`, wind gust `fu3010h1`) alongside the existing temperature/precipitation ones, and note that every point type — including weather stations, not just postal codes/mountains — now has hourly params available. Updates `REFERENCE.md`'s parameter table, `SKILL.md`'s forecast guidance, and the bundled `forecast.sh` script's fetched parameter set, keeping this package in sync with `meteoswiss-mcp`'s hourly multi-series forecast (see that package's changeset).

## 1.0.0

### Patch Changes

- 0ba372a: Add weather icon SVG URLs to forecast responses. Each daily forecast now includes a `weather_icon_url` field linking to the official MeteoSwiss SVG pictogram. The skill documentation is updated with the URL pattern.
