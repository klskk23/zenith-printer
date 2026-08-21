#!/usr/bin/env python3
"""Generate the GB2312 woff2 subsets the editor loads.

Requires fonttools and brotli:
    python3 -m venv .venv && .venv/bin/pip install fonttools brotli
    .venv/bin/python scripts/subset-fonts.py

The backend renders with the full faces; the editor loads these subsets purely
to keep the first paint reasonable (the full CJK files are 19-26MB). A rare
glyph therefore shows as tofu in the editor while still printing correctly —
that tradeoff is recorded in the spec's assumptions.

Family names must stay identical to FONT_FAMILIES in
packages/server/src/render/fonts.ts, or the preview stops predicting the label.
"""
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont, TTCollection

ROOT = Path(__file__).resolve().parent.parent
FULL = ROOT / "fonts" / "full"
SUBSET = ROOT / "fonts" / "subset"

# GB2312 level 1+2: 6763 hanzi, plus ASCII and common punctuation.
def gb2312_text() -> str:
    chars = []
    for area in range(0x21, 0x78):
        for pos in range(0x21, 0x7F):
            try:
                chars.append(bytes([area + 0x80, pos + 0x80]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    ascii_range = "".join(chr(c) for c in range(0x20, 0x7F))
    punctuation = "　、。〈〉《》「」『』【】〔〕！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～￥…—·“”‘’"
    return ascii_range + punctuation + "".join(chars)


JOBS = [
    ("NotoSansCJK-Regular.ttc", "NotoSansCJKsc-Regular.woff2", "Noto Sans CJK SC"),
    ("NotoSansCJK-Bold.ttc", "NotoSansCJKsc-Bold.woff2", "Noto Sans CJK SC"),
    ("NotoSerifCJK-Regular.ttc", "NotoSerifCJKsc-Regular.woff2", "Noto Serif CJK SC"),
    ("DejaVuSansMono.ttf", "DejaVuSansMono.woff2", "DejaVu Sans Mono"),
]


def pick_face(path: Path, family: str) -> TTFont:
    if path.suffix.lower() != ".ttc":
        return TTFont(str(path), lazy=False)
    collection = TTCollection(str(path), lazy=False)
    for font in collection.fonts:
        names = {n.toUnicode() for n in font["name"].names if n.nameID in (1, 16)}
        if family in names:
            return font
    raise SystemExit(f"{path.name}: no face named {family!r}; found {sorted(names)}")


def main() -> int:
    SUBSET.mkdir(parents=True, exist_ok=True)
    text = gb2312_text()
    missing = []

    for source_name, out_name, family in JOBS:
        source = FULL / source_name
        if not source.exists():
            missing.append(source_name)
            continue

        font = pick_face(source, family)
        options = subset.Options()
        options.flavor = "woff2"
        options.desubroutinize = True
        options.drop_tables += ["DSIG"]
        options.layout_features = ["*"]

        subsetter = subset.Subsetter(options=options)
        subsetter.populate(text=text)
        subsetter.subset(font)

        out = SUBSET / out_name
        font.flavor = "woff2"
        font.save(str(out))
        size_kb = out.stat().st_size // 1024
        print(f"[subset] {out_name}: {size_kb} KB")

    if missing:
        print(f"[subset] missing source fonts: {', '.join(missing)}", file=sys.stderr)
        print("[subset] run: npm run fetch-fonts", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
