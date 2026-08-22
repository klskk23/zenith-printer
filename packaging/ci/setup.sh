#!/usr/bin/env bash
# Turn a bare debian:trixie-slim container into one that can build this
# project, or install what it built.
#
# Run once per CI job: a docker-executor runner starts every job from a clean
# image, so there is nothing to carry over. Kept as a script rather than inline
# YAML so it can be run by hand — `docker run --rm -it debian:trixie-slim` and
# then this — when a pipeline fails for reasons that look like the environment.
set -euo pipefail

MODE="${1:-build}"
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg make

# Node from NodeSource rather than from Debian: trixie ships 20/22, and this
# repository needs 26. Installing the same *package* the target will have is
# also what puts the interpreter at /usr/bin/node — the path baked into the
# systemd unit, which cannot resolve anything from PATH.
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 26 ]; then
  curl -fsSL https://deb.nodesource.com/setup_26.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi

# npm 12, explicitly, because this repository depends on behaviour only npm 12
# has. package.json carries an `allowScripts` block; npm 12 honours it and
# refuses to run the install scripts of three BLE packages nobody here uses.
# npm 11 — which is what nodejs 26.7 currently bundles — has no such mechanism,
# runs them, and node-gyp then dies on a missing g++. Installing a compiler
# would "fix" it by building code the service never loads; matching the npm the
# lockfile was written by fixes it properly.
if [ "$(npm -v | cut -d. -f1)" -lt 12 ]; then
  echo "[setup] npm $(npm -v) does not honour allowScripts; installing npm 12"
  npm install -g npm@^12 >/dev/null 2>&1
fi

case "$MODE" in
  build)
    # dpkg-dev for dpkg-deb; binutils for objdump, which reads the real glibc
    # floor off the shipped binaries instead of guessing it.
    #
    # The two font packages are only the fast path: scripts/fetch-fonts.sh uses
    # the system copy when it already hashes to the manifest and downloads the
    # pinned Debian package when it does not. On trixie that means the three
    # 20MB Noto files come from apt and only DejaVu (487KB) is fetched.
    apt-get install -y -qq --no-install-recommends \
      dpkg-dev binutils fonts-noto-cjk fonts-dejavu-core
    ;;
  runtime)
    # Installing the .deb needs nothing further — its own dependencies pull in
    # adduser and init-system-helpers.
    ;;
  *)
    echo "usage: setup.sh [build|runtime]" >&2
    exit 2
    ;;
esac

echo "[setup] $MODE environment ready: node $(node -v) at $(command -v node)"
