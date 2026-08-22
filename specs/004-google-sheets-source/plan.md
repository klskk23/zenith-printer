# Implementation Plan: Google Sheets 数据源

**Branch**: `004-google-sheets-source` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-google-sheets-source/spec.md`

## Summary

把一张 Google 表格接成数据源：粘贴链接、选工作表、预览确认后创建；此后手动刷新以整表
替换行。行仍存在 SQLite 里，所以打印不依赖外网。

三个决定支配了整份计划：

1. **服务账号而非 OAuth2**。局域网 HTTP 地址无法注册为重定向 URI，这一条就否掉了 OAuth
   的授权码流程；服务账号另外还免去了刷新令牌有效期与应用验证。见 `research.md` R1。
2. **行留在本地，刷新是手动的**。既有的渲染、`PageSource`、提交时快照一行不用改，打印
   也不会在人站在打印机前时因为 Google 不通而失败。
3. **失败不是拒绝**。表不在、列对不上、超行数、超时——一律保留上一次的行、说清原因、
   不阻止打印。唯一会拦住人的是「有列消失或改名」，因为那会让引用它的设计取不到值。

## Technical Context

**Language/Version**: TypeScript 5.x，Node 26（`--experimental-strip-types`、
`erasableSyntaxOnly`）—— 沿用既有

**Primary Dependencies**: 新增 `google-auth-library`（当前 11.0.2）用于服务账号 JWT
与令牌缓存；两个 Sheets REST 调用用 Node 内置 `fetch`。**不引入 `googleapis`**（覆盖全部
Google API 的巨型包，本功能只用两个端点）。见 `research.md` R5

**Storage**: SQLite（`node:sqlite`）。迁移 12 给 `data_sources` 加六个可为空的来源字段，
默认值即正确答案，无需回填。见 `data-model.md`

**Testing**: Vitest。`default` 项目脱网运行，Google 侧走 `SheetsPort` 的假实现；
`web` 项目跑页面渲染断言。**本功能不新增任何依赖网络的测试**——宪章「测试 MUST 确定性：
禁止依赖真实时钟、随机数或网络」是无条件的，其隔离条款只为「需要真实硬件的测试」开口，
未涵盖外部网络服务。两处必须联网核实的**关于 Google 的事实**改为手工验收
（`quickstart.md` 第五节），因为它们核实的不是本系统的行为

**Target Platform**: 局域网内单进程 systemd 服务，Linux

**Project Type**: Web 应用（前后端同仓，单进程部署）+ 辅助 CLI

**Performance Goals**: 一次刷新（≤10,000 行）在正常网络下数百毫秒到数秒；超时上限
30 秒（`research.md` R6）

**Constraints**: 刷新同步完成、不产生后台任务（FR-018a）；私钥不进日志、不经任何接口
返回（FR-004、FR-004a）；默认测试套件脱网可跑（FR-040）

**Scale/Scope**: 单个数据源 ≤10,000 行（既有上限）；Sheets API 每项目每分钟 300 次读
请求，人工刷新距此极远，不做客户端限流

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 关卡 | 本功能的落点 | 状态 |
|---|---|---|---|
| I 代码质量 | `tsc` + ESLint 零错误零新增警告 | 既有门禁不变 | ✅ |
| I | 禁止 `any`，公共 API 显式标注 | `SheetsPort`、`RefreshOutcome`、`SheetsError` 均有显式签名 | ✅ |
| I | 显式错误处理 | `SheetsError.kind` 是封闭集合，穷尽处理由类型保证 | ✅ |
| I | 重复第三次才抽取 | `classifyColumnChange` 第一次出现即抽为纯函数——它被刷新与预览两处共用，且两者必须一致 | ✅ |
| II 测试先行 | 红-绿-重构 | `classifyColumnChange`、URL 解析、表头/行规整均为纯函数，先测后写 | ✅ |
| II 脱网可跑 | 测试不得依赖网络（无条件） | `SheetsPort` + 假实现；`failWith` 覆盖全部七种失败。**本功能不新增任何联网测试** | ✅ |
| II | 硬件/外部依赖 MUST 注入 | 端口经构造注入，与既有驱动同形 | ✅ |
| II | 核心逻辑行覆盖 ≥ 80% | 列变化判定、URL 解析、取值规整、刷新决策均计入 | ✅ |
| II | 测试确定性 | `last_refreshed_at` 走既有 `Clock` 注入 | ✅ |
| **II 界面渲染测试** | **每个可导航页面 MUST 有渲染断言** | **不新增可导航页面**；改动落在既有的数据源列表与编辑页 | ✅ 见下表 |
| II | 纯逻辑 MUST 抽离直接测试 | 列变化、URL 解析、行规整均不依赖组件 | ✅ |
| II | 测执行路径而非仅拦截路径 | 只读约束既测界面禁用，也测服务端 `422`——界面禁用只是第一道 | ✅ |
| III.0 术语统一 | 同一概念一个词 | 「链接 / 刷新 / 解绑 / 工作表 / 机器身份」五个词贯穿 UI、API、CLI、日志、文档 | ✅ |
| III.0 错误三要素 | 什么/为什么/下一步 | 七种失败各有三要素；`notShared` 的「下一步」带出机器身份邮箱 | ✅ |
| III.0 超 2 秒有进度 | 一次刷新可能数秒 | FR-018b：进行中状态 + 禁止重复触发 | ✅ |
| III.0 不可逆操作需确认 | 解绑、应用减列 | 各有独立错误码与专属文案（不复用通用确认码） | ✅ |
| III.A camelCase / 状态码稳定 | REST 契约 | 见 `contracts/rest-api.md` | ✅ |
| III.A 长任务非阻塞 | 刷新是否算长任务 | **判定为否**：≤10,000 行的一趟有界读取，30 秒封顶。为几秒钟的事引入状态机与轮询界面，代价大于收益。见 `Complexity Tracking` | ✅ |
| III.B CLI kebab-case / `--json` / 退出码 | `data-source-refresh` | 见 `contracts/rest-api.md` 末节 | ✅ |
| IV 语言规范 | 文档中文、标识符英文 | 本计划与规格中文，代码标识符英文 | ✅ |
| V 可观测性 | 结构化日志 | FR-038：每次刷新记一条结论（数据源、结果、前后行数、失败原因） | ✅ |
| V | 敏感信息不入日志 | FR-004/FR-039：私钥与行内容都不进日志 | ✅ |

### 既有页面的渲染断言（原则 II）

本功能**不新增可导航页面**，因此没有新的挂载断言要求。但改动落在两个既有页面上，各需
补充行为断言：

| 页面 | 断言 |
|---|---|
| 数据源列表 | 链接的数据源显示来源与上次刷新时间；未配置机器身份时链接入口不可用 |
| 数据源编辑 | 链接的数据源为只读（单元格、加行、替换三条路径都不可用）且给出原因；解绑后三条路径恢复 |
| 打印对话框 | 刷新入口存在；按下后行选择被清空 |

### 两处必须实测、不能靠推断的事实

`research.md` R7 列出两点，其中一点会影响用户看到的第一句话：**未分享的表格，Google
返回 403 还是 404**。它决定「需要把表分享给 X」这句提示是否说得出口。在手工核实
（`quickstart.md` 第五节）之前，实现须把 404 也带上「或者尚未分享给 `<邮箱>`」的补充说明。

这两点**不做成测试**：它们核实的是关于 Google 的事实，不是本系统的行为，而本系统的行为
已由假实现全覆盖。做成测试会让整套测试依赖网络，与宪章冲突。

### Phase 1 后复检

设计产物落地后重新过了一遍，两处需要记录：

- **错误码无冲突**：`GOOGLE_*`、`DATA_SOURCE_READ_ONLY`、`DATA_SOURCE_NOT_LINKED`、
  `DATA_SOURCE_UNLINK_NOT_CONFIRMED` 在既有码表中均不存在；被复用的
  `CSV_DUPLICATE_COLUMN`、`CSV_TOO_MANY_ROWS`、`DATA_SOURCE_NAME_TAKEN` 确实存在。已核。
- **新增偏离一处**（同步刷新 vs 长任务非阻塞），已记入 `Complexity Tracking` 并给出理由。

其余关卡的判定未因设计而改变。

## Project Structure

### Documentation (this feature)

```
specs/004-google-sheets-source/
├── spec.md
├── plan.md               # 本文
├── research.md           # Phase 0：R1–R9，含官方文档核实结果
├── data-model.md         # 迁移 12、端口类型、状态迁移
├── quickstart.md         # 环境搭建与手工验收
├── contracts/
│   ├── rest-api.md       # 新增与变更的端点、错误码、CLI
│   └── sheets-port.md    # 与 Google 唯一的接触面
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```
packages/shared/                       # 本功能不改动

packages/server/src/
├── db/migrations/
│   └── index.ts                       # 迁移 12：data_source_link
├── db/repositories/
│   └── data-source-repo.ts            # 来源字段的读写、解绑、只读判定
├── domain/
│   ├── google-sheets.ts               # SheetsPort 接口、SheetsError、URL 解析
│   ├── column-change.ts               # classifyColumnChange（纯函数）
│   └── sheet-table.ts                 # 取值二维数组 → 列名与行（纯函数）
├── integrations/
│   ├── google-sheets-client.ts        # 真实实现；私钥的唯一出现处
│   └── fake-sheets-port.ts            # 假实现，供默认套件使用
├── api/
│   ├── google.ts                      # /api/google/{status,worksheets,preview}
│   └── data-sources.ts                # 新增 google / refresh / unlink；只读兜底
└── config.ts                          # ZENITH_GOOGLE_CREDENTIALS 的读取

packages/web/src/features/data-sources/
├── link-google-dialog.tsx             # 粘链接 → 选工作表 → 预览确认 → 命名
├── refresh-button.tsx                 # 列表页、编辑页、打印对话框共用
├── column-change-dialog.tsx           # 减列时的确认，列出受影响的设计
└── hooks.ts                           # 新增的查询与变更

packages/cli/src/commands/
└── data-source-refresh.ts             # 走 REST，与 template-io 同一做法

packages/server/tests/
├── unit/column-change.test.ts
├── unit/sheet-table.test.ts
├── unit/google-url.test.ts
└── integration/google-sheets-api.test.ts    # 无联网测试：见 quickstart.md 第五节
```

**Structure Decision**: 沿用既有的四包 npm workspaces 布局，不新增包。Google 相关的
真实实现放在新目录 `packages/server/src/integrations/`，与 `drivers/`（打印机）并列——
两者是同一类东西：外部世界的适配器，各自藏在一个端口后面。

## Complexity Tracking

| 偏离 | 为什么必要 | 否决的更简做法 |
|---|---|---|
| **刷新是同步请求，而宪章 III.A 说「长任务非阻塞」** | 该条款原文为「可能长时间运行的操作（**提交打印任务**）MUST 立即返回可轮询的任务标识，MUST NOT 阻塞请求直到**物理动作**完成」——括注与「物理动作」两处措辞都指向打印管线，而刷新没有物理动作。其次，一次刷新是 ≤10,000 行的一趟有界读取，30 秒封顶。打印任务需要队列是因为它耗时数分钟、要按页上报进度、且失败要能重试；刷新三者皆无。为几秒钟的事引入状态机与轮询界面，会让「按一下、等一下、看到结果」变成「按一下、跳转、轮询、再回来」 | 做成后台任务：多一套任务状态、一个查询端点、一个前端轮询循环，换来的只是不阻塞一个用户自己发起的、他正在等的操作 |
| **新增一个运行时依赖 `google-auth-library`** | 服务账号的令牌流程涉及 JWT 签名、时钟偏移、过期与缓存，是安全相关且容易微妙出错的地方 | 手写 JWT：Node 的 `crypto` 够用，但把一段安全相关的代码变成我们自己的维护负担，省下的是 6 个传递依赖 |
| **复用 `CSV_DUPLICATE_COLUMN` / `CSV_TOO_MANY_ROWS` 两个错误码** | 规则与文案完全相同 | 新造 `GOOGLE_*` 同义码：会让同一件事有两套说法。若嫌前缀误导，应当把它们一起改名而不是分叉 |

## Phase 2 提示

任务分解时的顺序建议：`SheetsPort` 与假实现 → 纯函数（URL 解析、表头规整、列变化判定）
→ 迁移与仓储 → REST 端点 → 界面 → CLI → 手工验收（含两项联网核实）。

端口与假实现先行，是因为其后的每一个测试都要用它；纯函数紧随其后，是因为它们不依赖
任何东西，且承载了本功能里最容易悄悄出错的判断。
