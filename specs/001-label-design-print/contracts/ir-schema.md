# 契约：Label IR 与渲染管线

**Feature**: 001-label-design-print

Label IR 是标签设计的唯一权威表示。**`ir-to-svg` 必须由前后端共用同一份实现**——
这是预览与实物一致性的唯一保证，也是 `@zenith/shared` 包存在的理由。

---

## 渲染管线

```
IR (JSON, mm)
  │
  └─[ @zenith/shared: ir-to-svg ]──▶ SVG 字符串      ← ★ 这一步前后端零差异
        │                             (条码片段由 bwip-js toSVG 内嵌)
        ├── 前端：塞进 DOM，浏览器渲染        → 编辑器实时预览
        └── 后端：resvg-js（打包字体）        → RenderedImage.pixels (RGBA)
                    └─▶ 偏移平移 ─▶ 二值化 ─▶ BinaryBitmap
                          ├─▶ NiimbotDriver（ImageEncoder）
                          └─▶ ZplDriver（^GF + :Z64:）
```

差异被压缩到「SVG → 像素」一步（浏览器 vs resvg）。前端以 `@font-face` 加载与后端
`fontFiles` **完全相同的字体文件**，字形亦一致。规格仅要求「近似」（FR-004），此设计实际
好于要求。

---

## 单位与坐标

**唯一实现位于 `@zenith/shared/units.ts`，任何地方不得重复实现。**

```ts
export const mmToDots = (mm: number, dpi: number): number =>
  Math.round(mm * dpi / 25.4)
```

三条不可违反的规则（宪章「单位约定」）：

1. **取整一律 `round`，禁用 `floor`** —— `50 × 203 / 25.4 = 399.6`，round 得 400、floor 得 399
2. **画布尺寸先转整数 dot，元素坐标基于该 dot 网格计算** —— 禁止每个元素独立从 mm 换算，
   否则误差累积，右边缘元素可能偏移 2–3 dot
3. **UI 上偏移与线宽按 dot 步进呈现** —— 203dpi 下 1 dot = 0.125mm，让用户敲 0.125 的倍数
   是反人类的

SVG 的 `viewBox` 以 **dot** 为单位（而非 mm），使 SVG 坐标系与最终像素网格 1:1 对应——
这是水平/垂直线能精确落在像素行上的前提。

---

## IR 结构

```ts
interface LabelIR {
  widthMm: number
  heightMm: number
  dpi: number
  elements: LabelElement[]
}
```

元素为判别联合，`type` 为判别键。公共字段：`id`、`type`、`xMm`、`yMm`、`rotation`。
完整字段见 [`data-model.md`](../data-model.md#labelelement标签元素)。

内容字段可为字面量或可变字段引用：

```ts
type Content = string | { $var: string }    // { $var: "partNo" }
```

**渲染前必须先做变量替换**：`resolveVariables(ir, values) → LabelIR`（内容全为字面量）。
设计器预览用 `sampleValue`（`manual`）或 `seqStart`（`sequence`）；打印时用实际取值。

---

## 二值化约束

这些约束在 **zod schema 层面**强制，而非靠约定：

| 规则 | 原因 |
|---|---|
| `strokeWidthDots` 为整数、最小 1 | 小于 1 dot 的线经抗锯齿 + 阈值后**整条消失** |
| 水平/垂直线坐标 snap 到整数 dot 网格 | 否则线被摊到两行像素，二值化后变两条淡线或消失 |
| **schema 不暴露** 半透明 / 渐变 / 阴影 | 二值化后行为不可预测 |
| 斜线锯齿接受 | 热敏打印本就是点阵，无解 |

二值化：`gray = 0.299R + 0.587G + 0.114B`，`gray < threshold`（默认 128）判为黑。
阈值可配置，供实测第 7 项调优。

---

## 字体

```ts
new Resvg(svg, {
  font: {
    loadSystemFonts: false,          // ★ 宪章硬性要求，不得改为 true
    fontFiles: ['fonts/full/NotoSansSC-Regular.ttf', /* ... */],
    defaultFontFamily: 'Noto Sans SC',
  },
})
```

**可选字体是固定集合**（FR-007），前后端必须一致：

| 字体 | 后端（`fonts/full/`） | 前端（`fonts/subset/`） |
|---|---|---|
| 黑体 Regular / Bold | 全量 | GB2312 子集（约 2–3MB） |
| 宋体 Regular | 全量 | GB2312 子集 |
| 等宽 Regular | 全量 | 全量（体积小） |

前端用子集是为首屏体积；后端用全量保证实物正确。**代价：生僻字在编辑器中显示为豆腐块，
但打印结果正确**——已在规格 Assumptions 中声明。

---

## 偏移校正

在**渲染阶段**以位图整体平移实现，**不使用设备原生指令**（如 ZPL `^LH` / `^LT`）。

理由：两条链路行为一致，且预览能准确反映偏移，用户无需试打即可判断效果（FR-028）。
超出画布的内容**静默裁剪**，前端以红色标示被裁区域——不弹错误挡住用户操作。

---

## 条码

`bwip-js` 的 `toSVG(opts): string` 在浏览器与 Node 构建中均可用，因此可置于 `shared` 包。

生成的 SVG 片段内嵌进主 SVG。**模块宽度必须对齐到整数 dot**——这是条码可扫描性
（SC-002，≥99%）的关键：203dpi 下模块宽度取整误差会直接导致扫描失败，这是标签打印最经典的坑。

后续优化路径（**IR 层不变**）：`ZplDriver` 可将条码改为原生 `^BC` / `^BQ`，由打印机自行
对齐点阵。首版统一走位图，先跑通端到端。

---

## 契约测试要点

| # | 断言 |
|---|---|
| 1 | `mmToDots(50, 203) === 400`（round 而非 floor） |
| 2 | 同一 IR 两次渲染输出**逐字节一致**（确定性，SC-010） |
| 3 | 元素坐标基于画布 dot 网格计算，右边缘元素无累积偏移 |
| 4 | 1 dot 线宽在输出位图中**确实可见**（至少一整行像素为黑） |
| 5 | 水平线 snap 后恰好占据一整行像素，不跨两行 |
| 6 | `resolveVariables` 不修改原 IR（纯函数） |
| 7 | 条码模块宽度为整数 dot |
| 8 | 偏移平移后越界内容被裁剪，且裁剪区域可被查询（供前端标示） |
| 9 | 画布宽度超出 `printheadPixels` 时 schema 校验失败 |
| 10 | 前端与后端对同一 IR 生成的 **SVG 字符串完全相同**（共享模块的核心保证） |

第 2 与第 10 条是宪章「渲染确定性」的直接验收项，**必须在 CI 中运行**。
