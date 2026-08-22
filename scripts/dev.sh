#!/usr/bin/env bash
# Development mode: the API and the Vite dev server, together.
#
# Vite proxies /api to the backend (see packages/web/vite.config.ts), so the
# frontend code never needs to know whether it is talking to the dev server or
# to the single production process.
#
# The trap matters. Backgrounding the API with a bare `&` leaves it running
# after Ctrl-C kills the foreground process, and the next `npm run dev` then
# fails with EADDRINUSE for reasons that are not at all obvious.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# `--env-file-if-exists`, not `--env-file`: a missing .env is the normal case
# for anybody who configures the service through systemd instead.
node --env-file-if-exists=.env --watch --experimental-strip-types packages/server/src/index.ts &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm run dev --workspace @zenith/web
