# 契约：REST API

**Feature**: 001-label-design-print

遵循宪章原则 III.A。字段一律 camelCase；同类失败恒定使用同一状态码；所有请求体与查询参数
经 zod schema 校验后方进入业务逻辑。

## 通用约定

**基址**：`/api`

**错误响应结构**（所有非 2xx 统一，FR-033、FR-034）

```jsonc
{
  "code": "PRINTER_UNREACHABLE",   // 机器可读，稳定
  "what": "打印机「仓库-精臣」无法连接",
  "why":  "设备可能已关机或未接好数据线",
  "next": "请到设备旁按下电源键开机后重新提交"
}
```

`code` 是稳定契约，前端据此分支；`what` / `why` / `next` 经 i18n 层生成，**绝不透传设备原始
错误编号或堆栈**。

**状态码语义**（稳定，同类失败恒定）

| 码 | 含义 | 典型场景 |
|---|---|---|
| `200` / `201` | 成功 | |
| `400` | 请求格式或字段校验失败 | zod 解析失败 |
| `404` | 资源不存在 | |
| `409` | 与当前状态冲突 | 删除有排队任务的打印机；取消已在打印的任务 |
| `422` | 格式合法但违反业务规则 | 耗材余量不足；序号位数溢出；模板与打印机类别不匹配 |
| `503` | 设备不可达 | 打印机关机 / 离线 / 地址无响应 |

`409` 与 `422` 的分界：`409` 是**时机**问题（换个时间可能就成了），`422` 是**内容**问题
（不改内容永远不成）。

---

## 打印机

### `GET /api/printers`

返回全部打印机及其能力参数与队列状态。

### `POST /api/printers`

```jsonc
// 请求 —— 仅手填部分（FR-024）
{
  "name": "仓库-精臣",
  "kind": "niimbot",              // 'niimbot' | 'zpl'
  "transport": "serial",          // 'serial' | 'tcp'
  "address": "/dev/ttyACM0",
  "printTaskName": "B1"           // niimbot 必填；探测不可靠故手选
}
```

`201` 返回创建结果。能力参数此时为空，需调用探测。

### `POST /api/printers/:id/probe`

连接设备并回填 `dpi`、`printheadPixels`、密度范围、`supportsConsumableLevel` 等（FR-025）。

- `200` 探测成功，返回完整打印机对象
- `503` 设备不可达

### `DELETE /api/printers/:id`

- `204` 成功
- `409` **仍有排队任务**（FR-052），错误码 `PRINTER_HAS_QUEUED_JOBS`

### `PATCH /api/printers/:id/queue`

```jsonc
{ "queueState": "paused" }   // 'running' | 'paused'
```

手动暂停/恢复（FR-022）。暂停时**正在执行的任务继续至完成**，后续任务不再启动。

---

## 打印参数

`GET|POST /api/printers/:printerId/profiles` · `PATCH|DELETE /api/profiles/:id`

```jsonc
{
  "name": "厚纸-高密度",
  "density": 4,
  "labelType": 1,
  "speed": null,
  "offsetXMm": 0.375,     // 存 mm；UI 按 dot 步进呈现（FR-029）
  "offsetYMm": 0,
  "isDefault": false
}
```

`density` 超出该打印机 `densityMin..densityMax` → `422`。
参数变更**不触及任何模板**（FR-027）——这由数据结构保证，非约定。

---

## 模板

`GET|POST /api/templates` · `GET|PUT|DELETE /api/templates/:id`

```jsonc
{
  "name": "料号标签-50x30",
  "printerKind": "niimbot",
  "widthMm": 50,
  "heightMm": 30,
  "dpi": 203,
  "elements": [ /* LabelElement[]，见 ir-schema.md */ ],
  "variableFields": [
    { "name": "partNo",  "label": "料号", "source": "manual",   "sampleValue": "ABC-12345" },
    { "name": "serial",  "label": "序号", "source": "sequence",
      "seqStart": 1, "seqDigits": 3, "seqStep": 1 }
  ],
  "updatedAt": "2026-08-20T10:00:00Z"   // PUT 时回传，用于乐观检查
}
```

- `422` 画布宽度超出该类别打印机上限（FR-005）／线宽 < 1 dot（FR-008）／条码内容不合码制（FR-010）
- `409` `updatedAt` 与服务端不一致（并发编辑，提示而非静默丢弃）

### `GET /api/templates/:id/print-form`

返回本次打印需要填写的字段，含 `sequence` 字段的**建议起始值**（FR-048）。

```jsonc
{
  "fields": [
    { "name": "partNo", "label": "料号", "source": "manual", "sampleValue": "ABC-12345" },
    { "name": "serial", "label": "序号", "source": "sequence",
      "suggestedStart": 38,        // 依据历史已消耗最大值 037 推导
      "seqDigits": 3, "seqStep": 1, "maxRepresentable": 999 }
  ]
}
```

---

## 打印任务

### `POST /api/print-jobs`

**必须携带 `Idempotency-Key` 请求头**（FR-017）。重复键返回原任务而非新建——
打印是不可撤销的物理动作，刷新或重试不得重复消耗耗材与序号。

请求体支持**两种内容来源，二选一**：

```jsonc
// 形式 A —— 引用已保存的模板（US3 起可用）
{
  "printerId": "...",
  "templateId": "...",
  "profileId": "...",                      // 省略则使用打印机的 densityDefault
  "copies": 80,
  "manualFieldValues": { "partNo": "ABC-12345" },
  "sequenceOverrides": { "serial": 38 }    // 可选，覆盖建议起始值（FR-048）
}

// 形式 B —— 即席 IR，不落模板（US1 起可用）
{
  "printerId": "...",
  "ir": { "widthMm": 50, "heightMm": 30, "dpi": 203, "elements": [ /* ... */ ] },
  "copies": 1
}

// 形式 C —— 两者同时提供：打印这份内容，并记录它来自哪个模板
{
  "printerId": "...",
  "templateId": "...",
  "ir": { /* 编辑器当前的设计，可能包含尚未保存的修改 */ },
  "copies": 5,
  "manualFieldValues": { "partNo": "ABC-12345" }
}
```

**至少提供 `templateId` 或 `ir` 之一，两者可以同时提供**（zod `.refine` 强制）。

同时提供时，`ir` 决定**打印内容**，模板提供**变量字段与身份**：序号仍从该模板的
字段中领取（不会跳回起点），任务仍记录 `templateId`（历史仍说得出这批来自哪个模板）。

> 形式 C 是后加的。原先规定二者只能其一，听起来整齐，却与唯一存在的工作流相悖：
> 打开模板、修改、打印，只会发出模板 id，屏幕上的设计从不被传输，于是打出来的是
> **上一个版本**，而界面上没有任何地方说明这件事。修改后必须先保存才能看到实时
> 预览，也是同一个原因。

即席路径的存在使 User Story 1 **无需依赖模板与参数管理即可独立交付**——用户新建标签后直接打印，
不必先保存为模板。省略 `profileId` 时使用该打印机探测所得的 `densityDefault` 与默认介质类型。
两种形式产出的 `ContentSnapshot` 结构一致（形式 B 的 `templateName` 为 `null`）。

**`202 Accepted`** —— 立即返回，**不阻塞至打印完成**（FR-012）：

```jsonc
{
  "jobId": "...",
  "status": "queued",
  "queuePosition": 2,
  "seqRanges": { "serial": { "start": 38, "end": 118, "step": 1 } }
}
```

失败情形：

| 码 | 错误码 | 场景 |
|---|---|---|
| `422` | `INSUFFICIENT_CONSUMABLE` | 余量 42 < 请求 80，返回两个数字（FR-015） |
| `422` | `SEQUENCE_OVERFLOW` | 区间上界超出位数可表示范围（FR-046） |
| `422` | `FIELD_VALIDATION_FAILED` | 字段值不合码制或越界（FR-040） |
| `422` | `TEMPLATE_PRINTER_MISMATCH` | 模板类别与打印机不符（FR-032） |
| `503` | `PRINTER_UNREACHABLE` | 设备关机/离线。**立即失败，不重试**（FR-047） |

序号区间在**入队时于单事务内锁定**（FR-049），响应即回显，供用户核对。

### `GET /api/print-jobs?printerId=&status=`

任务列表，供前端轮询（FR-018）。

```jsonc
{
  "id": "...",
  "status": "printing",
  "requestedCopies": 80,
  "pagesPrinted": 37,          // null = 未知（服务异常重启，FR-053）
  "failureCode": null,
  "failureMessage": null,
  "seqRanges": { "serial": { "start": 38, "end": 118, "step": 1 } },
  "snapshot": { "templateName": "料号标签-50x30", "widthMm": 50, "heightMm": 30 },
  "createdAt": "...", "startedAt": "...", "finishedAt": null
}
```

`pagesPrinted` 是补打的唯一依据（FR-020）。**`null` 与 `0` 语义不同**——`null` 表示服务
异常重启导致无法确认，前端必须提示用户人工核对实物，不得显示为 0。

### `DELETE /api/print-jobs/:id`

取消任务。

- `204` 成功（仅 `queued`），序号区间释放
- `409` 任务已在打印中，错误码 `JOB_ALREADY_PRINTING`（FR-019）

### `GET /api/print-jobs/:id/preview`

返回该任务实际送往打印机的**二值化位图**（PNG），用于事后核对与排障。

---

## 预览与图片

### `POST /api/preview`

渲染一次而不打印。请求体同 `POST /api/print-jobs` 但不需 `copies` 与幂等键，
返回二值化 PNG。用于打印前确认与偏移校正效果验证（FR-028）。

### `POST /api/images` · `DELETE /api/images/:id`

上传/删除图片资源（FR-009）。删除时若 `refCount > 0` 则软删除，
保证历史快照引用的图片仍可解析（FR-051）。

---

## 契约测试要点

宪章原则 II 要求 REST 端点具备契约测试。以下为必须覆盖的断言：

1. 所有错误响应含完整四字段 `code` / `what` / `why` / `next`
2. `POST /api/print-jobs` 同一幂等键两次调用 → 返回同一 `jobId`，序号区间不重复消耗
3. 余量不足 → `422` 且响应体含剩余数量与请求数量两个具体数字
4. 设备不可达 → `503` 且**未产生任何打印动作**，队列转为 `paused`
5. 取消 `printing` 状态任务 → `409`，任务状态不变
6. 并发提交两个含序号的任务 → 两个 `seqRanges` 区间不重叠
7. 删除有排队任务的打印机 → `409`，打印机仍存在
8. 模板被修改后查询历史任务 → `snapshot` 内容不变（无漂移）
9. 两者都不提供 → `400`；同时提供 → `202`，打印 `ir` 的内容，任务仍归属该模板
9a. 同时提供且模板含序号字段 → 序号自该模板续领，不跳回起点
10. 仅提供 `ir` 且省略 `profileId` → 成功，快照中的参数取自打印机 `densityDefault`
11. 模板 `printerKind` 与目标打印机不符 → `422 TEMPLATE_PRINTER_MISMATCH`
12. 取消 `queued` 任务后，其序号区间可被下一个任务复用（不永久跳号）
