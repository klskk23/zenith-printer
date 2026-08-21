# Phase 1：数据模型

**Feature**: 001-label-design-print | **Date**: 2026-08-20

字段名一律 camelCase（宪章 III.A）。所有物理尺寸以 **mm** 存储（宪章「单位约定」），
渲染时按 `dot = round(mm × dpi / 25.4)` 换算。

---

## 实体关系

```
Printer 1 ──── n Profile
   │
   │ 1                        Template n ──── n VariableField
   │                              │ 1
   │ n                            │ n
PrintJob n ──────────────────── 1 ┘
   │
   └── 持有 ContentSnapshot（自包含，不随上游变更漂移）

ImageAsset ◄──── 被 Template 的 image 元素与 PrintJob 快照引用（引用计数）
```

依赖方向单一：`Template` 与 `Profile` 都不知道对方存在，二者在打印时由 `PrintJob` 组合。
这是 FR-027、FR-031 的结构保证——参数变更在结构上就不可能触及模板。

---

## Printer（打印机）

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `id` | string (uuid) | 系统 | |
| `name` | string | 手填 | 显示名，如「仓库-精臣」 |
| `kind` | `'niimbot' \| 'zpl'` | 手填 | 决定驱动实现（FR-024） |
| `transport` | `'serial' \| 'tcp'` | 手填 | |
| `address` | string | 手填 | `/dev/ttyACM0` 或 `192.168.1.50:9100` |
| `printTaskName` | string \| null | 手填 | 仅 niimbot；B3S_P 为 `B1`。探测不可靠故手选（FR-024） |
| `dpi` | int | **探测** | FR-025 |
| `printheadPixels` | int | **探测** | 最大打印宽度，B3S_P 为 576 |
| `densityMin` / `densityMax` / `densityDefault` | int | **探测** | |
| `paperTypes` | int[] | **探测** | |
| `printDirection` | `'top' \| 'left'` | **探测** | |
| `supportsConsumableLevel` | boolean | **探测** | 是否具备耗材余量上报（FR-015 / FR-016） |
| `model` / `serial` / `firmwareVersion` | string \| null | **探测** | 脱敏后用于日志（原则 V） |
| `queueState` | `'running' \| 'paused'` | 系统 | FR-021、FR-022 |
| `queuePausedReason` | string \| null | 系统 | 区分手动暂停与故障暂停 |
| `lastProbedAt` | timestamp \| null | 系统 | |

**约束**

- `maxLabelWidthMm = printheadPixels / dpi × 25.4`（B3S_P ≈ 72.1mm）——创建模板时的宽度上限（FR-005）
- `minStrokeWidthMm = 25.4 / dpi`（203dpi ≈ 0.125mm）——最小可成像线宽（FR-008）
- 删除前置条件：无排队中任务（FR-052），否则 `409`
- 硬件参数一律来自探测，**禁止硬编码**（宪章「硬件兼容性」）

## Profile（打印参数）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string (uuid) | |
| `printerId` | string → Printer | |
| `name` | string | 如「厚纸-高密度」 |
| `density` | int | 受 `densityMin..densityMax` 约束 |
| `labelType` | int | 介质类型（gap / 黑标 / 连续） |
| `speed` | int \| null | 仅部分机型支持 |
| `offsetXMm` / `offsetYMm` | number | 位置偏移校正（FR-026）。**存 mm，UI 按 dot 步进**（FR-029） |
| `isDefault` | boolean | 每台打印机至多一个 |

**约束**：偏移在**渲染阶段**以位图平移实现，不使用设备原生指令（如 ZPL `^LH`）——
这样两条链路行为一致，且预览能准确反映偏移（FR-028）。超出画布的内容静默裁剪，
前端以红色标示被裁区域。

## Template（标签模板）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string (uuid) | |
| `name` | string | |
| `printerKind` | `'niimbot' \| 'zpl'` | 绑定**类别**而非具体设备，同类别多台可共用（FR-032） |
| `widthMm` / `heightMm` | number | 画布物理尺寸 |
| `dpi` | int | 设计时的目标 dpi，用于 dot 网格对齐 |
| `elements` | LabelElement[] | JSON 列 |
| `updatedAt` | timestamp | 并发编辑的乐观检查依据 |

**约束**：`widthMm` 不得超过目标类别下任一打印机的 `maxLabelWidthMm`。
不做版本历史，保存即覆盖（Assumptions）。

## LabelElement（标签元素）

判别联合，`type` 为判别键。公共字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 模板内唯一 |
| `type` | `'text' \| 'barcode' \| 'qrcode' \| 'image' \| 'line' \| 'rect'` | |
| `xMm` / `yMm` | number | 相对标签左上角 |
| `widthMm` / `heightMm` | number | `line` 除外 |
| `rotation` | `0 \| 90 \| 180 \| 270` | |

分型字段：

| 类型 | 专属字段 |
|---|---|
| `text` | `content: string \| VariableRef`、`fontFamily`、`fontSizeMm`、`bold`、`align` |
| `barcode` | `content: string \| VariableRef`、`symbology`（如 `code128`）、`showHumanReadable` |
| `qrcode` | `content: string \| VariableRef`、`errorCorrectionLevel` |
| `image` | `assetId → ImageAsset`、`fit` |
| `line` | `x2Mm`、`y2Mm`、`strokeWidthDots: int` |
| `rect` | `strokeWidthDots: int`、`filled: boolean`、`cornerRadiusMm` |

**二值化约束**（宪章「单位约定」与 FR-008 的直接产物）

- `strokeWidthDots` 为**整数 dot**，最小 1 —— 小于 1 dot 的线经抗锯齿 + 阈值后会整条消失
- 水平/垂直线坐标 **snap 到整数 dot 网格** —— 否则线被摊到两行像素，二值化后变淡线或消失
- **不提供**半透明、渐变、阴影 —— 二值化后行为不可预测，schema 层面即不暴露
- 斜线锯齿接受，热敏打印本就是点阵

## VariableField（可变字段）

`VariableRef` 是元素内容指向本表的引用（`{ fieldName: string }`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `templateId` | string → Template | |
| `name` | string | 模板内唯一，英文标识符 |
| `label` | string | 表单显示名（经 i18n） |
| `source` | `'manual' \| 'sequence'` | FR-042 |
| `sampleValue` | string | `manual` 专用，设计预览用（FR-039） |
| `seqStart` | int | `sequence` 专用，配置起始值 |
| `seqDigits` | int | `sequence` 专用，位数，不足补零（FR-043） |
| `seqStep` | int | `sequence` 专用，步长 |
| `seqConsumedMax` | int \| null | `sequence` 专用，历史已消耗最大值，用于生成建议起始值（FR-048） |

**取值语义**（FR-044）

- `manual`：打印前用户填写，**本次任务全部份数共用同一值**
- `sequence`：任务内**逐份递增**，每份取值互不相同

**约束**

- `sequence` 字段的最大可表示值为 `10^seqDigits - 1`；任务区间上界超出即拒绝（FR-046），
  **不静默截断或回绕**
- `seqConsumedMax` 由已完成/已失败任务的区间上界推导

## PrintJob（打印任务）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string (uuid) | |
| `idempotencyKey` | string | 唯一索引，防刷新重复提交（FR-017） |
| `printerId` / `templateId` / `profileId` | string \| null | 上游删除后置 null，历史靠快照自洽 |
| `requestedCopies` | int | 1..100 |
| `pagesPrinted` | int \| **null** | **null 表示「未知」**（服务异常重启，FR-053） |
| `manualFieldValues` | Record<string,string> | 本次手工填入的取值（FR-041） |
| `seqRanges` | Record<string, {start:int, end:int, step:int}> | 本次锁定的序号区间（FR-045、FR-049） |
| `status` | JobStatus | 见状态机 |
| `failureCode` / `failureMessage` | string \| null | 设备错误码经 i18n 映射（FR-034） |
| `snapshot` | ContentSnapshot | **JSON 列**，见下（FR-050） |
| `createdAt` / `startedAt` / `finishedAt` | timestamp \| null | |

### ContentSnapshot（内容快照）

FR-050 的载体。任务创建时冗余写入，此后**永不随上游变更而改动**——这同时解决删除引用完整性
与历史漂移两个问题。

```
{
  templateName, widthMm, heightMm, dpi, printerKind,
  elements: LabelElement[],        // 完整副本
  profile: { name, density, labelType, speed, offsetXMm, offsetYMm },
  printerName, printerModel,
  imageAssetIds: string[]          // 引用计数依据，保证 FR-051
}
```

### JobStatus 状态机

```
                  ┌────────────────────────────────────┐
                  │            queued                  │
                  └──┬──────────────┬──────────────┬───┘
        用户取消 ────┘              │              └──── 设备不可达 / 预检失败
              ▼                     │ 调度器取出              ▼
         ┌─────────┐                ▼                   ┌─────────┐
         │cancelled│          ┌──────────┐              │ failed  │
         └─────────┘          │ printing │              └─────────┘
                              └──┬────┬──┘                   │
                    全部完成 ────┘    └──── 设备报错 / 服务重启
                          ▼                      ▼
                    ┌───────────┐          ┌─────────┐
                    │ completed │          │ failed  │──▶ 队列自动暂停
                    └───────────┘          └─────────┘
```

**迁移规则**

| 迁移 | 条件与副作用 |
|---|---|
| `queued → cancelled` | 任意用户可触发（不做认证）。**仅限未开始**（FR-019）。序号区间释放 |
| `queued → printing` | 队列非暂停 + 预检通过（在线 / 装纸 / 上盖 / 余量，FR-014、FR-015） |
| `queued → failed` | 设备不可达 → **立即失败，不重试**（FR-047）；余量不足（FR-015）；序号越界（FR-046） |
| `printing → completed` | `pagesPrinted === requestedCopies` |
| `printing → failed` | 设备报错。记录 `pagesPrinted` 供精确补打（FR-020） |
| `printing → failed`（重启） | **启动期清理**：`pagesPrinted = null`、序号区间视为全消耗、队列暂停（FR-053） |
| 任意 `→ failed` | **副作用：该打印机 `queueState = 'paused'`**（FR-021） |

`completed` / `cancelled` / `failed` 为终态，**不自动重试**（FR-021）。

## ImageAsset（图片资源）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string (uuid) | |
| `filename` / `mimeType` / `sizeBytes` | | |
| `storagePath` | string | 磁盘路径，二进制不入库 |
| `refCount` | int | 被模板元素与任务快照引用的计数 |
| `deletedAt` | timestamp \| null | **软删除**：`refCount > 0` 时仅标记，保证 FR-051 |

图片是唯一采用软删除的实体——因为快照能冗余文本与数值，但无法冗余二进制。

---

## 校验规则汇总

| 时机 | 校验 | FR |
|---|---|---|
| 创建/编辑模板 | 画布宽度 ≤ `maxLabelWidthMm` | FR-005 |
| 创建/编辑模板 | `strokeWidthDots ≥ 1` | FR-008 |
| 创建/编辑模板 | 元素越界 → 标示裁切区域（警示，不阻断） | FR-006 |
| 创建/编辑模板 | 条码内容符合码制规则 | FR-010 |
| 提交任务 | 所有 `manual` 字段已填 | FR-038 |
| 提交任务 | 字段值经码制校验与越界校验 | FR-040 |
| 提交任务 | 序号区间上界 ≤ `10^seqDigits - 1` | FR-046 |
| 提交任务 | 余量 ≥ 份数（`supportsConsumableLevel` 为真时） | FR-015 |
| 提交任务 | 模板 `printerKind` 与目标打印机匹配 | FR-032 |
| 删除打印机 | 无排队中任务 | FR-052 |

全部校验在 zod schema 与领域层完成，**打印任何一张之前**——这是 FR-015、FR-040、FR-046
共同的措辞，也是耗材保护的核心。
