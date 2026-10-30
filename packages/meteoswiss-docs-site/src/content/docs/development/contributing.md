---
title: Contributing
description: Conventions for contributing code and documentation to meteoswiss-llm-tools.
---

Contributions are welcome. Open an issue or a pull request at
[github.com/eins78/meteoswiss-llm-tools](https://github.com/eins78/meteoswiss-llm-tools).

## Before you push

```bash
pnpm --filter meteoswiss-mcp run fix && pnpm --filter meteoswiss-mcp run ci
```

`fix` applies formatting and auto-fixable lint rules; `ci` runs lint, build and tests.

## Code conventions (TypeScript)

- ES modules; imports use `.js` extensions even for `.ts` files, and Node built-ins use the `node:` prefix.
- Type-only imports use the `type` keyword.
- Production code is strict: avoid `!`, `as` and `any`; use `unknown` for external data and provide type guards.
- No TypeScript `enum`; use `as const` objects or arrays.
- Prefer domain types (for example a `Language` union) to loose `string`.
- Explicit return types, and JSDoc on exported functions.
- Names: `camelCase` for values, `PascalCase` for types and classes, `UPPER_CASE` for constants, `kebab-case` for files and folders.

## Adding or changing a tool

1. Define the Zod **input and output** schemas in `src/schemas/` and export the response type with `z.infer`.
2. Implement the logic in `src/tools/` or `src/data/`.
3. Register it in `src/server.ts` with `registerTool(name, { description, inputSchema, outputSchema }, handler)` and return `structuredContent`.
4. Add integration tests with fixtures (see [Testing](../testing/)).
5. Keep the skill in step: run `pnpm --filter meteoswiss-mcp run parity:update`, add a `<!-- mcp-tool: name -->` marker to the matching section of
   the skill, or record a deliberate exclusion in `parity/parity-exceptions.yml`.
6. Update the [tools reference](../../user/tools/) on this site.
7. Add a changeset ([release process](../releasing/)).

## Documentation

This site lives in `packages/meteoswiss-docs-site/`. The user, operator and development pages are hand-written Markdown under
`src/content/docs/`. The eval runs and the skill-vs-MCP case study are copied in at build time from their source files, so edit those at the
source. Preview locally with:

```bash
cd packages/meteoswiss-docs-site
pnpm install
pnpm run dev
```

Documentation must follow the code: when they disagree, fix the docs. Refer to the product as the "MeteoSwiss app and website" when describing
what the data powers.

## Branches and commits

Branch prefixes: `feature/`, `bug/`, `docs/`, `infra/`, `idea/`. Planning documents live in `docs/plans/`; session logs in `docs/sessionlogs/`.
