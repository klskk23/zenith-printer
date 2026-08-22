#!/usr/bin/env bash
# Run the install test in a container this script starts.
#
# For a workstation, or any CI runner whose jobs are not already disposable
# Debian containers. Under a docker-executor runner the job container *is* one,
# so the pipeline calls install-test-body.sh directly instead and needs no
# docker socket, no docker-in-docker and no privileged mode.
set -euo pipefail

DEB="${1:?usage: install-test.sh <path to .deb>}"
IMAGE="${TEST_IMAGE:-debian:bookworm-slim}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -f "$DEB" ]] || { echo "[test] no such file: $DEB" >&2; exit 1; }

printf '\033[36m[test]\033[0m installing %s in %s\n' "$(basename "$DEB")" "$IMAGE"

# -i, or docker hands bash an empty stdin and `bash -s` reads no script at all
# — the run then succeeds having done nothing, which is the worst outcome a
# test can have.
docker run --rm -i \
  -v "$(cd "$(dirname "$DEB")" && pwd):/deb:ro" \
  -v "$HERE/install-test-body.sh:/install-test-body.sh:ro" \
  "$IMAGE" bash -s -- "/deb/$(basename "$DEB")" <<'INNER'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq curl ca-certificates gnupg >/dev/null
# A plain Debian image has no Node. The package depends on it, so install the
# same one the target will have rather than borrowing some other layout.
curl -fsSL https://deb.nodesource.com/setup_26.x | bash - >/dev/null 2>&1
apt-get install -y -qq nodejs >/dev/null
exec bash /install-test-body.sh "$1"
INNER
