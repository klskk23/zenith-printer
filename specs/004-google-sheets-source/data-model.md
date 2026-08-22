# 数据模型：Google Sheets 数据源

本功能不新增实体，只给既有的 `data_sources` 加上「来源」这一组可为空的字段。选择扩展
而非新建关联表的理由在最后一节。

---

## 1. 迁移 12：`data_source_link`

```sql
ALTER TABLE data_sources ADD COLUMN source_kind        TEXT NOT NULL DEFAULT 'local'
                                   CHECK (source_kind IN ('local', 'google-sheets'));
ALTER TABLE data_sources ADD COLUMN spreadsheet_id     TEXT;
ALTER TABLE data_sources ADD COLUMN spreadsheet_title  TEXT;
ALTER TABLE data_sources ADD COLUMN worksheet_id       INTEGER;
ALTER TABLE data_sources ADD COLUMN worksheet_title    TEXT;
ALTER TABLE data_sources ADD COLUMN last_refreshed_at  TEXT;
```

既有行全部落到 `source_kind = 'local'`，行为不变（规格 FR-022）。**不需要数据回填**——
默认值即正确答案。

### 字段说明

| 字段 | 何时非空 | 为什么需要 |
|---|---|---|
| `source_kind` | 总是 | 判定只读态（FR-019~021）与是否提供刷新（FR-013）的唯一依据 |
| `spreadsheet_id` | 链接时 | 刷新时定位表格 |
| `spreadsheet_title` | 链接时 | 失败文案要说得出「读不到『出货台账』」，而 id 对人无意义 |
| `worksheet_id` | 链接时 | **稳定标识**。工作表在 Google 那边可以改名，`worksheet_id`（API 里的 `sheetId`）不变 |
| `worksheet_title` | 链接时 | 读取时的 A1 范围要用标题，且用于展示；每次刷新成功后按 `worksheet_id` 重新取回并更新 |
| `last_refreshed_at` | 首次刷新后 | FR-017 要求处处可见 |

### 为什么同时存 `worksheet_id` 和 `worksheet_title`

Sheets API 的读取接口（`values.get`）用 A1 记法，只认**标题**；而标题可以被改。若只存
标题，工作表一改名，刷新就失败，而它其实还在。若只存 id，则无法构造读取范围。

因此：以 `worksheet_id` 为准定位，每次刷新先用 `spreadsheets.get` 取回该 id 当前的标题，
再用标题构造范围。工作表被**删除**时按 `worksheet_id` 找不到，归入 FR-028 的「工作表
不存在」。

---

## 2. 解绑

规格 FR-023~025。解绑是一次原地更新：

```
source_kind      → 'local'
spreadsheet_id   → NULL
spreadsheet_title→ NULL
worksheet_id     → NULL
worksheet_title  → NULL
last_refreshed_at→ NULL
```

`columns`、`row_count` 与 `data_source_rows` 里的行**全部保留**。解绑后该行与一个由
CSV 创建的数据源在存储上完全等价——这正是 FR-025 要求的。

不可逆（FR-024）：来源信息被抹掉后无法恢复，所以要确认。

---

## 3. 领域类型（非存储）

### `SheetsPort`

端口只暴露本功能需要的两件事，不包装整个 Sheets API。窄端口的假实现才写得出可信的
失败场景。

```
listWorksheets(spreadsheetId)
  → { title, worksheets: [{ id, title }] }

readWorksheet(spreadsheetId, worksheetTitle)
  → { values: string[][] }        // 首行即表头，取值已是显示文本
```

两者都可能抛出 `SheetsError`，其 `kind` 为下列之一。这一组值与规格 FR-028 的失败分类
一一对应，是端口契约的一部分：

| `kind` | 触发 | 对应文案 |
|---|---|---|
| `not-shared` | 403 | 需要把表分享给 `<机器身份邮箱>` |
| `not-found` | 404 | 表格不存在或已删除 |
| `worksheet-missing` | 按 id 找不到工作表 | 工作表已被删除 |
| `credentials-invalid` | 401 / 密钥无法签发令牌 | 凭据有问题，非表格问题 |
| `rate-limited` | 429 | Google 侧暂时拒绝，稍后再试 |
| `unreachable` | 网络错误 | 连不上 Google |
| `timeout` | 超过 30 秒（研究 R6） | 超时 |

### `RefreshOutcome`

一次刷新的结论，是 REST 响应与结构化日志（FR-038）的共同来源。

```
{ kind: 'applied',            rowsBefore, rowsAfter, columnsAdded: string[] }
{ kind: 'needs-confirmation', removedColumns: string[], affectedTemplates: [{ id, name }] }
{ kind: 'refused-too-many-rows', rowCount, limit }
{ kind: 'failed',             reason: SheetsError['kind'] }
```

`needs-confirmation` 与 `refused-too-many-rows` 都**不改动任何存储**（FR-029、FR-033）。

### `ColumnChange`

```
classifyColumnChange(old: string[], next: string[])
  → { kind: 'unchanged' }
  | { kind: 'added',    added: string[] }
  | { kind: 'breaking', removed: string[], added: string[] }
```

纯函数，直接测试。**Google 那边无法区分「改名」与「删一列加一列」**——两者在表头上是
同一个结果，所以判定只看差集：旧列有而新列无者即为 breaking。这一点要写进实现注释，
否则会有人试图推断「改名」而永远推断不准（研究 R9）。

---

## 4. 状态迁移

```
              链接（预览确认后）
   local  ─────────────────────────►  google-sheets
     ▲                                    │  │
     │            解绑（需确认）           │  │ 刷新成功 → 更新行、
     └────────────────────────────────────┘  │           last_refreshed_at、
                                             │           worksheet_title
                                             │
                                             └ 刷新失败/待确认/超行数 → 存储不变
```

`local → google-sheets` 只发生在创建时（链接产生的是一个**新**数据源）。既有的本地
数据源**不能**被转成链接的——那需要回答「行怎么办」，而规格没有这条需求。

---

## 5. 为什么扩展 `data_sources` 而不是新建关联表

一个数据源至多有一份来源，且来源的生命周期与数据源完全一致（删数据源即删来源，解绑即
清空来源）。关联表在这里只会带来一次 JOIN 和一个「有行但没有对应数据源」的可能状态，
换不来任何东西。

`source_kind` 用 `CHECK` 约束而不是布尔字段，是为了以后接入别的来源（比如 Excel Online）
时不必再改一次列。
