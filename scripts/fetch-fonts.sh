#!/usr/bin/env bash
# Fetch the pinned font files required for deterministic rendering.
#
# Constitution ("Rendering determinism"): text rendering MUST use bundled font
# files with loadSystemFonts disabled, so the same template renders
# pixel-identically on any machine. The binaries are not committed (they are
# ~19-26MB each); integrity is pinned in fonts/MANIFEST.sha256 instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FULL="$ROOT/fonts/full"
mkdir -p "$FULL"

# source path -> destination filename
declare -A FONTS=(
  ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]="NotoSansCJK-Regular.ttc"
  ["/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"]="NotoSansCJK-Bold.ttc"
  ["/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"]="NotoSerifCJK-Regular.ttc"
  ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]="DejaVuSansMono.ttf"
)

missing=0
for src in "${!FONTS[@]}"; do
  dst="$FULL/${FONTS[$src]}"
  if [[ -f "$dst" ]]; then
    echo "[fonts] present: ${FONTS[$src]}"
  elif [[ -f "$src" ]]; then
    cp "$src" "$dst"
    echo "[fonts] copied:  ${FONTS[$src]}"
  else
    echo "[fonts] MISSING: $src" >&2
    missing=1
  fi
done

if [[ $missing -ne 0 ]]; then
  cat >&2 <<'HINT'

[fonts] Some fonts were not found on this system.
        Debian/Ubuntu: sudo apt-get install fonts-noto-cjk fonts-dejavu-core
        Then re-run: npm run fetch-fonts
HINT
  exit 1
fi

echo "[fonts] OK. Verify integrity with: sha256sum -c fonts/MANIFEST.sha256"
