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


# The interface face for Latin text and numerals. Not a render font: the
# label renderer never sees it, so it needs no CJK and no GB2312 — ASCII plus
# the Latin-1 and General Punctuation blocks cover every string the chrome
# shows in it (measurements, ids, the odd English word).
def latin_text() -> str:
    return "".join(chr(c) for c in range(0x20, 0x7F)) + "".join(
        chr(c) for c in list(range(0xA0, 0x100)) + list(range(0x2000, 0x2070))
    )


# source file, output file, family name inside the source, character set
JOBS = [
    ("NotoSansCJK-Regular.ttc", "NotoSansCJKsc-Regular.woff2", "Noto Sans CJK SC", "gb2312"),
    ("NotoSansCJK-Bold.ttc", "NotoSansCJKsc-Bold.woff2", "Noto Sans CJK SC", "gb2312"),
    ("NotoSerifCJK-Regular.ttc", "NotoSerifCJKsc-Regular.woff2", "Noto Serif CJK SC", "gb2312"),
    ("DejaVuSansMono.ttf", "DejaVuSansMono.woff2", "DejaVu Sans Mono", "gb2312"),
    ("Inter-Regular.otf", "Inter-Regular.woff2", "Inter", "latin"),
    ("Inter-Medium.otf", "Inter-Medium.woff2", "Inter", "latin"),
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
    texts = {"gb2312": gb2312_text(), "latin": latin_text()}
    missing = []

    for source_name, out_name, family, charset in JOBS:
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
        subsetter.populate(text=texts[charset])
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
