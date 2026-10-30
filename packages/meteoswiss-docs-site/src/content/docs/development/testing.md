---
title: Testing and evals
description: How the MeteoSwiss MCP server is tested, how fixtures work, and how the LLM eval suites are run.
---

## Setup

```bash
git clone https://github.com/eins78/meteoswiss-llm-tools.git
cd meteoswiss-llm-tools
pnpm install
```

Run package commands from `packages/meteoswiss-mcp/`, or from the root with `pnpm --filter meteoswiss-mcp <script>`.

| Command | What it does |
|---------|--------------|
| `pnpm run dev` | Start with hot reloading |
| `pnpm run dev:inspect` | Open the server in the MCP Inspector |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:integration` | Integration tests (an in-process server and MCP client, with fixtures) |
| `pnpm run lint` | TypeScript, ESLint and the skills-parity check |
| `pnpm run fix` | Auto-fix formatting and lint errors |
| `pnpm run ci` | Lint, build and test: what CI runs |

## Test layers

- **Unit tests** (`test/unit/`) cover the cache, parser, resolver, URL canonicalisation, error-log sanitising and similar.
- **Integration tests** (`test/integration/`) call every tool through a real MCP client and server, including ChatGPT-compatibility checks for
  `search` and `fetch`.
- **Parity test** keeps the server's tools and the skill's coverage markers in sync.

## Fixtures

`USE_TEST_FIXTURES=true` serves bundled CSV fixtures from `test/__fixtures__/` instead of calling MeteoSwiss, so tests are fast and need no
network. The fixture resolver **fails fast**: a URL that has no fixture throws, it never falls through to the live network.

When adding a new data parameter:

1. Add it to the allowlist in `resolveFixturePath` (`src/data/ogd-data-store.ts`).
2. Add a fixture CSV under `test/__fixtures__/ogd/`.
3. Add assertions for the new field.

## Writing tests

- Assert **content**, not just structure: `Array.isArray(result)` passes for an array of nulls.
- Never use conditional assertions (`if (value) expect(value)…`); they pass silently on exactly the failure they should catch.
- Production code avoids `!`, `as` and `any`; test code may use them where it makes the test clearer.

## CI

Every pull request must pass:

| Check | Covers |
|-------|--------|
| Lint, Build & Test | TypeScript, ESLint, parity, unit and integration tests |
| Security & Dependency Check | Vulnerability scanning |
| Docker Build Test | The image builds and the container starts |
| Skill Validation | Skill package structure and parity |
| Forecast Evals scoring tests | The offline scoring unit tests of the eval suite (no API calls) |

## LLM evals

`packages/meteoswiss-forecast-evals` uses [promptfoo](https://promptfoo.dev/) to measure how well language models use the tool output:

- **Forecast-JSON comprehension**: does the shape of the forecast JSON let models answer questions correctly? It settled the local-time
  decision.
- **MCP vs. skills**: the same tasks answered through each approach.

Finished runs are published, with commentary, under [Evaluations](../../evaluations/). A run costs real money, since it calls hosted models, so
it is run by hand and never in CI.
