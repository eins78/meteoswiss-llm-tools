#!/usr/bin/env bash
# Orchestrates one MCP-vs-skills eval run:
#   1. ensures the local meteoswiss-mcp server is up (starts one if needed, kills it after),
#   2. captures LIVE ground truth (must happen immediately before the paid run — the
#      models and the ground truth have to read the same 10-minute data window),
#   3. runs promptfoo with --no-cache (live data makes cached rows meaningless),
#   4. prints the cumulative spend ledger total.
#
# API key: OPENROUTER_API_KEY from env or .env (like run.sh); as a convenience for this
# repo's dev machine it falls back to the macOS keychain item "openrouter-evals".
# Extra args are passed to `promptfoo eval` (e.g. --filter-providers 'haiku').
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
if [ "${OPENROUTER_API_KEY:-}" = "" ] && command -v security >/dev/null 2>&1; then
  OPENROUTER_API_KEY="$(security find-generic-password -s openrouter-evals -w 2>/dev/null || true)"
  export OPENROUTER_API_KEY
fi
if [ "${OPENROUTER_API_KEY:-}" = "" ]; then
  echo "error: OPENROUTER_API_KEY is not set (env, .env, or keychain 'openrouter-evals')." >&2
  exit 1
fi

MCP_URL="${MCP_SKILLS_MCP_URL:-http://localhost:3105/mcp}"
HEALTH_URL="${MCP_URL%/mcp}/health"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  echo "starting local meteoswiss-mcp on ${MCP_URL} ..."
  PORT="$(echo "$MCP_URL" | sed -nE 's|.*:([0-9]+)/.*|\1|p')"
  if [ -z "$PORT" ]; then
    echo "error: cannot extract a port from MCP_SKILLS_MCP_URL='$MCP_URL' — start the server yourself or use an explicit-port URL." >&2
    exit 1
  fi
  # The eval opens one MCP session per test row and never closes it; the default limit (10 per client) would answer 429.
  (cd ../meteoswiss-mcp && PORT="$PORT" MAX_SESSIONS_PER_CLIENT=200 exec npx tsx src/index.ts) &
  SERVER_PID=$!
  for _ in $(seq 1 30); do
    if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  curl -sf "$HEALTH_URL" >/dev/null || {
    echo "error: MCP server did not become healthy at $HEALTH_URL" >&2
    exit 1
  }
fi

echo "capturing live ground truth ..."
npx tsx src/mcp-vs-skills/capture-ground-truth.ts

echo "running promptfoo (no cache — live data) ..."
promptfoo eval -c promptfooconfig.mcp-vs-skills.yaml --no-cache "$@"

echo "cumulative OpenRouter spend recorded by the budget ledger:"
npx tsx -e '
import { totalSpendUsd, budgetUsd } from "./src/mcp-vs-skills/budget.ts";
console.log(`  $${totalSpendUsd().toFixed(4)} of $${budgetUsd().toFixed(2)} cap`);
'
