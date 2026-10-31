# Multi-stage build for the MeteoSwiss MCP Server.
#
# IMPORTANT: this image builds from the REPOSITORY ROOT context (`context: .`), not the
# package directory. That is deliberate: the server must be installed from the frozen
# workspace lockfile (`/pnpm-lock.yaml`) so that the root-level `pnpm.overrides` security
# pins (path-to-regexp, hono, undici, ws, form-data, ip-address, fast-uri, brace-expansion…)
# are applied to the shipped image. A single-package `--no-frozen-lockfile` build re-resolves
# against the live registry and drops those overrides — see the CI workflows' `context:`.

# ------------------------------------------------------------------------------------------------
# Stage 1: Build (full workspace install from the frozen lockfile, then build + prod deploy)
FROM node:26-alpine AS builder
WORKDIR /app

# Run pnpm non-interactively (auto-confirm node_modules purge, no TTY in Docker build)
ENV CI=true

# Install pnpm via corepack (version pinned by root package.json "packageManager")
RUN npm i -g corepack && pnpm -v

# Copy workspace manifests + lockfile first for a cacheable, frozen install.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY packages/meteoswiss-mcp/package.json ./packages/meteoswiss-mcp/
COPY packages/meteoswiss-skills/package.json ./packages/meteoswiss-skills/

# Install the workspace exactly as locked (overrides applied, minimumReleaseAge satisfied).
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm config set store-dir /root/.local/share/pnpm/store && \
    pnpm install --frozen-lockfile

# Copy the MCP package source and compile it (tsc → dist).
COPY packages/meteoswiss-mcp ./packages/meteoswiss-mcp
RUN pnpm --filter meteoswiss-mcp run build

# Produce a self-contained, production-only deployment (real node_modules, no dev deps).
# `pnpm deploy` copies the package's `files` (dist, src/views, README) + a flattened
# production node_modules tree resolved from the frozen lockfile. `--legacy` is required
# because meteoswiss-mcp has no injected workspace dependencies (pnpm v10 otherwise refuses
# to deploy unless inject-workspace-packages=true); legacy deploy resolves straight from the
# workspace lockfile, which is exactly what we want.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm --filter meteoswiss-mcp deploy --prod --legacy /app/deploy

# ------------------------------------------------------------------------------------------------
# Stage 2: Runtime (copy only the self-contained deployment)
FROM node:26-alpine AS runtime

LABEL org.opencontainers.image.title="meteoswiss-mcp"
LABEL org.opencontainers.image.description="MCP server for MeteoSwiss weather data"
LABEL org.opencontainers.image.source="https://github.com/eins78/meteoswiss-llm-tools"
LABEL org.opencontainers.image.url="https://meteoswiss-mcp.ars.is"
LABEL org.opencontainers.image.licenses="CC0-1.0"

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy the self-contained production deployment (package.json, dist, src/views, node_modules).
COPY --from=builder /app/deploy ./

# Test fixtures for the optional USE_TEST_FIXTURES runtime mode (parity with prior image).
COPY --from=builder /app/packages/meteoswiss-mcp/test/__fixtures__ ./test/__fixtures__

# Change ownership to nodejs user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose the port (default 3000)
EXPOSE 3000

# Environment variable hints
ENV PORT=3000
ENV PUBLIC_URL=""

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); })"

# Start the server directly with node (no pnpm/corepack needed in the runtime image).
CMD ["node", "dist/index.js"]
