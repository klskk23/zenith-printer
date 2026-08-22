#!/usr/bin/env bash
# Install the package in a throwaway Debian container and prove it serves.
#
# Not a substitute for installing it on the target — there is no systemd in
# here, so the unit is unpacked but never started, and the maintainer scripts'
# systemd blocks are skipped the same way they would be in a chroot. What this
# does cover is everything else, and everything else is where the mistakes
# have been: a dependency that resolved only on the build machine, a postinst
# that creates the user with the wrong shell, an interpreter path that exists
# on the machine that built the package and nowhere else.
#
# `dpkg -i --force-depends` is deliberate. The image carries Node as a tarball
# rather than as a dpkg, so the `nodejs (>= 26)` dependency cannot be satisfied
# inside it. Forcing past that tests the package; it does not weaken it.
set -euo pipefail

DEB="${1:?usage: install-test.sh <path to .deb>}"
IMAGE="${TEST_IMAGE:-node:26-trixie-slim}"

[[ -f "$DEB" ]] || { echo "[test] no such file: $DEB" >&2; exit 1; }

printf '\033[36m[test]\033[0m installing %s in %s\n' "$(basename "$DEB")" "$IMAGE"

# -i, or docker hands bash an empty stdin and `bash -s` reads no script at all
# — the run then succeeds having done nothing, which is the worst outcome a
# test can have.
docker run --rm -i -v "$(cd "$(dirname "$DEB")" && pwd):/deb:ro" "$IMAGE" bash -s -- \
  "/deb/$(basename "$DEB")" <<'INNER'
set -euo pipefail
DEB="$1"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq adduser init-system-helpers curl >/dev/null

# The image keeps Node in /usr/local/bin. The package depends on Debian's
# nodejs, which puts it in /usr/bin — so link it, otherwise this is a test of
# the image's layout rather than of the package.
ln -sf "$(command -v node)" /usr/bin/node

echo "--- install ---"
dpkg -i --force-depends "$DEB" 2>&1 | grep -vE '^dpkg: |^ ' || true

echo "--- service account ---"
getent passwd zenith
[ "$(stat -c '%U:%G %a' /var/lib/zenith-printer)" = "zenith:zenith 750" ] \
  || { echo "FAIL: wrong ownership on /var/lib/zenith-printer"; exit 1; }
[ "$(stat -c '%U:%G %a' /etc/zenith-printer/zenith-printer.env)" = "root:zenith 640" ] \
  || { echo "FAIL: wrong ownership on the env file"; exit 1; }
echo "ok: state directory and env file"

echo "--- unit ---"
test -f /usr/lib/systemd/system/zenith-printer.service || { echo "FAIL: no unit"; exit 1; }
grep -q '^EnvironmentFile=-/etc/zenith-printer/zenith-printer.env' \
  /usr/lib/systemd/system/zenith-printer.service || { echo "FAIL: unit ignores /etc"; exit 1; }
echo "ok: unit installed and reads /etc"

echo "--- boot as the service user, with the unit's own settings ---"
set -a; . /etc/zenith-printer/zenith-printer.env; set +a
export ZENITH_HOST=127.0.0.1
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

# The database and uploads land where the env file says, owned by the service.
test -f "$ZENITH_DB" || { echo "FAIL: no database at $ZENITH_DB"; exit 1; }
echo "ok: database at $ZENITH_DB"

echo "--- command line ---"
zenith --help >/dev/null || { echo "FAIL: zenith --help"; exit 1; }
echo "ok: zenith --help"

echo "--- removal ---"
kill $SERVER 2>/dev/null || true; wait $SERVER 2>/dev/null || true; trap - EXIT
dpkg --purge --force-depends zenith-printer 2>&1 | grep -vE '^dpkg: |^ ' || true
test ! -e /opt/zenith-printer || { echo "FAIL: /opt left behind"; exit 1; }
test ! -e /etc/zenith-printer/zenith-printer.env || { echo "FAIL: conffile left behind"; exit 1; }
# Deliberate: purge keeps the label templates. See packaging/deb/postrm.
test -d /var/lib/zenith-printer || { echo "FAIL: purge deleted the data"; exit 1; }
echo "ok: purge removed the package and kept the data"

echo
echo "PASS"
INNER
