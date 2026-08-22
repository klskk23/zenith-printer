#!/usr/bin/env bash
# Put the pinned font files in fonts/full.
#
# Constitution ("Rendering determinism"): text rendering MUST use bundled font
# files with loadSystemFonts disabled, so the same template renders
# pixel-identically on any machine. The binaries are not committed (19-26MB
# each); fonts/MANIFEST.sha256 pins them instead.
#
# Two sources, in this order:
#
#   1. **The system**, but only when its copy already hashes to the manifest.
#      This is the fast path and costs nothing.
#   2. **A pinned Debian package**, downloaded and checked against a hash
#      recorded here.
#
# The second source is why this script exists in its current form. Copying
# whatever the build machine happened to have made the manifest a tripwire with
# no remedy: Debian's fonts-dejavu-mono 2.37-6, -8 and -9 ship three different
# builds of DejaVuSansMono.ttf, so a checkout that verified on one machine
# could not be made to verify on another. Pinning the package makes the
# manifest something you can actually satisfy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FULL="$ROOT/fonts/full"
MANIFEST="$ROOT/fonts/MANIFEST.sha256"
CACHE="${ZENITH_FONT_CACHE:-$ROOT/fonts/.cache}"

# Pool paths stay valid while the version is in the archive. When one starts
# returning 404 the version has been superseded; snapshot.debian.org keeps them
# forever and takes the same pool path under /archive/debian/<timestamp>.
MIRROR="${ZENITH_FONT_MIRROR:-http://deb.debian.org/debian}"

mkdir -p "$FULL"

# package -> pool path | sha256 of the .deb
declare -A PKG_URL=(
  [noto]="pool/main/f/fonts-noto-cjk/fonts-noto-cjk_20240730+repack1-1_all.deb"
  [dejavu]="pool/main/f/fonts-dejavu/fonts-dejavu-mono_2.37-9_all.deb"
)
declare -A PKG_SHA=(
  [noto]="f5dc28a754e17327d99f0a612134d92c8dd6187314ae967cb77f25df60860139"
  [dejavu]="156a3e2e83f094f8aa1248433e92833ddcfdf12f0392497fbe127170a2dd19cf"
)

# destination filename : system path : package : path inside the package
FONTS=(
  "NotoSansCJK-Regular.ttc:/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc:noto:usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
  "NotoSansCJK-Bold.ttc:/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc:noto:usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
  "NotoSerifCJK-Regular.ttc:/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc:noto:usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"
  "DejaVuSansMono.ttf:/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:dejavu:usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
)

want_hash() { awk -v f="$1" '$2 == f { print $1 }' "$MANIFEST"; }
file_hash() { [[ -f "$1" ]] && sha256sum "$1" | cut -d' ' -f1 || true; }

declare -A UNPACKED=()

# Download a pinned package once per run and unpack it into the cache.
unpack_package() {
  local pkg="$1"
  [[ -n "${UNPACKED[$pkg]:-}" ]] && return 0

  local url="$MIRROR/${PKG_URL[$pkg]}"
  local deb="$CACHE/$(basename "${PKG_URL[$pkg]}")"
  local dir="$CACHE/$pkg"

  mkdir -p "$CACHE"
  if [[ "$(file_hash "$deb")" != "${PKG_SHA[$pkg]}" ]]; then
    echo "[fonts] downloading $(basename "$deb")"
    command -v curl >/dev/null || { echo "[fonts] curl is required to fetch pinned fonts" >&2; exit 1; }
    curl -fsSL --retry 3 -o "$deb.part" "$url" || {
      cat >&2 <<HINT

[fonts] could not download $url
        why:  the system fonts do not match fonts/MANIFEST.sha256, so the
              pinned package is the only remaining source
        next: check network access, or point ZENITH_FONT_MIRROR at a mirror —
              snapshot.debian.org/archive/debian/<timestamp> keeps superseded
              versions forever and uses the same pool paths
HINT
      rm -f "$deb.part"; exit 1
    }
    mv "$deb.part" "$deb"
  fi

  # The hash is the whole point: an unverified download is not a pin.
  local got; got="$(file_hash "$deb")"
  if [[ "$got" != "${PKG_SHA[$pkg]}" ]]; then
    echo "[fonts] $(basename "$deb") is not the pinned build" >&2
    echo "        expected ${PKG_SHA[$pkg]}" >&2
    echo "        got      $got" >&2
    exit 1
  fi

  command -v dpkg-deb >/dev/null || {
    echo "[fonts] dpkg-deb is required to unpack the pinned fonts (apt-get install dpkg-dev)" >&2
    exit 1
  }
  rm -rf "$dir"; mkdir -p "$dir"
  dpkg-deb -x "$deb" "$dir"
  UNPACKED[$pkg]=1
}

status=0
for entry in "${FONTS[@]}"; do
  IFS=: read -r name system pkg inner <<< "$entry"
  dst="$FULL/$name"
  want="$(want_hash "$name")"
  [[ -n "$want" ]] || { echo "[fonts] $name is not listed in MANIFEST.sha256" >&2; status=1; continue; }

  if [[ "$(file_hash "$dst")" == "$want" ]]; then
    echo "[fonts] present: $name"
    continue
  fi

  if [[ "$(file_hash "$system")" == "$want" ]]; then
    cp "$system" "$dst"
    echo "[fonts] system:  $name"
    continue
  fi

  unpack_package "$pkg"
  src="$CACHE/$pkg/$inner"
  [[ -f "$src" ]] || { echo "[fonts] $inner not found in the $pkg package" >&2; status=1; continue; }
  cp "$src" "$dst"
  if [[ "$(file_hash "$dst")" != "$want" ]]; then
    echo "[fonts] $name from the pinned package does not match the manifest" >&2
    status=1; continue
  fi
  echo "[fonts] pinned:  $name"
done

[[ $status -eq 0 ]] || exit $status
echo "[fonts] OK. Verify with: make fonts-verify"
