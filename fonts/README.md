# Fonts

字体二进制不入库（单个 19–26MB），改由 `scripts/fetch-fonts.sh` 从系统字体目录取得，
完整性由 `MANIFEST.sha256` 固定。

```bash
npm run fetch-fonts
sha256sum -c fonts/MANIFEST.sha256
```

- `full/` —— 后端渲染使用的全量字体。宪章要求 `loadSystemFonts: false`，
  因此这些文件是渲染确定性的唯一来源。
- `subset/` —— 前端 `@font-face` 使用的 GB2312 子集，仅为控制首屏体积；
  字体族名必须与 `full/` 严格一致。生僻字在编辑器中可能显示为豆腐块，
  但实际打印结果以 `full/` 为准，正确无误。

**校验失败即视为构建失败**——字体一旦漂移，同一模板在不同机器上的渲染结果就不再一致。
