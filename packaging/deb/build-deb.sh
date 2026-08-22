#!/usr/bin/env bash
# Build the zenith-printer .deb.
#
# Assembled with dpkg-deb rather than debhelper, and that is a decision rather
# than a shortcut. A debhelper source package builds offline from Debian-
# packaged dependencies; this application's dependencies are ~240 npm packages
# that Debian does not carry, three of which ship prebuilt native binaries.
# Expressing that as a proper source package would mean packaging all of them.
# So the tree is vendored: `npm ci` runs here, at package build time, and what
# lands in the .deb is exactly what was tested.
#
# Consequences, stated rather than hidden:
#
#   - The package is architecture-specific. The prebuilt .node binaries are
#     built for whatever this machine is, so cross-building is refused below
#     rather than producing a package that installs and then crashes.
#   - The vendored tree is not visible to `apt`. A CVE in a bundled npm package
#     is fixed by rebuilding this package, not by upgrading a system library.
set -euo pipefail

VERSION=""
ARCH=""
BUILD_DIR="build"
OUT_DIR="dist"
MAINTAINER="${DEB_MAINTAINER:-}"
SKIP_SMOKE="${SKIP_SMOKE:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)   VERSION="$2"; shift 2 ;;
    --arch)      ARCH="$2"; shift 2 ;;
    --build-dir) BUILD_DIR="$2"; shift 2 ;;
    --out-dir)   OUT_DIR="$2"; shift 2 ;;
    --maintainer) MAINTAINER="$2"; shift 2 ;;
    --skip-smoke) SKIP_SMOKE=1; shift ;;
    *) echo "[deb] unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

HERE="packaging/deb"
PKG=zenith-printer
INSTALL_PREFIX=/opt/$PKG

say()  { printf '\033[36m[deb]\033[0m %s\n' "$*"; }
fail() {
  printf '\n\033[1;31m[deb]\033[0m %s\n' "$1" >&2
  [[ -n "${2:-}" ]] && printf '      why:  %s\n' "$2" >&2
  [[ -n "${3:-}" ]] && printf '      next: %s\n' "$3" >&2
  printf '\n' >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

[[ -n "$VERSION" ]] || fail "no --version given" \
  "the package version comes from the caller" "make deb"

HOST_ARCH="$(dpkg --print-architecture)"
ARCH="${ARCH:-$HOST_ARCH}"
if [[ "$ARCH" != "$HOST_ARCH" ]]; then
  fail "cannot build a $ARCH package on $HOST_ARCH" \
    "the vendored npm tree contains prebuilt native binaries for this machine (sharp, resvg, serialport)" \
    "build on a $ARCH host, or in a $ARCH container"
fi

if [[ -z "$MAINTAINER" ]]; then
  name="$(git config user.name  2>/dev/null || true)"
  mail="$(git config user.email 2>/dev/null || true)"
  [[ -n "$name" && -n "$mail" ]] \
    || fail "no maintainer identity" \
         "the Debian control file requires one, and git has none configured" \
         "git config user.name/user.email, or pass DEB_MAINTAINER='Name <mail>'"
  MAINTAINER="$name <$mail>"
fi

# Rendering determinism (constitution): the renderer reads these files and only
# these files. Shipping a font whose bytes drifted means the same template
# prints differently on two machines and nothing anywhere says so.
say "verifying bundled fonts against MANIFEST.sha256"
( cd fonts/full && sha256sum -c ../MANIFEST.sha256 --quiet ) \
  || fail "fonts/full does not match MANIFEST.sha256" \
       "the renderer runs with loadSystemFonts disabled, so these bytes decide what prints" \
       "make fonts"

[[ -f packages/web/dist/index.html ]] \
  || fail "packages/web/dist is missing" "the service serves this directory" "make build"
[[ -d packages/web/dist/fonts/subset ]] \
  || fail "the frontend bundle carries no fonts" \
       "packages/web/public/fonts/subset did not resolve when vite built" \
       "make web-fonts-link && make build"

# A bundle older than its sources is the failure that reads as "my fix did
# nothing". Cheap to detect here; expensive to diagnose on the target.
newest_src="$(find packages/web/src packages/shared/src -type f -newer packages/web/dist/index.html -print -quit 2>/dev/null || true)"
[[ -z "$newest_src" ]] \
  || fail "packages/web/dist is older than the sources" \
       "$newest_src changed after the bundle was built" "make build"

STAGE="$BUILD_DIR/deb/$PKG"
TREE="$STAGE$INSTALL_PREFIX"

# ---------------------------------------------------------------------------
# Stage the runtime tree
# ---------------------------------------------------------------------------
# Layout matters: the server derives its own root from import.meta.url, three
# levels up from packages/server/src. Fonts and the frontend bundle are found
# relative to that, so this tree has to keep the repository's shape.

say "staging $INSTALL_PREFIX"
rm -rf "$STAGE"
mkdir -p "$TREE"

install -Dm644 package.json      "$TREE/package.json"
install -Dm644 package-lock.json "$TREE/package-lock.json"

for ws in shared server cli; do
  install -Dm644 "packages/$ws/package.json" "$TREE/packages/$ws/package.json"
  # The .ts sources are what runs — Node strips the types at load time, so
  # there is no compiled artefact to ship in their place.
  cp -a "packages/$ws/src" "$TREE/packages/$ws/src"
done

# The web workspace ships as its build output only. Its dependencies (react and
# friends) are compiled into the bundle and are not needed at runtime, which is
# why the install below asks for the other three workspaces by name.
install -Dm644 packages/web/package.json "$TREE/packages/web/package.json"
cp -a packages/web/dist "$TREE/packages/web/dist"

mkdir -p "$TREE/fonts"
cp -a fonts/full "$TREE/fonts/full"
install -Dm644 fonts/MANIFEST.sha256 "$TREE/fonts/MANIFEST.sha256"

# ---------------------------------------------------------------------------
# Vendor the production dependencies
# ---------------------------------------------------------------------------

say "installing production dependencies into the staged tree"
( cd "$TREE" && npm ci --omit=dev --no-audit --no-fund --ignore-scripts=false \
    --workspace @zenith/server --workspace @zenith/cli --workspace @zenith/shared \
    --include-workspace-root ) \
  || fail "npm ci failed in the staged tree" \
       "the package vendors its dependencies so the target needs no network" \
       "check the output above; the lockfile and the registry are the usual suspects"

[[ -d "$TREE/node_modules" ]] || fail "npm ci produced no node_modules" "" ""

# Prebuilt binaries for other platforms are dead weight in a package that
# refuses to cross-build anyway.
say "dropping prebuilt binaries for other platforms"
find "$TREE/node_modules" -type d \( -name 'win32-*' -o -name 'darwin-*' -o -name 'android-*' \) \
  -prune -exec rm -rf {} + 2>/dev/null || true

# ---------------------------------------------------------------------------
# Smoke test the staged tree
# ---------------------------------------------------------------------------
# The one failure mode a vendored tree has is a dependency that resolved on the
# build machine and not in the package. Booting it once here is the only check
# that actually covers that.

if [[ "$SKIP_SMOKE" != "1" ]]; then
  say "booting the staged tree once"
  smoke_dir="$(mktemp -d)"
  smoke_port=$(( 20000 + RANDOM % 20000 ))
  set +e
  ZENITH_HOST=127.0.0.1 ZENITH_PORT="$smoke_port" \
  ZENITH_DB="$smoke_dir/zenith.db" ZENITH_UPLOADS="$smoke_dir/uploads" \
  LOG_LEVEL=warn \
    node --experimental-strip-types "$TREE/packages/server/src/index.ts" \
    > "$smoke_dir/log" 2>&1 &
  smoke_pid=$!
  ok=0
  for _ in $(seq 1 60); do
    if ! kill -0 "$smoke_pid" 2>/dev/null; then break; fi
    if curl -fsS --max-time 2 "http://127.0.0.1:$smoke_port/api/frontend-build" >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep 0.5
  done
  kill "$smoke_pid" 2>/dev/null
  wait "$smoke_pid" 2>/dev/null
  set -e
  if [[ "$ok" != "1" ]]; then
    echo "--- staged server output ---" >&2
    cat "$smoke_dir/log" >&2 || true
    rm -rf "$smoke_dir"
    fail "the staged tree did not answer on /api/frontend-build" \
      "something the service needs is missing from the vendored node_modules" \
      "read the output above; SKIP_SMOKE=1 skips this check if you must"
  fi
  rm -rf "$smoke_dir"
  say "staged tree serves the frontend build endpoint"
fi

# ---------------------------------------------------------------------------
# The rest of the filesystem
# ---------------------------------------------------------------------------

# /usr/lib, not /lib: on a merged-usr system /lib is a symlink, and dpkg
# refuses to own files through an aliased path.
install -Dm644 deploy/zenith-printer.service "$STAGE/usr/lib/systemd/system/zenith-printer.service"
install -Dm640 deploy/zenith-printer.env     "$STAGE/etc/zenith-printer/zenith-printer.env"
install -Dm755 "$HERE/zenith"                "$STAGE/usr/bin/zenith"
install -Dm644 "$HERE/copyright"             "$STAGE/usr/share/doc/$PKG/copyright"
install -Dm644 packaging/README.md           "$STAGE/usr/share/doc/$PKG/README.md"
install -Dm644 docs/design-consensus.md      "$STAGE/usr/share/doc/$PKG/design-consensus.md"

# ---------------------------------------------------------------------------
# Control
# ---------------------------------------------------------------------------

# glibc, read off the shipped binaries rather than guessed. Without it the
# package installs happily on a distribution too old to run it and fails at the
# first render, which points the finger at the wrong thing.
glibc_min="2.17"
if command -v objdump >/dev/null 2>&1; then
  found="$(find "$TREE/node_modules" -name '*.node' -o -name 'lib*.so*' 2>/dev/null \
    | xargs -r objdump -T 2>/dev/null \
    | grep -o 'GLIBC_[0-9.]*' | sed 's/GLIBC_//' | sort -V | tail -1 || true)"
  [[ -n "$found" ]] && glibc_min="$found"
  say "shipped binaries need glibc >= $glibc_min"
else
  say "objdump absent; assuming glibc >= $glibc_min"
fi

DEPENDS="nodejs (>= 26), libc6 (>= $glibc_min), libstdc++6, libgcc-s1, adduser, init-system-helpers (>= 1.51)"

INSTALLED_SIZE="$(du -sk "$STAGE" | cut -f1)"

mkdir -p "$STAGE/DEBIAN"
sed -e "s|@VERSION@|$VERSION|" \
    -e "s|@ARCH@|$ARCH|" \
    -e "s|@MAINTAINER@|$MAINTAINER|" \
    -e "s|@INSTALLED_SIZE@|$INSTALLED_SIZE|" \
    -e "s|@DEPENDS@|$DEPENDS|" \
    "$HERE/control.in" > "$STAGE/DEBIAN/control"

install -m644 "$HERE/conffiles" "$STAGE/DEBIAN/conffiles"
install -m755 "$HERE/postinst"  "$STAGE/DEBIAN/postinst"
install -m755 "$HERE/prerm"     "$STAGE/DEBIAN/prerm"
install -m755 "$HERE/postrm"    "$STAGE/DEBIAN/postrm"

# Conffiles are left out on purpose: dpkg tracks their checksums itself, and
# listing an edited one here makes `dpkg --verify` report every customised
# install as damaged.
( cd "$STAGE" \
  && find . -path ./DEBIAN -prune -o -path ./etc -prune -o -type f -print0 \
     | sed -z 's|^\./||' | xargs -0 md5sum ) > "$STAGE/DEBIAN/md5sums"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

mkdir -p "$OUT_DIR"
DEB="$OUT_DIR/${PKG}_${VERSION}_${ARCH}.deb"
rm -f "$DEB"

# --root-owner-group instead of fakeroot: everything in the package is
# root-owned, and the one directory that is not is created by postinst.
say "building $DEB"
dpkg-deb --root-owner-group --build "$STAGE" "$DEB" >/dev/null

printf '\n\033[32m[deb]\033[0m %s  (%s)\n' "$DEB" "$(du -h "$DEB" | cut -f1)"
printf '      install with: sudo apt install ./%s\n\n' "$DEB"
