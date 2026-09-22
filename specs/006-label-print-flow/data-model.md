# Data Model: 标签工作流与说明文字清理

**Feature**: `006-label-print-flow` | **Date**: 2026-09-22

没有持久化实体，也没有服务端字段变化。下面是前端的状态形状与纯函数的契约。

## 1. 页面与步骤

```ts
// app/routes.ts
export type PageKind =
  | 'labels' | 'data-sources' | 'printers' | 'queue' | 'history'
  | 'print-presets' | 'settings'
  | 'label' | 'label-print' | 'label-confirm'   // ← 后两个是新增
  | 'data-source' | 'api-docs'

export interface PageDescriptor {
  kind: PageKind
  templateId?: string | null   // label / label-print / label-confirm；null = 尚未保存
  dataSourceId?: string
  presetId?: string            // 只在 label* 上；来自 ?preset=
}
```

地址：

| kind | 地址 |
|---|---|
| `labels` | `/` |
| `label` | `/labels/{id}`；未保存为 `/labels/new` |
| `label-print` | `/labels/{id}/print`；未保存为 `/labels/new/print` |
| `label-confirm` | `/labels/{id}/confirm`；未保存为 `/labels/new/confirm` |

`?preset={id}` 可挂在上面三种 label 地址的任意一个后面。

## 2. 步骤（Step）

```ts
// features/print/flow.ts
export type StepId = 'labels' | 'design' | 'print' | 'confirm'
export type StepState = 'past' | 'current' | 'ahead' | 'blocked'

export interface Step {
  id: StepId
  ordinal: 1 | 2 | 3 | 4
  state: StepState
}

export function stepsFor(input: {
  page: PageKind
  canSubmit: boolean   // 选了打印机，且（未绑数据源 或 有勾选的行）
}): readonly Step[]
```

规则：

- 当前步由 `page` 决定：`labels` → ①，`label` → ②，`label-print` → ③，`label-confirm` → ④
- 序号小于当前步的是 `past`（可点）
- 序号大于当前步的是 `ahead`（不可点），但 ④ 在 `canSubmit === false` 时是 `blocked`（不可点且视觉更淡）
- `labels` 之外的页面，② ③ 恒为可达（有标签就能改、就能打）

## 3. 打印选择（PrintSelection）

会话（`editor-page.tsx`）持有，三步共用：

```ts
interface PrintSelection {
  printerId: string | null
  profileId: string | null
  copies: number                // 每行份数，≥ 1
  selection: Selection          // 沿用 features/print/selection.ts
  keyByOrdinal: ReadonlyMap<number, string>   // 带 key 列的表跨页累积
}
```

- 提交成功后：`selection` 归零，`printerId` / `profileId` / `copies` 保留（FR-056）
- 刷新页面即全部回到初始（内存态，FR 的边界情形已列明）

## 4. 合计（Tally）

```ts
export interface Tally {
  labels: number        // 张数
  seconds: number       // 预估耗时，向上取整
}

export function tally(input: {
  boundRows: number | null   // null = 未绑数据源
  chosenRows: number
  copies: number
}): Tally
```

- 未绑数据源：`labels = copies`
- 绑了数据源：`labels = chosenRows × copies`
- `seconds = ceil(labels × MS_PER_LABEL / 1000)`，`MS_PER_LABEL = 1200`
  —— 一个保守常量（见 research.md §5）。它是数量级提示：文案写「约 N 秒」，没有任何地方把它当承诺。

## 5. 裁切风险（ClipRisk）

```ts
export interface ClipRisk {
  /** 有几张标签会被裁 */
  affected: number
  /** 最大超出量，毫米，保留一位小数 */
  overflowMm: number
  /** 标签比打印头宽多少毫米；0 表示装得下 */
  beyondHeadMm: number
  /** 打印机从未探测过，无法判断 */
  unprobed: boolean
}

/** 全都没问题时返回 null——「确认」页据此决定那一行出不出现。 */
export function clipSummary(input: {
  warnings: readonly OverflowWarning[]   // 来自 POST /print-jobs/preflight
  labelWidthMm: number
  capabilities: PrinterCapabilities | null
}): ClipRisk | null
```

## 6. 阻塞原因（BlockReason）

从对话框原样搬过来，作为纯函数，供「打印」页的「继续」与「确认」页的「确认打印」共用：

```ts
export function blockReason(input: {
  printer: Printer | null
  unresolved: readonly string[]
  dataSourceId: string | null
  chosenRows: number
  labels: number
}): string | null
```

依次判断：没选打印机 → 打印机未探测 → 有解析不出的引用 → 绑了数据源却没勾选 → 超过单任务上限（`MAX_LABELS_PER_JOB`）。返回 i18n 里的一句话或 `null`。

## 7. 说明档位（HintTier）

不是运行时实体，是一张交付期的清单（`contracts/hint-tiers.md`）。形状：

```ts
type HintTier = 'principle' | 'howto' | 'must-keep'
interface HintEntry {
  key: string        // i18n 键路径，如 dataSources.explain
  where: string      // 现在渲染在哪
  tier: HintTier
  action: 'delete' | 'into-hint' | 'keep'
  target?: string    // into-hint 时：挂在哪个标题或字段旁
}
```

测试用清单里的键名逐条核对：`delete` 的键不再存在于 i18n，`into-hint` 的键仍存在但只被 `<Hint>` / `<ValueHint>` 引用，`keep` 的键渲染位置不变。
