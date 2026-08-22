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

### `PATCH /api/data-sources/:id`

改名。`{ "name": "本周订单" }`。

- `409 DATA_SOURCE_NAME_TAKEN` 名称已被占用
- 否则 `200`

**改名对引用零影响**：设计按 id 绑定，列引用是裸名（FR-019）。这里没有「会断掉哪些
设计」的提示，因为一个也不会断。

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

- 未带 `confirm=true` → `422 DATA_SOURCE_DELETE_NOT_CONFIRMED`（表内的行不可恢复）

  确认是**按操作分开的码**，不共用打印的那个：三要素必须说清*这个*动作会做什么。
  共用的结果是重置计数器时被告知「会消耗纸张」——实现期跑手工验收才发现。
- 带 `confirm=true` → `204`，**即使有设计正在引用它**

不设引用拦截（FR-028）：列引用是裸名，把设计重新绑到另一张同形状的表即可全部复原。
断掉的设计由模板列表与设计页上的警告标记指出（FR-028a），而不是由这里拦住。

## 新增：序号池

### `GET /api/sequence-pools`

```jsonc
{ "pools": [
  { "id": "pool-1", "name": "整机流水", "digits": 6, "step": 1, "floor": 0,
    "current": 741, "nextValue": 742 }
] }
```

`current` 由 `max(floor, 已消耗最大值)` 推导，不是存储字段。`floor` 是存储字段，随响应
返回——重置对话框要说清「从 741 重置到几」，就得先知道上一次的下限是多少。

### `POST /api/sequence-pools` / `PATCH /api/sequence-pools/:id`

可改 `name`、`digits`、`step`。**不能**用 PATCH 改 `current`。

### `DELETE /api/sequence-pools/:id`

- 仍被设计引用 → `409 SEQUENCE_POOL_IN_USE`，`details.affectedTemplates` 列出设计
- 否则 `204`

删除只移除池本身。已发放的号段留在 `job_sequence_claims` 里，因为那些号码印在实物上，
是补打与追溯的依据（FR-006a、research R5）。

### `POST /api/sequence-pools/:id/reset`

```jsonc
{ "floor": 1, "confirm": true }
```

- 未带 `confirm` → `422 SEQUENCE_RESET_NOT_CONFIRMED`
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
- 内容中有无法解析的引用 → `422 VARIABLE_NOT_DEFINED`，`details.reference` 指出是哪一个
- 常量/自增与所绑数据源的某一列重名 → `422 VARIABLE_NAME_COLLIDES`，`details.name`
  指出是哪个名称（FR-009b）
- 所选行序号已不存在 → `422 ROW_SELECTION_STALE`，`details.missingOrdinals` 列出缺失的
  序号（FR-033a）。`{ "all": true }` 不会触发此错误
- 被条码或二维码引用的列在所选行中有空值 → `422 BARCODE_EMPTY_VALUE`，
  `details.column` 与 `details.ordinals` 指出列名与行号（FR-045b）

**移除**：`manualFieldValues`、`sequenceOverrides`。

### `DELETE /api/templates/:id/print-form`

**整个端点移除**。它的职责（告诉前端有哪些字段要填）已不存在：常量与序号不询问取值，
数据源取值来自所选行。

### `GET /api/templates`

每个模板增加只读字段 `bindingIssue`，**读取时计算，不存储**（FR-028a）：

```jsonc
{ "bindingIssue": null }
{ "bindingIssue": { "kind": "sourceMissing" } }
{ "bindingIssue": { "kind": "columnsMissing", "columns": ["收件人"] } }
```

存储这个状态会与数据源的实际情况漂移，而漂移的方向恰好是「显示正常、实则已断」。

### `PATCH /api/templates/:id`（新增）

只改名字：

```jsonc
{ "name": "快递面单" }
```

返回完整模板（含 `bindingIssue`）。名称去首尾空格，1–80 字符。

单独一个端点而不是走 `PUT`：改个名字要把整份设计发回去，就会在别处编辑过该设计时
失败，而这和名字毫无关系。**版本号照常 +1**——打开着的设计页仍持有旧名字，不加版本号
的话它下次保存会把旧名字写回去，且无人知晓；加了之后编辑器会收到既有的冲突提示。

模板名**不要求唯一**：没有任何东西按名称引用模板（与数据源不同，数据源改名有
`DATA_SOURCE_NAME_TAKEN`）。

### `POST /api/preview`

`variableValues` 替换为 `rowOrdinal`（可选）：预览指定序号的行；缺省为打印顺序上的
第一行（FR-041）。

### `GET /api/templates/:id/thumbnail`（新增）

返回该设计的库内缩略图，`image/png`。没有则 `404`。

模板 JSON 增加只读布尔 `hasThumbnail`。**图片不内联进列表**：列表一次返回全部模板，
每行内嵌一张图会让最常用的那个请求大上几十倍，而其中大部分并不会被画出来。

缩略图在**保存时**生成并入库（`POST` / `PUT`），改名（`PATCH`）不重画——名字不影响画面。
生成失败不影响保存：条码内容编不出来的设计仍然存得下，只是 `hasThumbnail` 为 `false`。

`Cache-Control: immutable`，客户端在 URL 上带 `?v={version}` 破缓存。某个版本的字节
永不改变（保存即新版本），所以长缓存是安全的，也不可能拿到过期的图。

与打印路径的两处刻意差异：**不做二值化**（卡片只有几百像素宽，缩图后再阈值化会把小字
打成噪点），以及**按固定像素宽渲染**而非标签的点阵（卡片大小与目标打印机无关）。

### 打印时的分辨率与机型（修订 FR-032）

提交打印时，渲染用的 `dpi` 取自**目标打印机**的探测结果，不再取自模板或前端发来的 IR。
模板里的 `dpi` 只是设计时的预览值。快照记录的是实际使用的分辨率。

`TEMPLATE_PRINTER_MISMATCH`（422）**移除**。设计没有自己的机型：两个驱动收到的都是位图。
能否打印只看标签宽度是否被该打印头覆盖，按目标打印机检查，超出仍是
`422 FIELD_VALIDATION_FAILED`。

保存模板时的宽度上限改为「所有已探测打印机中最宽的那个」，不再按机型取。

**取舍**：条码的 `moduleWidthDots` 是点数，所以换到更高分辨率的打印头上条码会物理变窄，
但模块仍落在整点上。反过来（保住毫米、让模块落在小数点上）会得到粗细不均的条码，扫不出的
条码比小一点的条码更糟。变窄不会溢出，`checkLabel` 按目标分辨率运行，真溢出会报出来。

## 错误码新增

| 码 | 状态 | 场景 |
|---|---|---|
| `CSV_NO_HEADER` | 422 | 无表头 |
| `CSV_DUPLICATE_COLUMN` | 422 | 表头重复列名 |
| `CSV_TOO_MANY_ROWS` | 422 | 超过 10,000 行 |
| `CSV_DECODE_FAILED` | 422 | 编码无法确定 |
| `DATA_SOURCE_NAME_TAKEN` | 409 | 名称重复 |
| `DATA_SOURCE_COLUMNS_REMOVED` | 409 | 替换会移除被引用的列 |
| `DATA_SOURCE_UNKNOWN_COLUMN` | 422 | 编辑/粘贴引入表中没有的列 |
| `NO_ROWS_SELECTED` | 422 | 一行都没选 |
| `BATCH_TOO_LARGE` | 422 | 超过单任务 1000 张 |
| `VARIABLE_NOT_DEFINED` | 422 | 引用无法解析 |
| `VARIABLE_NAME_COLLIDES` | 422 | 常量/自增与所绑数据源的列重名 |
| `SEQUENCE_POOL_IN_USE` | 409 | 删除序号池时仍被引用 |
| `ROW_SELECTION_STALE` | 422 | 所选行序号已不存在 |
| `BARCODE_EMPTY_VALUE` | 422 | 条码/二维码引用的列在所选行中为空 |
| `SEQUENCE_RESET_NOT_CONFIRMED` | 422 | 重置序号池未带 `confirm` |
| `DATA_SOURCE_DELETE_NOT_CONFIRMED` | 422 | 删除数据源未带 `confirm` |

以上 16 个码 MUST 在两种语言的错误映射中给出**三要素**文案（发生了什么 / 可能的原因 /
下一步做什么）。既有的 `i18n-completeness` 测试会强制这一点。
