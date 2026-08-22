#!/usr/bin/env bash
# Install the package right here, boot it, call it, remove it.
#
# DESTRUCTIVE. It creates a system user, writes to /opt, /etc and /var/lib, and
# purges all of that again. It belongs in a container that gets thrown away —
# either one this repository starts (install-test.sh) or the disposable job
# container a CI runner already gave us. The guard below refuses anywhere else.
#
# What it covers that nothing before it does: a vendored dependency tree has
# exactly one interesting failure mode — a package that resolved on the build
# machine and is not in the .deb — and only installing and running the thing
# finds it.
set -euo pipefail

DEB="${1:?usage: install-test-body.sh <path to .deb>}"
[[ -f "$DEB" ]] || { echo "[test] no such file: $DEB" >&2; exit 1; }

if [[ ! -f /.dockerenv && ! -f /run/.containerenv && "${ZENITH_DESTRUCTIVE_OK:-0}" != "1" ]]; then
  cat >&2 <<'REFUSE'

[test] refusing to run outside a container
       why:  this installs and then purges a system package, a system user and
             everything under /opt/zenith-printer
       next: make deb-install-test   (starts a throwaway container for you)

REFUSE
  exit 1
fi
[[ "$(id -u)" = "0" ]] || { echo "[test] must run as root" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq adduser init-system-helpers curl >/dev/null

# The package depends on Debian's nodejs, which lives in /usr/bin. An image
# that carries Node somewhere else (the official node images use /usr/local)
# would otherwise make this a test of the image's layout.
[[ -x /usr/bin/node ]] || ln -sf "$(command -v node)" /usr/bin/node

echo "--- install ---"
dpkg -i --force-depends "$DEB" 2>&1 | grep -vE '^dpkg: |^ ' || true

echo "--- service account ---"
getent passwd zenith
[[ "$(stat -c '%U:%G %a' /var/lib/zenith-printer)" = "zenith:zenith 750" ]] \
  || { echo "FAIL: wrong ownership on /var/lib/zenith-printer"; exit 1; }
[[ "$(stat -c '%U:%G %a' /etc/zenith-printer/zenith-printer.env)" = "root:zenith 640" ]] \
  || { echo "FAIL: wrong ownership on the env file"; exit 1; }
echo "ok: state directory and env file"

echo "--- unit ---"
[[ -f /usr/lib/systemd/system/zenith-printer.service ]] || { echo "FAIL: no unit"; exit 1; }
grep -q '^EnvironmentFile=-/etc/zenith-printer/zenith-printer.env' \
  /usr/lib/systemd/system/zenith-printer.service || { echo "FAIL: unit ignores /etc"; exit 1; }
echo "ok: unit installed and reads /etc"

echo "--- boot as the service user, with the unit's own settings ---"
# There is no systemd in a container, so the unit is never started by anything.
# Sourcing the file the unit reads is the closest honest approximation.
set -a; . /etc/zenith-printer/zenith-printer.env; set +a
ZENITH_HOST=127.0.0.1
runuser -u zenith -- env \
  ZENITH_HOST="$ZENITH_HOST" ZENITH_PORT="$ZENITH_PORT" \
  ZENITH_DB="$ZENITH_DB" ZENITH_UPLOADS="$ZENITH_UPLOADS" LOG_LEVEL=warn \
  node --experimental-strip-types /opt/zenith-printer/packages/server/src/index.ts &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

BASE="http://127.0.0.1:$ZENITH_PORT"
for _ in $(seq 1 60); do
  curl -fsS --max-time 2 "$BASE/api/frontend-build" >/dev/null 2>&1 && break
  kill -0 $SERVER 2>/dev/null || { echo "FAIL: the service exited"; exit 1; }
  sleep 0.5
done

curl -fsS "$BASE/api/frontend-build" >/dev/null || { echo "FAIL: no API"; exit 1; }
echo "ok: API answers"
curl -fsS "$BASE/api/printers"       >/dev/null || { echo "FAIL: printers endpoint"; exit 1; }
echo "ok: printers endpoint"
curl -fsS "$BASE/" | grep -q '<div id="root"' || { echo "FAIL: no frontend"; exit 1; }
echo "ok: frontend served"
curl -fsS "$BASE/fonts/subset/NotoSansCJKsc-Regular.woff2" -o /dev/null \
  || { echo "FAIL: editor fonts missing from the bundle"; exit 1; }
echo "ok: editor fonts served"
[[ -f "$ZENITH_DB" ]] || { echo "FAIL: no database at $ZENITH_DB"; exit 1; }
echo "ok: database at $ZENITH_DB"

echo "--- command line ---"
zenith --help >/dev/null || { echo "FAIL: zenith --help"; exit 1; }
echo "ok: zenith --help"

echo "--- removal ---"
kill $SERVER 2>/dev/null || true; wait $SERVER 2>/dev/null || true; trap - EXIT
dpkg --purge --force-depends zenith-printer 2>&1 | grep -vE '^dpkg: |^ ' || true
[[ ! -e /opt/zenith-printer ]] || { echo "FAIL: /opt left behind"; exit 1; }
[[ ! -e /etc/zenith-printer/zenith-printer.env ]] || { echo "FAIL: conffile left behind"; exit 1; }
# Deliberate: purge keeps the label templates. See packaging/deb/postrm.
[[ -d /var/lib/zenith-printer ]] || { echo "FAIL: purge deleted the data"; exit 1; }
echo "ok: purge removed the package and kept the data"

echo
echo "PASS"
