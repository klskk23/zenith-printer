# Fonts

字体二进制不入库（单个 19–26MB），改由 `scripts/fetch-fonts.sh` 从系统字体目录取得，
完整性由 `MANIFEST.sha256` 固定。

```bash
npm run fetch-fonts
# The manifest lists bare filenames and the fonts live in fonts/full/, so the
# check must run from that directory. Running it from the repository root
# reports "FAILED open or read" for every file — a path problem, not a corrupt
# download.
(cd fonts/full && sha256sum -c ../MANIFEST.sha256)
```

- `full/` —— 后端渲染使用的全量字体。宪章要求 `loadSystemFonts: false`，
  因此这些文件是渲染确定性的唯一来源。
- `subset/` —— 前端 `@font-face` 使用的 GB2312 子集，仅为控制首屏体积；
  字体族名必须与 `full/` 严格一致。生僻字在编辑器中可能显示为豆腐块，
  但实际打印结果以 `full/` 为准，正确无误。
- `Inter-*.otf` / `Inter-*.woff2` —— **界面字体**，只给西文与数字的界面文字用（尺寸、编号、
  英文界面）。它不是渲染字体：后端 `FONT_FAMILIES` 里没有它，编辑器也不把它列为标签字体——
  一张用它排版的标签会印成别的字体。子集只含 Latin，约 40 KB。来源是 Debian 的
  `fonts-inter` 固定包（SIL OFL 1.1）。

**校验失败即视为构建失败**——字体一旦漂移，同一模板在不同机器上的渲染结果就不再一致。
