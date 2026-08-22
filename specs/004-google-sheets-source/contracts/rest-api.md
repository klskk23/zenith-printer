# REST 契约：Google Sheets 数据源

沿用既有约定：请求与响应一律 camelCase，错误体三要素（what / why / next），
状态码稳定（宪章 III.A）。

---

## `GET /api/google/status`

机器身份是否可用，以及该把表分享给谁。界面据此决定是否显示链接入口（FR-005）。

```jsonc
{ "configured": true,  "clientEmail": "zenith@my-project.iam.gserviceaccount.com" }
{ "configured": false, "clientEmail": null }
```

**MUST NOT 返回密钥内容或其任何片段**（FR-004a）。除上面两个字段外不返回任何东西——
不返回项目 id、不返回密钥指纹、不返回文件路径。

---

## `POST /api/google/worksheets`

列出一个表格里的工作表，供选择（FR-007）。**不创建任何东西。**

```jsonc
// 请求：粘贴的链接原样传入，由服务端提取 id
{ "url": "https://docs.google.com/spreadsheets/d/1AbC.../edit#gid=0" }

// 200
{
  "spreadsheetId": "1AbC...",
  "spreadsheetTitle": "出货台账",
  "worksheets": [ { "id": 0, "title": "本月出货" }, { "id": 12345, "title": "存档" } ]
}
```

| 状态 | 码 | 场景 |
|---|---|---|
| `400` | `GOOGLE_URL_INVALID` | 不是 Google 表格链接，或提取不出表格标识 |
| `422` | `GOOGLE_NOT_CONFIGURED` | 机器身份未配置（FR-005 的服务端兜底） |
| `422` | `GOOGLE_NOT_SHARED` | 403：`details.clientEmail` 给出该分享给谁 |
| `404` | `GOOGLE_SPREADSHEET_NOT_FOUND` | 404 |
| `422` | `GOOGLE_CREDENTIALS_INVALID` | 凭据问题，非表格问题 |
| `429` | `GOOGLE_RATE_LIMITED` | Google 侧限流 |
| `504` | `GOOGLE_UNREACHABLE` | 网络不可达或超时 |

---

## `POST /api/google/preview`

读取所选工作表并返回预览，**仍不创建任何东西**（FR-008）。

```jsonc
// 请求
{ "spreadsheetId": "1AbC...", "worksheetId": 0 }

// 200
{
  "worksheetTitle": "本月出货",
  "columns": ["订单号", "收件人"],
  "sampleRows": [ { "订单号": "A-001", "收件人": "张三" } ],   // 至少 3 行，不足则全部
  "totalRows": 128,
  "suggestedName": "本月出货",        // FR-008a 的默认值
  "nameTaken": false                  // 该默认值是否已被占用（FR-008b）
}
```

`sampleRows` 的取值与创建后的取值走**同一条路径**——预览若与结果不一致，确认这个动作就
失去了意义。

错误码同上，另加：

| 状态 | 码 | 场景 |
|---|---|---|
| `422` | `GOOGLE_WORKSHEET_NOT_FOUND` | 按 `worksheetId` 找不到 |
| `422` | `GOOGLE_WORKSHEET_EMPTY` | 一行都没有，或首行为空（不产出零列数据源） |
| `422` | `CSV_DUPLICATE_COLUMN` | **复用既有码**：首行有重复列名。与 CSV 导入同一规则、同一文案 |
| `422` | `CSV_TOO_MANY_ROWS` | **复用既有码**：超过 10,000 行 |

> 复用 `CSV_*` 前缀的两个码，是因为规则与文案完全相同。造一个 `GOOGLE_DUPLICATE_COLUMN`
> 只会让同一件事有两套说法——这与本项目一贯的做法相左。若日后觉得前缀误导，应当把它们
> 一起改名，而不是分叉。

---

## `POST /api/data-sources/google`

创建链接的数据源（FR-006~012）。

```jsonc
// 请求
{ "spreadsheetId": "1AbC...", "worksheetId": 0, "name": "本月出货" }

// 201：与既有数据源同形，另带来源字段
{
  "id": "ds-...", "name": "本月出货",
  "columns": ["订单号", "收件人"], "rowCount": 128,
  "sourceKind": "google-sheets",
  "spreadsheetId": "1AbC...", "spreadsheetTitle": "出货台账",
  "worksheetId": 0, "worksheetTitle": "本月出货",
  "lastRefreshedAt": "2026-08-22T09:15:00.000Z"
}
```

`409 DATA_SOURCE_NAME_TAKEN`：**复用既有码**（FR-008b）。

### 既有数据源响应的变化

`GET /api/data-sources` 与所有返回数据源的响应新增只读字段
`sourceKind`（`"local" | "google-sheets"`），链接的另带
`spreadsheetTitle`、`worksheetTitle`、`lastRefreshedAt`。

本地数据源的 `sourceKind` 为 `"local"`，其余字段不出现。**既有字段一个不变**（FR-022）。

---

## `GET /api/data-sources/:id/rows` —— 新增 `order`

新增可选查询参数 `order=asc|desc`，默认 `asc`。响应回显该值。

**只是查看顺序。** 打印一律按行号升序，与勾选先后和这个参数都无关（003 的既有决定：
可预测、补打能对上、实物标签顺序与表格一致便于人工核对）。

放在服务端而不是在前端翻转一页：倒序的第 1 页是表格的**末尾**若干行，不是首页倒过来。
后者对「找第 9998 行」毫无帮助，而那正是这个功能存在的理由。

---

## `POST /api/data-sources/:id/refresh`

刷新（FR-013~018c）。同步返回，不产生后台任务。

```jsonc
// 请求
{}                              // 普通刷新
{ "confirmColumnChange": true } // 已确认减列（FR-032）
```

四种 200 响应，`outcome` 判别：

```jsonc
{ "outcome": "applied", "rowsBefore": 128, "rowsAfter": 150, "columnsAdded": ["备注"],
  "lastRefreshedAt": "..." }

{ "outcome": "needsConfirmation", "removedColumns": ["收件人"], "addedColumns": ["客户名称"],
  "affectedTemplates": [ { "id": "tpl-1", "name": "出货面单" } ] }

{ "outcome": "refusedTooManyRows", "rowCount": 12000, "limit": 10000 }

{ "outcome": "failed", "reason": "notShared", "message": "……" }
```

**后三种都不改动任何存储**（FR-026、FR-029、FR-033）。

`failed` 用 200 而非 5xx，是刻意的：刷新失败**不是请求失败**——服务端正确地完成了它被
要求做的事，并给出了结论。规格 FR-027 要求刷新失败不阻止用现有行打印，用错误状态码会
诱使前端把它当成一次需要重试的请求。`reason` 取值与 `SheetsError['kind']` 同集合。

| 状态 | 码 | 场景 |
|---|---|---|
| `404` | `NOT_FOUND` | 数据源不存在 |
| `422` | `DATA_SOURCE_NOT_LINKED` | 该数据源不是链接的，无从刷新 |
| `409` | `DATA_SOURCE_REFRESH_IN_PROGRESS` | 同一数据源已有刷新在进行（FR-018 的服务端兜底） |

---

## `POST /api/data-sources/:id/unlink`

解绑（FR-023~025）。

```jsonc
// 请求（沿用既有的确认约定）
{ "confirmed": true }

// 200：与本地数据源同形
{ "id": "ds-...", "name": "本月出货", "columns": [...], "rowCount": 150, "sourceKind": "local" }
```

| 状态 | 码 | 场景 |
|---|---|---|
| `422` | `DATA_SOURCE_UNLINK_NOT_CONFIRMED` | 未带 `confirmed`。文案须说明后果：此后不再能刷新，行由本地维护 |
| `422` | `DATA_SOURCE_NOT_LINKED` | 本来就不是链接的 |

> 独立的错误码而非复用既有的确认码，是有前车之鉴的：003 里 reset-pool 与
> delete-data-source 曾共用 `CONFIRMATION_REQUIRED`，结果用户看到的是「此操作会打印
> 实物标签」。确认文案必须说自己那件事。

---

## 只读约束的服务端兜底

链接的数据源（`sourceKind === "google-sheets"`）上，以下既有端点 MUST 返回
`422 DATA_SOURCE_READ_ONLY`（FR-019、FR-020）：

- `PATCH /api/data-sources/:id/rows`（改行）
- `POST /api/data-sources/:id/replace`（上传替换）

改名（`PATCH /api/data-sources/:id`）**不受限制**——名字是标签不是标识符，与来源无关。

界面禁用只是第一道；服务端这道才是约束（无鉴权的局域网上，任何人都能直接调接口）。

---

## CLI

```
zenith data-source-refresh --id <id> [--server <url>] [--confirm-column-change] [--json]
```

走 REST（与 `template-import` 同一做法），行为与界面完全一致（FR-036）。

| 退出码 | 场景 |
|---|---|
| `0` | `applied` |
| `2` | 参数错误 |
| `3` | 服务不可达 |
| `4` | `failed` / `needsConfirmation` / `refusedTooManyRows` / 数据源不存在 |

`needsConfirmation` 在无人值守时不能自作主张，因此计入失败；要应用就显式加
`--confirm-column-change`——这与 `template-import` 的 `--on-conflict` 是同一个思路：
不可逆或有后果的选择由调用方给出，命令不替他决定。
