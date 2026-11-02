#!/bin/bash
# Runs the promptfoo viewer over the local ~/.promptfoo results DB, bound to 127.0.0.1 only.
# Launched by li.kiste.meteoswiss-evals-viewer.plist (see README "Live viewer" section).
# To run manually: bash scripts/start-viewer.sh
#
# promptfoo's viewer has no host flag and binds every interface, with no authentication, so the
# preload below pins it to loopback. Tailnet access comes from a `tailscale serve` mapping to
# http://127.0.0.1:15500 (one-time setup in the README). That mapping is stored by tailscaled and
# survives restarts of this script, so the script does not touch it: tailscaled's binds are on the
# tailnet addresses, which do not collide with a loopback bind, and `tailscale serve` is denied to
# a non-operator user, which would otherwise kill this script under `set -e`.
set -euo pipefail

PORT=15500
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR/.."
export NODE_OPTIONS="--require $SCRIPT_DIR/loopback-listen.cjs${NODE_OPTIONS:+ $NODE_OPTIONS}"

# `-n`: skip confirmation, do NOT auto-open a browser — this runs headless under launchd.
# exec: launchd supervises the viewer itself, and KeepAlive restarts it on exit.
exec ./node_modules/.bin/promptfoo view --port "$PORT" -n
