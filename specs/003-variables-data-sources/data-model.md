# Phase 1 数据模型：变量与表格数据源

## 新增实体

### DataSource（数据源）

一张表。全局对象，不隶属模板或打印机。

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `name` | TEXT | **唯一**。本期建立后不可更改（FR-019），但已不再是引用语法的一部分 |
| `columns` | TEXT (JSON) | 列名数组，顺序即表格列序 |
| `rowCount` | INTEGER | 冗余存储，避免列表页对万行表做 `COUNT(*)` |
| `createdAt` / `updatedAt` | TEXT | ISO 8601 |

**验证规则**

- `name` 非空，不含 `.`、`}`、`"`（它是引用路径的一段）
- `columns` 无重复、无空白项（FR-023a）
- `rowCount ≤ 10000`（FR-026a）

### DataSourceRow（数据源行）

| 字段 | 类型 | 约束 |
|---|---|---|
| `sourceId` | TEXT | 外键 → `data_sources(id)` ON DELETE CASCADE |
| `ordinal` | INTEGER | 表内序号，1 起。行选择的 X-Y 指的就是它 |
| `values` | TEXT (JSON) | `{"列名":"值"}`，一切皆文本（FR-024） |

主键 `(sourceId, ordinal)`。

列值存 JSON 而非宽表：列名是任意中文字符串，且替换数据源时列集会变——JSON 让「列」
成为数据而不是模式（research R7）。

### SequencePool（序号池）

独立于设计存在的计数器，可被多个设计引用（FR-005）。

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `name` | TEXT | 唯一，用户可见 |
| `digits` | INTEGER | 位数，决定补零与上限 |
| `step` | INTEGER | 步长，默认 1 |
| `floor` | INTEGER | **重置下限**，默认 0 |
| `createdAt` | TEXT | ISO 8601 |

**当前值不是存储字段**，而是 `max(floor, 已消耗最大值)`——已消耗最大值来自下面的
`JobSequenceClaim`（research R5）。历史是号码的唯一凭据；`floor` 只是一条「从此处
重新开始」的声明。

**状态转换**：重置 = 把 `floor` 设为目标值。这是不可撤销且可能导致重号的操作，
**MUST 要求显式确认并说明后果**（FR-006、宪章 III.0）。

### JobSequenceClaim（号段领取记录）

一条任务对一个序号池的领取。**它取代了既有的 `print_jobs.seq_ranges` JSON 列。**

| 字段 | 类型 | 约束 |
|---|---|---|
| `jobId` | TEXT | 外键 → `print_jobs(id)` ON DELETE CASCADE |
| `poolId` | TEXT | 外键 → `sequence_pools(id)`。**建索引** |
| `start` / `end` | INTEGER | 该任务实际占用的首尾号（闭区间） |
| `step` | INTEGER | 步长 |
| `digits` | INTEGER | 补零宽度。**存储而非从 `end` 推断**——三位数的池只走到 80 时要印 `080` |

主键 `(jobId, poolId)`。

**为什么是一张表而不是继续用 JSON 列**：池可被多个模板共用（FR-005），所以「已消耗最大值」
的扫描无法再靠 `template_id` 索引收窄。留在 JSON 里意味着每次提交都要全表扫描并解析
（research R5）。改成表之后，`SELECT MAX(end) WHERE pool_id = ?` 走索引即可。

`seq_ranges` 列**一并删除**而不是保留：两份都记录号码、都可能被写，而它们不一致时无从
判断哪个印在了实物上——那正是 R5 拒绝独立计数器的同一条理由。

## 变更的实体

### LabelElement（IR 元素）

`content` 的类型由 `string | { $var: string }` **收窄为 `string`**。

这是一次简化：`isVariableRef`、绑定选择器、「这个元素绑没绑」的概念随之消失。元素内容
成为一个模板串，由 `@zenith/shared/template` 求值后再交给渲染。

### Template（模板）

移除 `variableFields`。设计中的变量定义改为存放在模板自身的新字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `variables` | TEXT (JSON) | 具名变量的定义数组（仅常量与自增） |
| `dataSourceId` | TEXT NULL | 所绑数据源。**一个设计最多一个**（FR-029）——这里是那个「一」的落点 |

单个变量定义：

```jsonc
{ "name": "sku", "kind": "constant", "value": "ABC-123" }
{ "name": "serial", "kind": "sequence", "poolId": "pool-1" }
```

数据源列**不在 `variables` 里**——它不需要声明，内容里直接写 `${列名}`，求值时到
`dataSourceId` 指向的表里找（FR-009）。

`dataSourceId` 让「最多一个数据源」成为结构上不可违反的事实，而不是一条要在提交时
校验的规则：字段只有一个，就写不出第二个。删除数据源的影响面扫描（FR-028）也随之
从「扫描所有模板的内容字符串」变成一次 `WHERE data_source_id = ?`，既快又不会因为
某个常量恰好与数据源同名而误报。

### PrintJob（打印任务）

`snapshot` 增加：

| 字段 | 类型 | 说明 |
|---|---|---|
| `rows` | `Array<Record<string,string>>` | 按打印顺序排列的行值，抄自数据源（FR-039） |
| `copiesPerRow` | INTEGER | 份数。总张数 = `rows.length × copiesPerRow` |

`rows` 为空数组表示该设计不使用数据源，此时总张数即份数（保持既有行为）。

`irForCopy(job, index)` 的取值来源变为：

```
row  = snapshot.rows[floor(index / copiesPerRow)]   // 无数据源时为空
seq  = 按 floor(index / copiesPerRow) 取序号        // 同一行的多份共用（FR-036）
values = { ...row, ...seq }
```

## 删除的实体

- `variable_fields` 表及 `VariableField` 类型（FR-002、FR-051）
- 「手工填入」这一取值来源，以及打印对话框中据此生成的表单

## 迁移

| # | 内容 | 破坏性 |
|---|---|---|
| 7 | 建 `data_sources`、`data_source_rows`、`sequence_pools`、`job_sequence_claims` | 否 |
| 8 | `templates` 增加 `variables` 与 `data_source_id` 两列 | 否 |
| 9 | 既有 `print_jobs.seq_ranges` 搬进 `job_sequence_claims`，随后删除该列与 `variable_fields` 表 | **是**（当前无生产数据，FR-051） |
| 10 | 既有模板元素内容中的 `{ $var: x }` 改写为 `${x}`；字面 `${` 转义为 `$${` | **是** |

**迁移 MUST 保留**打印机、打印参数与偏移校正值（FR-052）——偏移是对着实物量出来的。

`templates` 与 `print_jobs` 上的 `printer_kind` CHECK 约束不受影响；本次不需要重建表，
因此不需要 `suspendForeignKeys`。

## 关系图

```
SequencePool ──┐
               ├─ 被 Template.variables 引用（按 id）
Constant ──────┘
     │
     └──< JobSequenceClaim >── PrintJob   （号码的唯一凭据，current 由此推导）

DataSource ──< DataSourceRow
     ▲
     └──< Template.dataSourceId （绑定；列名由内容里的 ${列名} 引用，无外键）

Template ──< PrintJob（既有）
PrintJob.snapshot.rows ── 行值的副本，提交时冻结，此后不再依赖 DataSource
```

数据源与模板之间**刻意没有外键**：引用写在内容字符串里，是文法而非关系。这也是数据源
不可改名的原因——数据库无从代为改写。删除数据源时由服务端扫描模板内容，列出会因此断掉
的设计（FR-028）。
