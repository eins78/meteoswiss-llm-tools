# Documentation

Public documentation for [meteoswiss-llm-tools](../README.md).

## Start here

- **[Skill vs. MCP Server](skill-vs-mcp.md)** — the case study at the heart of this repo: the same MeteoSwiss data access implemented as an agent skill and as an MCP server, compared honestly.
- **[Eval results: forecast JSON comprehension](../packages/meteoswiss-forecast-evals/docs/results/2026-07-09-forecast-json-comprehension.md)** — how measuring LLM legibility of tool output settled a real design decision (local-time vs. UTC timestamps).
- **[Documentation site](https://code.178.is/meteoswiss-llm-tools/)** — user docs (connect, every tool, limits), operator docs (Docker, configuration, monitoring) and development docs. Source: [`packages/meteoswiss-docs-site`](../packages/meteoswiss-docs-site/).
- **[MCP server package docs](../packages/meteoswiss-mcp/docs/)** — debugging notes and the one-time publishing setup.
- **[Eval suite design](../packages/meteoswiss-forecast-evals/docs/spec.md)** — methodology behind the eval package.

## Working notes

The subdirectories here are internal working documents, kept in the repo for provenance rather than polished for reading:

- [`plans/`](plans/) — design plans for past features
- [`research/`](research/) — test reports and data surveys
- [`sessionlogs/`](sessionlogs/) — development session logs
