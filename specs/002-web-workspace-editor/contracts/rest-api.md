# 契约：REST API 变更

**Feature**: `002-web-workspace-editor`

沿用既有约定（宪章 III.A）：字段 camelCase；错误体为 `{ code, what, why, next }`；
状态码稳定。本文只列变更。

---

## 1. 打印机偏移

### `PATCH /api/printers/:id`

请求体新增：

```json
{ "offsetXDots": 0, "offsetYDots": 0 }
```

- 整数，可正可负；单位为 dot。
- 正值方向：`offsetXDots` 向右，`offsetYDots` 向下。
- 界面以「上/右/下/左」四个方向呈现，相对方向互斥（FR-092）；
  换算在前端完成，接口只收两个有符号值。
- 校验：绝对值不得超过打印头像素数（否则内容会被整体推出纸外）。

响应中的 `printer` 对象同步包含这两个字段。

### `POST /api/printers/:id/calibration-page`

打印一张校正页。**消耗纸张**，沿用与普通打印相同的确认规则（FR-056）。

请求体：

```json
{ "profileId": "...", "confirmed": true }
```

- `confirmed` 缺失或为 `false` → **400** `CONFIRMATION_REQUIRED`。
- 打印机不可达 → **503** `PRINTER_UNREACHABLE`。
- 成功 → **202**，返回任务 id，走既有打印队列（长任务非阻塞）。

---

## 2. Profile 字段变更

### `POST /api/printers/:id/profiles` / `PATCH /api/profiles/:id`

**新增**：

```json
{
  "labelWidthMm": 50,
  "labelHeightMm": 30,
  "marginTopMm": 0,
  "marginRightMm": 0,
  "marginBottomMm": 0,
  "marginLeftMm": 0
}
```

**移除**：`offsetXMm`、`offsetYMm`（迁往打印机）。

- 纸张尺寸必填且 > 0。
- 四个边距默认 0，不得为负。
- 校验：边距之和不得超过对应方向的纸张尺寸。

---

## 3. 模板并发控制

### `PATCH /api/templates/:id`

请求体新增：

```json
{ "version": 3 }
```

即**载入时**取得的版本号。

| 情形 | 状态码 | code |
|---|---|---|
| 版本匹配，保存成功 | 200 | — （响应含新的 `version`） |
| 版本不匹配（他处已修改） | **409** | `TEMPLATE_VERSION_CONFLICT` |
| 缺少 `version` 字段 | 400 | `VALIDATION_FAILED` |

**409 的错误体**须按三要素表达，并在 `next` 中给出重新加载的指引。
服务端 **MUST NOT** 在冲突时做任何写入——使用者的编辑内容由前端保留（FR-082）。

### `GET /api/templates/:id`

响应新增 `version` 字段。

---

## 4. 打印前批量校验

### `POST /api/print-jobs/preflight`（新增）

对**每一张**标签的真实内容执行越界检查（FR-069），**只报告不提交**。
供前端在提交前把越界情况摊给使用者看。

```json
{
  "warnings": [
    { "rowIndex": 7, "elementId": "barcode-1", "reason": "BARCODE_TOO_WIDE",
      "actualWidthMm": 62.4, "availableWidthMm": 50.0 }
  ]
}
```

- **MUST 列出全部越界行**，不得只报第一个（FR-090）。
- 始终返回 **200**——这是一次查询，不是一次校验失败。

### `POST /api/print-jobs`

| 情形 | 状态码 | code |
|---|---|---|
| 提交成功（含存在越界的批次） | 202 | — |

- 越界 **MUST NOT** 阻断提交或打印（FR-067、FR-089）。
- **MUST NOT** 因越界跳过批次中的任何一张。
- 越界明细 **MUST** 随任务记录，并可经打印历史回看（FR-091）。
- 超出标签边界的内容按既有规则**裁切**（与 `render/offset.ts` 现行策略一致）。

> **不存在 `LABEL_OVERFLOW` 这一失败码。** 越界是任务上的一条警告属性，
> 不是一种拒绝理由。

---

## 5. 文案本地化

所有返回 `{ code, what, why, next }` 的端点：

- **MUST** 读取请求的 `Accept-Language` 头选择文案语言。
- 支持 `zh-CN` 与 `en-US`；无法识别时回退 `zh-CN`。
- `code` 字段**不随语言变化**——它是机器可读的稳定标识。

---

## 6. 兼容性

| 变更 | 破坏性 | 说明 |
|---|---|---|
| Profile 移除偏移字段 | 是 | 由迁移处理；无外部消费者 |
| 模板保存要求 `version` | 是 | 前端同步更新；CLI 不涉及模板保存 |
| 新增 `POST /api/print-jobs/preflight` | 否 | 纯新增端点，既有路径不变 |
| 越界不再影响打印任务的状态码 | 否 | 越界从未是失败理由；提交路径保持 202 |
