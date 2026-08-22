#!/usr/bin/env bash
# Start the image on a scratch volume, ask it a few questions, tear it down.
#
# Not privileged and not on port 3000: this proves the image serves, not that
# it can reach a printer. The printer needs hardware, and binding the real port
# would collide with whatever is already running on the machine doing the
# checking.
set -euo pipefail

IMAGE="${1:?usage: smoke.sh <image:tag>}"
NAME="zenith-smoke-$$"
PORT=$(( 20000 + RANDOM % 20000 ))
VOLUME="zenith-smoke-$$"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

printf '\033[36m[smoke]\033[0m %s on port %s\n' "$IMAGE" "$PORT"
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:3000" -v "$VOLUME:/data" "$IMAGE" >/dev/null

BASE="http://127.0.0.1:$PORT"
for _ in $(seq 1 60); do
  curl -fsS --max-time 2 "$BASE/api/frontend-build" >/dev/null 2>&1 && break
  docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null | grep -q true || {
    echo "[smoke] the container exited:" >&2; docker logs "$NAME" >&2; exit 1; }
  sleep 0.5
done

fail() { echo "[smoke] FAIL: $1" >&2; docker logs "$NAME" >&2; exit 1; }

curl -fsS "$BASE/api/frontend-build" >/dev/null || fail "no API"
echo "ok: API answers"
curl -fsS "$BASE/api/printers" >/dev/null || fail "printers endpoint"
echo "ok: printers endpoint"
curl -fsS "$BASE/" | grep -q '<div id="root"' || fail "no frontend"
echo "ok: frontend served"
curl -fsS "$BASE/fonts/subset/NotoSansCJKsc-Regular.woff2" -o /dev/null \
  || fail "editor fonts missing from the bundle"
echo "ok: editor fonts served"

# The path that reads fonts/full with system font loading disabled — the one
# thing that proves the fonts actually shipped and are usable, not merely
# present. Done through the CLI because /api/preview needs a real, probed
# printer, and a smoke test has no hardware.
docker exec "$NAME" node --experimental-strip-types packages/cli/src/index.ts \
  render-test --element multiline --content '中文 ABC 007' --out /tmp/smoke.png >/dev/null \
  || fail "rendering a label with CJK text"
size="$(docker exec "$NAME" stat -c%s /tmp/smoke.png)"
[ "$size" -gt 1000 ] || fail "the rendered label is $size bytes, which is not a label"
echo "ok: renders CJK text from the bundled fonts ($size bytes of PNG)"

# It survives a restart with its data — the volume is the whole point.
docker restart "$NAME" >/dev/null
for _ in $(seq 1 60); do
  curl -fsS --max-time 2 "$BASE/api/frontend-build" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "$BASE/api/printers" >/dev/null || fail "did not come back after a restart"
echo "ok: comes back after a restart"

echo
echo "PASS"
