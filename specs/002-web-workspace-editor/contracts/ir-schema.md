# 契约：标签 IR schema 变更

**Feature**: `002-web-workspace-editor`

本文只列出**相对 001 的变更**。判别联合的既有成员（text/barcode/qrcode/image/line/rect）
除下述字段外保持不变。

---

## 1. 新增成员：`ellipse`

```ts
{
  id: string
  type: 'ellipse'
  xMm: number            // > 0 校验由画布边界负责，此处仅要求有限数
  yMm: number
  widthMm: number        // > 0
  heightMm: number       // > 0
  rotation: 0 | 90 | 180 | 270
  strokeWidthDots: number  // 整数 ≥ 1
  filled: boolean
}
```

**渲染契约**

- 未填充时按**中心描边**绘制，并按 `strokeWidthDots / 2` 内缩，
  使外边缘与声明的包围盒重合（与 `rect` 现有做法一致）。
- `strokeWidthDots ≥ min(widthDots, heightDots)` 时渲染为填充椭圆，
  **不报错**、**不改写入参**（FR-085）。

---

## 2. `text`：多行

**字段不变。** `content` 允许包含 `\n`。

**渲染契约**

```
<text ...>
  <tspan x="{x}" y="{baseline + 0 × lineHeight}">第一行</tspan>
  <tspan x="{x}" y="{baseline + 1 × lineHeight}">第二行</tspan>
  ...
</text>
```

- **MUST 使用绝对 `x` / `y`，MUST NOT 使用相对 `dy`。**
  三种写法在 resvg 下逐像素一致（research.md R5），
  选择绝对定位是为了不依赖渲染器对 `dy` 累积语义的解释——浏览器一侧同样要读这份 SVG。
- `lineHeight = round(1.2 × fontSizeMm → dots)`。
- 拆行 **MUST** 为纯 `split('\n')`，**MUST NOT** 引入任何字体度量。
- `text-anchor`（对齐）沿用既有逻辑，逐行套用。

---

## 3. `barcode`：模块宽度成为元素属性

```ts
{
  // ... 既有字段
  moduleWidthDots: number   // 新增：整数 ≥ 2
}
```

**渲染契约**

- 实际宽度 `= moduleWidthDots × moduleCount`，`moduleCount` 由内容与码制决定。
- `widthMm` **不再参与渲染**，降级为供越界检查使用的派生/预估值。
- **MUST NOT 缩放** bwip-js 的输出——非整数缩放会破坏整点对齐。
- `moduleWidthDots` 允许**任意**整数 ≥ 2，含奇数（research.md R4 已推翻偶数限制）。

**移除**：`IrToSvgOptions.barcodeModuleWidthDots` 全局选项。

---

## 4. `qrcode`：改为真正的二维码

```ts
{
  // ... 既有字段
  moduleWidthDots: number   // 新增：整数 ≥ 2
}
```

**渲染契约**

- **MUST** 使用二维码 bcid 生成，**MUST NOT** 使用任何一维码制。
  （现状为硬编码 `symbology: 'code128'`，是本次要修的硬伤。）
- `errorCorrectionLevel` **MUST** 传递给生成器；它会影响矩阵大小
  （实测 L/M/Q → 50 单位，H → 58 单位）。
- 边长 `= moduleWidthDots × moduleCount`，同样量化。
- 缩放时向下取整到可达边长，保证 **MUST NOT** 超出声明尺寸。

---

## 5. 几何：旋转包围盒

新增共享函数（`@zenith/shared/geometry`）：

```ts
rotatedBounds(element): { xMm, yMm, widthMm, heightMm }
```

**契约**

- `rotation ∈ {0, 180}` → 宽高不变。
- `rotation ∈ {90, 270}` → **宽高互换**。
- 旋转围绕元素中心；中心不变，左上角据新宽高重算。

**MUST 由前端越界提示与后端打印前校验共用同一份实现。**
两处各写一份必然导致「编辑器说没问题、打印时说超界」的分歧。

---

## 6. 兼容性

| 既有数据 | 处理 |
|---|---|
| 无 `moduleWidthDots` 的条码 | 取 2 —— 恰为现行全局默认值，渲染结果不变 |
| 无 `moduleWidthDots` 的二维码 | 取 2；**但渲染结果必然改变**——原本就是错的（渲染成了条码） |
| 单行文本 | `split('\n')` 得到单元素数组，行为与现状一致 |
| 无 `ellipse` 的旧模板 | 不受影响 |
