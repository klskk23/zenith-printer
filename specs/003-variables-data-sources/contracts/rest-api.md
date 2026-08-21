# 契约：REST 端点（新增与变更）

沿用既有约定（宪章 III.A）：JSON 字段 camelCase；同类失败始终同一状态码；错误响应
统一结构，含稳定错误码与中文三要素文案。

## 新增：数据源

### `GET /api/data-sources`

```jsonc
{ "dataSources": [
  { "id": "ds-1", "name": "订单表", "columns": ["订单号","收件人"], "rowCount": 240,
    "createdAt": "...", "updatedAt": "..." }
] }
```

### `GET /api/data-sources/:id/rows?page=1&pageSize=10`

分页读取。`ordinal` 是表内序号，行选择的 X-Y 指的就是它。

```jsonc
{ "rows": [ { "ordinal": 1, "values": { "订单号": "A-001", "收件人": "张三" } } ],
  "page": 1, "pageSize": 10, "total": 240 }
```

### `POST /api/data-sources` （multipart：CSV 文件）

字段：`file`、`name`、可选 `encoding`、可选 `delimiter`。

- `201` 建立成功
- `422 CSV_NO_HEADER` 无表头
- `422 CSV_DUPLICATE_COLUMN` 表头有重复列名，`details.columns` 列出重复项
- `422 CSV_TOO_MANY_ROWS` 超过 10,000 行，`details` 含 `rowCount` 与 `maxRows`
- `422 CSV_DECODE_FAILED` 编码无法确定，`details.tried` 列出尝试过的编码
- `409 DATA_SOURCE_NAME_TAKEN` 名称已被占用

### `POST /api/data-sources/:id/replace` （multipart：CSV 文件）

替换整表。若旧列在新文件中消失（FR-021a）：

- 未带 `confirm=true` → `409 DATA_SOURCE_COLUMNS_REMOVED`，`details.removedColumns`
  与 `details.affectedTemplates` 列出会断掉的设计
- 带 `confirm=true` → `200`

### `PATCH /api/data-sources/:id/rows`

站内编辑与粘贴的落点。请求体为行的增改删指令：

```jsonc
{ "upserts": [ { "ordinal": 3, "values": { "收件人": "李四" } } ],
  "deletes": [ 7, 9 ] }
```

- `422 DATA_SOURCE_UNKNOWN_COLUMN` 出现了表中没有的列——列名是引用路径的一部分，
  不能凭空新增（FR-049）
- `422 CSV_TOO_MANY_ROWS` 增行后超过上限

### `DELETE /api/data-sources/:id`

- 未带 `confirm=true` 且有设计引用它 → `409 DATA_SOURCE_IN_USE`，
  `details.affectedTemplates` 列出设计
- 否则 `204`

## 新增：序号池

### `GET /api/sequence-pools`

```jsonc
{ "pools": [
  { "id": "pool-1", "name": "整机流水", "digits": 6, "step": 1,
    "current": 741, "nextValue": 742 }
] }
```

`current` 由 `max(floor, 已消耗最大值)` 推导，不是存储字段。

### `POST /api/sequence-pools` / `PATCH /api/sequence-pools/:id`

可改 `name`、`digits`、`step`。**不能**用 PATCH 改 `current`。

### `POST /api/sequence-pools/:id/reset`

```jsonc
{ "floor": 1, "confirm": true }
```

- 未带 `confirm` → `422 CONFIRMATION_REQUIRED`
- 带 `confirm` → `200`，返回新的 `current`

重置可能导致与已印出标签重号，属于宪章 III.0 的「不可撤销操作」。

## 变更：打印任务

### `POST /api/print-jobs`

新增可选字段 `rowSelection`：

```jsonc
{ "printerId": "...", "ir": { }, "templateId": "...", "copies": 2,
  "rowSelection": { "all": true } }
{ "rowSelection": { "ranges": [[5, 12], [40, 40]], "ids": [3] } }
```

- 设计引用了数据源却未给 `rowSelection`，或选中 0 行 → `422 NO_ROWS_SELECTED`
- `所选行数 × copies > 1000` → `422 BATCH_TOO_LARGE`，`details` 含 `requested` 与 `maxLabels`
- 设计引用了两个数据源 → `422 MULTIPLE_DATA_SOURCES`
- 内容中有无法解析的引用 → `422 VARIABLE_NOT_DEFINED`，`details.reference` 指出是哪一个

**移除**：`manualFieldValues`、`sequenceOverrides`。

### `DELETE /api/templates/:id/print-form`

**整个端点移除**。它的职责（告诉前端有哪些字段要填）已不存在：常量与序号不询问取值，
数据源取值来自所选行。

### `POST /api/preview`

`variableValues` 替换为 `rowOrdinal`（可选）：预览指定序号的行；缺省为打印顺序上的
第一行（FR-041）。

## 错误码新增

| 码 | 状态 | 场景 |
|---|---|---|
| `CSV_NO_HEADER` | 422 | 无表头 |
| `CSV_DUPLICATE_COLUMN` | 422 | 表头重复列名 |
| `CSV_TOO_MANY_ROWS` | 422 | 超过 10,000 行 |
| `CSV_DECODE_FAILED` | 422 | 编码无法确定 |
| `DATA_SOURCE_NAME_TAKEN` | 409 | 名称重复 |
| `DATA_SOURCE_IN_USE` | 409 | 删除时仍被引用 |
| `DATA_SOURCE_COLUMNS_REMOVED` | 409 | 替换会移除被引用的列 |
| `DATA_SOURCE_UNKNOWN_COLUMN` | 422 | 编辑/粘贴引入表中没有的列 |
| `NO_ROWS_SELECTED` | 422 | 一行都没选 |
| `BATCH_TOO_LARGE` | 422 | 超过单任务 1000 张 |
| `MULTIPLE_DATA_SOURCES` | 422 | 一个设计引用了多个数据源 |
| `VARIABLE_NOT_DEFINED` | 422 | 引用无法解析 |

每个码 MUST 在两种语言的错误映射中给出**三要素**文案（发生了什么 / 可能的原因 /
下一步做什么）。既有的 `i18n-completeness` 测试会强制这一点。
