---
description: "Task list for 004-google-sheets-source"
---

# Tasks: Google Sheets 数据源

**Input**: `specs/004-google-sheets-source/` 的设计文档

**Prerequisites**: plan.md、spec.md、research.md、data-model.md、contracts/

**Tests**: 按宪章原则 II，测试任务**不可省略**。每个用户故事的测试任务列在实现任务之前，
且必须先看到它们变红。默认套件全程脱网——Google 侧一律走假实现（FR-040）。

**Organization**: 按用户故事分组，使每个故事可独立实现、独立验证、独立交付。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成的前置依赖）
- **[Story]**: 所属用户故事（US1–US5）
- 每条都带确切文件路径

## Path Conventions

npm workspaces 四包结构，不新增包。Google 的真实实现落在新目录
`packages/server/src/integrations/`，与 `drivers/`（打印机）并列——两者是同一类东西：
外部世界的适配器，各自藏在一个端口后面。

---

## Phase 1: Setup

- [X] T001 在 `packages/server/package.json` 加入依赖 `google-auth-library@^11`，并运行 `npm install`
- [X] T002 [P] 在 `packages/server/src/config.ts` 读取环境变量 `ZENITH_GOOGLE_CREDENTIALS`（可缺省），导出凭据文件路径
- [X] T003 [P] 在 `.env.example` 与 `README.md` 记录 `ZENITH_GOOGLE_CREDENTIALS` 的含义与文件权限要求（`0400`、属主为服务用户）；并按宪章「新增的外部依赖 MUST 在文档中说明其安装前置条件」注明 `google-auth-library` 为纯 JS、无原生模块、无需编译工具链

---

## Phase 2: Foundational（阻塞所有用户故事）

**目的**：端口、假实现与三个纯函数。其后每一个测试都要用到它们。

### 端口与失败分类

- [X] T004 在 `packages/server/src/domain/google-sheets.ts` 定义 `SheetsPort`、`SpreadsheetInfo`、`SheetsError` 及封闭的 `SheetsErrorKind`（七种，见 `contracts/sheets-port.md`）
- [X] T005 编写 `packages/server/tests/unit/fake-sheets-port.test.ts`：假实现能按脚本返回工作表与取值，且 `failWith` 能造出全部七种失败
- [X] T006 在 `packages/server/src/integrations/fake-sheets-port.ts` 实现假实现，使 T005 变绿

### 纯函数（先测后写）

- [X] T007 [P] 编写 `packages/server/tests/unit/google-url.test.ts`：从各种形态的表格链接提取 id（含 `/edit#gid=`、`/edit?usp=sharing`、裸 id、非 Google 链接应失败）
- [X] T008 [P] 编写 `packages/server/tests/unit/sheet-table.test.ts`：取值二维数组 → 列名与行，**表头即首行**。覆盖参差不齐的行补空串、表头有空单元格、重复列名、只有表头无数据行、一行都没有
- [X] T009 [P] 编写 `packages/server/tests/unit/column-change.test.ts`：`classifyColumnChange` 返回 `unchanged` / `added` / `breaking`；**改名与「删一列加一列」必须归为同一结果**
- [X] T010 [P] 在 `packages/server/src/domain/google-sheets.ts` 实现链接解析，使 T007 变绿
- [X] T011 [P] 在 `packages/server/src/domain/sheet-table.ts` 实现取值规整，使 T008 变绿
- [X] T012 [P] 在 `packages/server/src/domain/column-change.ts` 实现 `classifyColumnChange`，使 T009 变绿。注释须写明：Google 侧无法区分改名与删列加列，故只看差集

### 存储

- [X] T013 编写 `packages/server/tests/unit/migration-data-source-link.test.ts`：迁移后既有数据源的 `source_kind` 为 `local`，其余来源字段为 `NULL`，行与列不变
- [X] T014 在 `packages/server/src/db/migrations/index.ts` 加入迁移 12 `data_source_link`（六个字段，见 `data-model.md` §1），使 T013 变绿
- [X] T015 编写 `packages/server/tests/unit/data-source-link-repo.test.ts`：写入/读取来源字段、`isLinked` 判定、解绑后行保留且来源字段清空
- [X] T016 在 `packages/server/src/db/repositories/data-source-repo.ts` 实现来源字段的读写、`createLinked`、`unlink`、`replaceLinkedRows`，使 T015 变绿

### 真实客户端

- [X] T017 在 `packages/server/src/integrations/google-sheets-client.ts` 实现 `SheetsPort`：`google-auth-library` 签发 JWT、权限范围 `spreadsheets.readonly`、`listWorksheets` 带 `fields` 裁剪、`readWorksheet` 用 `FORMATTED_VALUE`、30 秒超时
- [X] T018 在 T017 中把 HTTP 状态映射为 `SheetsErrorKind`（403/404/401/429/网络/超时），并加注释说明 403 与 404 的区分待 HW-2 实测确认
- [X] T019 在 `packages/server/src/app.ts` 按 `ZENITH_GOOGLE_CREDENTIALS` 是否配置注入真实端口或不注入，并把端口作为依赖传给路由

**检查点**：此阶段完成后，端口、纯函数与存储均已就绪且有测试；尚无任何界面或接口。

---

## Phase 3: User Story 1 - 把一张 Google 表接成数据源 (P1)

**Goal**：粘链接 → 选工作表 → 预览确认 → 创建数据源。

**Independent Test**：分享一张表、粘贴链接、确认列名、创建，然后用它打印一张标签。全程
不需要刷新、不需要处理任何失败。

### 测试（先写，先看它们红）

- [X] T020 [P] [US1] 编写 `packages/server/tests/integration/google-status-api.test.ts`：未配置时 `configured:false`；已配置时返回 `clientEmail`；**响应中不含密钥的任何片段**（FR-004a）
- [X] T021 [P] [US1] 编写 `packages/server/tests/integration/google-worksheets-api.test.ts`：列出工作表；非法链接 `400`；未配置 `422`；`403/404/429/超时` 各自的状态码与错误码
- [X] T022 [P] [US1] 编写 `packages/server/tests/integration/google-preview-api.test.ts`：返回列名、至少 3 行、`totalRows`、`suggestedName`、`nameTaken`；空工作表 `422`；重复列名复用 `CSV_DUPLICATE_COLUMN`；超行数复用 `CSV_TOO_MANY_ROWS`
- [X] T023 [P] [US1] 编写 `packages/server/tests/integration/google-create-api.test.ts`：创建出的数据源带 `sourceKind:'google-sheets'` 与来源字段；重名 `409 DATA_SOURCE_NAME_TAKEN`；**预览与创建的取值走同一路径、结果逐字相同**
- [X] T024 [P] [US1] 编写 `packages/web/tests/link-google.dom.test.tsx`：未配置时入口不可用；粘链接 → 列出工作表 → 选一个 → 显示列名与样例行 → 名称框预填工作表名 → 确认后调用创建
- [X] T025 [P] [US1] 编写 `packages/server/tests/integration/linked-source-print.test.ts`：用链接的数据源提交打印任务并断言成功——设计里的 `${列名}` 解析到该表的取值、行选择按序号命中、快照抄下的是这些行。**这是 FR-011 与 US1 独立验收标准的正面**，缺了它「接进来能打印」就只是一句声明

### 实现

- [X] T026 [US1] 在 `packages/server/src/api/google.ts` 实现 `GET /api/google/status`，使 T020 变绿
- [X] T027 [US1] 在 `packages/server/src/api/google.ts` 实现 `POST /api/google/worksheets`，使 T021 变绿
- [X] T028 [US1] 在 `packages/server/src/api/google.ts` 实现 `POST /api/google/preview`（含 `suggestedName` 与 `nameTaken`），使 T022 变绿
- [X] T029 [US1] 在 `packages/server/src/api/data-sources.ts` 实现 `POST /api/data-sources/google`，使 T023 变绿
- [X] T030 [P] [US1] 在 `packages/server/src/i18n/{zh-CN,en-US}.ts` 与 `types.ts` 加入五个新错误码的三要素文案：`GOOGLE_URL_INVALID`、`GOOGLE_NOT_CONFIGURED`、`GOOGLE_NOT_SHARED`、`GOOGLE_SPREADSHEET_NOT_FOUND`、`GOOGLE_CREDENTIALS_INVALID`
- [X] T031 [P] [US1] 在同上文件加入 `GOOGLE_RATE_LIMITED`、`GOOGLE_UNREACHABLE`、`GOOGLE_WORKSHEET_NOT_FOUND`、`GOOGLE_WORKSHEET_EMPTY` 的文案。`GOOGLE_NOT_SHARED` 的「下一步」须带出机器身份邮箱
- [X] T032 [US1] 在 `packages/web/src/features/data-sources/hooks.ts` 加入 `useGoogleStatus`、`useListWorksheets`、`usePreviewWorksheet`、`useCreateLinkedSource`
- [X] T033 [US1] 在 `packages/web/src/features/data-sources/link-google-dialog.tsx` 实现三步对话框（粘链接 → 选工作表 → 预览+命名确认），使 T024 变绿
- [X] T034 [US1] 在 `packages/web/src/features/data-sources/data-sources-page.tsx` 加入「链接 Google 表格」入口，未配置时禁用并说明由部署方配置
- [X] T035 [P] [US1] 在 `packages/web/src/i18n/{zh-CN,en-US}.ts` 加入本故事的界面文案

**检查点**：US1 可独立交付——能接入一张表并用它打印，尚不能刷新。

---

## Phase 4: User Story 2 - 表改了之后把数据取回来 (P1)

**Goal**：手动刷新整表替换行；打印对话框内也能刷新；刷新清空行选择。

**Independent Test**：改动 Google 表的内容，按刷新，确认行随之改变、刷新时间更新。

### 测试

- [X] T036 [P] [US2] 编写 `packages/server/tests/integration/google-refresh-api.test.ts`：成功返回 `outcome:'applied'` 与前后行数；`last_refreshed_at` 更新；非链接数据源 `422 DATA_SOURCE_NOT_LINKED`；数据源不存在 `404`
- [X] T037 [P] [US2] 在同一文件补：**工作表改名后仍能刷新**（按 `worksheet_id` 取回当前标题），且 `worksheet_title` 被更新
- [X] T038 [P] [US2] 在同一文件补：同一数据源的并发刷新只写一次，第二个请求 `409 DATA_SOURCE_REFRESH_IN_PROGRESS`
- [X] T039 [P] [US2] 编写 `packages/web/tests/data-source-refresh.dom.test.tsx`：列表页与编辑页均有刷新入口；进行中时按钮禁用；成功后显示新的刷新时间
- [X] T040 [P] [US2] 编写 `packages/web/tests/print-refresh.dom.test.tsx`：打印对话框内有刷新入口；**已勾选行后按刷新，选择被清空并给出原因**
- [X] T041 [P] [US2] 在 `packages/web/tests/data-source-refresh.dom.test.tsx` 补：挂载数据源页与打印对话框、推进假定时器，断言**没有任何刷新请求被发出**（FR-014）。否定式需求无人验证时，日后有人加个轮询也不会有测试变红

### 实现

- [X] T042 [US2] 在 `packages/server/src/domain/refresh.ts` 实现刷新决策纯函数：读取结果 + 现有列 → `RefreshOutcome`（见 `data-model.md` §3）
- [X] T043 [US2] 在 `packages/server/src/api/data-sources.ts` 实现 `POST /api/data-sources/:id/refresh`，含按 `worksheet_id` 换取当前标题、进行中互斥，使 T036–T038 变绿
- [X] T044 [US2] 在 `packages/server/src/api/data-sources.ts` 的数据源响应中加入 `sourceKind`、`spreadsheetTitle`、`worksheetTitle`、`lastRefreshedAt`（既有字段一个不变）
- [X] T045 [P] [US2] 在 `packages/server/src/i18n/{zh-CN,en-US}.ts` 与 `types.ts` 加入 `DATA_SOURCE_NOT_LINKED`、`DATA_SOURCE_REFRESH_IN_PROGRESS` 的文案
- [X] T046 [US2] 在 `packages/web/src/features/data-sources/refresh-button.tsx` 实现共用的刷新按钮（进行中状态、禁止重复触发），使 T039 变绿
- [X] T047 [US2] 在 `packages/web/src/features/data-sources/data-sources-page.tsx` 与 `data-source-editor.tsx` 显示来源与上次刷新时间，并接入刷新按钮
- [X] T048 [US2] 在 `packages/web/src/features/print/print-dialog.tsx` 接入刷新按钮，**置于行选择器之前**；刷新成功后清空 `selection`，使 T040 变绿
- [X] T049 [P] [US2] 在 `packages/web/src/i18n/{zh-CN,en-US}.ts` 加入刷新相关文案，含「刷新已清空行选择」的原因说明

**检查点**：US1 + US2 构成完整的 MVP——接进来、改了能同步。

---

## Phase 5: User Story 3 - 链接的表在本地不可编辑 (P2)

**Goal**：链接的数据源只读；可解绑变回普通数据源。

**Independent Test**：创建链接的数据源，确认三条编辑路径都不可用且有原因；解绑后行还在
且三条路径恢复。

### 测试

- [X] T050 [P] [US3] 编写 `packages/server/tests/integration/linked-read-only.test.ts`：链接的数据源上 `PATCH .../rows` 与 `POST .../replace` 均 `422 DATA_SOURCE_READ_ONLY`；**改名不受限制**
- [X] T051 [P] [US3] 编写 `packages/server/tests/integration/data-source-unlink.test.ts`：未带 `confirmed` → `422 DATA_SOURCE_UNLINK_NOT_CONFIRMED`；确认后行全部保留、来源字段清空、`sourceKind` 变 `local`；非链接数据源 `422 DATA_SOURCE_NOT_LINKED`
- [X] T052 [P] [US3] 在 T051 中补：解绑之后 `PATCH .../rows` 与 `POST .../replace` **恢复可用**（测执行路径，而非只测拦截路径）
- [X] T053 [P] [US3] 编写 `packages/web/tests/linked-source-read-only.dom.test.tsx`：链接的数据源编辑页为只读且说明原因；「替换」不可用；本地数据源不受影响
- [X] T054 [P] [US3] 在同一文件补：解绑确认框**说明后果**（此后不再能刷新、行由本地维护），而非只问「确定吗」

### 实现

- [X] T055 [US3] 在 `packages/server/src/api/data-sources.ts` 给 `PATCH .../rows` 与 `POST .../replace` 加入只读兜底，使 T050 变绿
- [X] T056 [US3] 在 `packages/server/src/api/data-sources.ts` 实现 `POST /api/data-sources/:id/unlink`，使 T051、T052 变绿
- [X] T057 [P] [US3] 在 `packages/server/src/i18n/{zh-CN,en-US}.ts` 与 `types.ts` 加入 `DATA_SOURCE_READ_ONLY`、`DATA_SOURCE_UNLINK_NOT_CONFIRMED` 的文案（**独立文案，不复用通用确认码**）
- [X] T058 [US3] 在 `packages/web/src/features/data-sources/data-source-editor.tsx` 依 `sourceKind` 进入只读态并说明来自 Google，使 T053 变绿
- [X] T059 [US3] 在 `packages/web/src/features/data-sources/data-sources-page.tsx` 隐藏链接数据源的「替换」，加入「解除链接」及其确认框，使 T054 变绿

**检查点**：链接的表不会被本地改动无声抹掉；想接管的人有一条出路。

---

## Phase 6: User Story 4 - 刷新失败时仍然能打印 (P2)

**Goal**：七种失败各自可辨，旧行保留，不阻止打印；超行数拒绝而非截断。

**Independent Test**：撤销分享后按刷新，确认给出原因、旧行仍在、且仍能打印。

### 测试

- [X] T060 [P] [US4] 编写 `packages/server/tests/integration/refresh-failure.test.ts`：七种 `SheetsErrorKind` 各返回 `200` + `outcome:'failed'` + 对应 `reason`；**每一种的行与列都未改动**。`timeout` 一项用**可注入的短超时**触发，测试不得真等 30 秒（研究 R6 的数值只是生产默认值）
- [X] T061 [P] [US4] 在同一文件补：刷新失败后用现有行提交打印任务仍成功（FR-027）
- [X] T062 [P] [US4] 在同一文件补：超过 10,000 行返回 `outcome:'refusedTooManyRows'` 与 `rowCount`；**旧行一行不少，且未被截断**
- [X] T063 [P] [US4] 编写 `packages/web/tests/refresh-failure.dom.test.tsx`：失败时显示服务端措辞的三要素；表格仍显示旧行；刷新按钮恢复可用

### 实现

- [X] T064 [US4] 在 `packages/server/src/api/data-sources.ts` 的刷新处理中把 `SheetsError` 映射为 `outcome:'failed'` 并保持存储不变，使 T060、T061 变绿
- [X] T065 [US4] 在 T042 的刷新决策中加入行数上限判定，返回 `refusedTooManyRows`，使 T062 变绿
- [X] T066 [P] [US4] 在 `packages/server/src/i18n/{zh-CN,en-US}.ts` 为七种 `reason` 各写三要素文案；`notShared` 的「下一步」带出机器身份邮箱；404 暂时附带「或者尚未分享给 X」（待 HW-2 确认后收敛）
- [X] T067 [US4] 在 `packages/web/src/features/data-sources/refresh-button.tsx` 展示失败结论（服务端措辞原样显示），使 T063 变绿

**检查点**：外部故障不再让打印停摆。

---

## Phase 7: User Story 5 - 表头变了要先说清楚 (P3)

**Goal**：加列直接应用；减列或改名要确认，并列出受影响的设计。

**Independent Test**：在 Google 表里改掉一个被设计引用的列名，按刷新，确认系统列出了受
影响的设计并要求确认。

### 测试

- [X] T068 [P] [US5] 编写 `packages/server/tests/integration/refresh-column-change.test.ts`：只新增列 → `applied` 且 `columnsAdded` 正确，不要求确认
- [X] T069 [P] [US5] 在同一文件补：有列消失 → `outcome:'needsConfirmation'`，列出 `removedColumns` 与 `affectedTemplates`；**存储一字未改**
- [X] T070 [P] [US5] 在同一文件补：带 `confirmColumnChange:true` → 应用；应用后受影响的设计其 `bindingIssue` 报 `columnsMissing`
- [X] T071 [P] [US5] 在同一文件补：无设计引用消失的列时，仍要求确认（列消失本身即为 breaking），且 `affectedTemplates` 为空数组
- [X] T072 [P] [US5] 编写 `packages/web/tests/column-change-confirm.dom.test.tsx`：确认框列出消失的列与受影响的设计名；取消后列与行不变

### 实现

- [X] T073 [US5] 在 T042 的刷新决策中接入 `classifyColumnChange`，`breaking` 且未确认时返回 `needsConfirmation`，使 T068、T069、T071 变绿
- [X] T074 [US5] 在刷新处理中复用既有的 `bindingIssue` 计算逻辑求出 `affectedTemplates`（读取时计算，不存储）
- [X] T075 [US5] 在 `packages/server/src/api/data-sources.ts` 支持请求体的 `confirmColumnChange`，使 T070 变绿
- [X] T076 [US5] 在 `packages/web/src/features/data-sources/column-change-dialog.tsx` 实现确认框，使 T072 变绿
- [X] T077 [US5] 在 `packages/web/src/features/data-sources/refresh-button.tsx` 接入该确认框，确认后带 `confirmColumnChange` 重发
- [ ] T078 [P] [US5] 在 `packages/web/src/i18n/{zh-CN,en-US}.ts` 加入确认框文案，须说明后果：引用这些列的设计将取不到值

**检查点**：五个故事全部完成，Web 端功能完整。

---

## Phase 8: Polish & Cross-Cutting

### 命令行（FR-035~037）

- [ ] T079 编写 `packages/cli/tests/data-source-refresh.test.ts`：对着真实服务器跑——成功退出 `0`；数据源不存在退出 `4`；服务不可达退出 `3`；`--json` 输出可解析
- [ ] T080 在同一文件补：`needsConfirmation` 在不加标志时退出 `4`；加 `--confirm-column-change` 后退出 `0`
- [ ] T081 在 `packages/cli/src/commands/data-source-refresh.ts` 实现该命令（走 REST，与 `template-io` 同一做法），使 T079、T080 变绿
- [ ] T082 在 `packages/cli/src/index.ts` 注册该命令

### 可观测性（FR-038、FR-039）

- [ ] T083 [P] 编写 `packages/server/tests/unit/refresh-logging.test.ts`：每次刷新记一条结构化结论（数据源、结果、前后行数、失败原因）；**日志中不含任何行内容**
- [ ] T084 在 `packages/server/src/api/data-sources.ts` 的刷新路径加入该日志，使 T083 变绿
- [ ] T085 [P] 编写 `packages/server/tests/unit/credentials-not-leaked.test.ts`：静态断言——`packages/server/src` 中对私钥字段的引用只出现在 `integrations/google-sheets-client.ts` 一处（FR-004、FR-004a 可被静态审查的依据）

### 需要联网的核实（手工，不是测试）

> 这两项**不做成测试**。宪章「测试 MUST 确定性：禁止依赖真实时钟、随机数或网络」是无
> 条件的，而其隔离条款只为「需要真实硬件的测试」开口，未涵盖「需要外部网络服务」。与其
> 把它们塞进一个措辞不覆盖的口子，不如放到手工验收里——它们核实的本就是**关于 Google 的
> 事实**，而不是本系统的行为；本系统的行为已由假实现全覆盖。

- [ ] T086 [P] 按 `quickstart.md` 第五节**手工核实 HW-1**：文本 `007`、日期、货币三列在 `FORMATTED_VALUE` 下的实际返回值，与表格中显示的逐字比对。把结论回写到 `research.md` R3
- [ ] T087 [P] 按 `quickstart.md` 第五节**手工核实 HW-2**：存在但未分享的表格返回 403 还是 404。据结果收敛 T066 里 404 的补充文案，并回写到 `research.md` R7

### 收尾

- [ ] T088 [P] 更新 `docs/google-sheets-data-source.md`，加入「实现状态（2026-08-22）」一节，体例照 `docs/variables-and-data-sources.md` §11
- [ ] T089 [P] 在 `README.md` 补充 Google 表格数据源的使用说明，指向 `quickstart.md`
- [ ] T090 跑完整门禁：`npm run typecheck`、`npx eslint .`、`npm test`、`npm run build --workspace=@zenith/web`
- [ ] T091 断网跑一次 `npm test`，确认全绿（FR-040 的实际验收，不是推断）
- [ ] T092 按 `quickstart.md` 第三节走完 A–G 七组手工验收

---

## Dependencies

```
Phase 1 Setup
    ↓
Phase 2 Foundational  ← 阻塞一切
    ↓
    ├─ US1 (P1) ──┐
    │             ↓
    ├─ US2 (P1) ──┤   US2 依赖 US1（要先有一个链接的数据源才能刷新）
    │             ↓
    ├─ US3 (P2) ──┤   US3 依赖 US1
    │             ↓
    ├─ US4 (P2) ──┤   US4 依赖 US2（失败是刷新的失败）
    │             ↓
    └─ US5 (P3) ──┘   US5 依赖 US2
                  ↓
            Phase 8 Polish
```

**故事间的真实依赖**：US1 是地基，其余四个都要先有一个链接的数据源。US2 是第二块地基，
US4 与 US5 都是刷新的分支路径。US3 与 US2 彼此独立，可并行。

**Phase 8 的 CLI 依赖 US5**：FR-036 要求命令行与界面行为完全一致，包括表头变化的处理。

---

## Parallel Execution Examples

**Phase 2 纯函数**（三个文件互不相干）：

```
T007 + T008 + T009   同时写测试
T010 + T011 + T012   同时实现
```

**每个故事内的测试**：同一故事的测试任务标了 `[P]` 的都可并行编写——它们在不同文件里，
且都只依赖 Phase 2 的产物。

**i18n 任务**：T030、T031、T035、T045、T049、T057、T066、T078 都改
`packages/web/src/i18n/` 或 `packages/server/src/i18n/`。**同一文件的不可并行**——标了
`[P]` 是相对于同故事内的其他任务而言，跨故事的 i18n 任务需顺序执行或做好合并。

**US3 与 US2 可并行**：两者只在 `data-sources.ts` 上有重叠，其余文件不相交。

---

## Implementation Strategy

### MVP = US1 + US2

**US1 单独交付**已有价值：能把一张 Google 表接进来打印，只是改了要重新链接。但那与既有
的 CSV 导入区别不大——**加上 US2 才是这个功能存在的理由**（不必重新上传）。因此 MVP 取
两者。

### 增量顺序

1. **Phase 1–2**：端口、假实现、三个纯函数、迁移、仓储。此后所有测试都能脱网跑
2. **US1**：接进来
3. **US2**：改了能同步 ← **MVP 到此**
4. **US3**：只读与解绑（防止无声的数据丢失）
5. **US4**：失败不阻塞打印（价值在故障时才显现）
6. **US5**：表头变化的确认（最容易被忽略、后果只在印出来时显现）
7. **Phase 8**：CLI、日志、门禁、手工验收（含两项联网核实）

### 两处容易做错的地方

- **T012 的注释不能省**。Google 那边无法区分「改名」和「删一列加一列」，判定只看差集。
  不写清楚，后来者会试图推断改名而永远推断不准。
- **T052 测的是执行路径**。只测「只读态下被拦截」是不够的——解绑之后编辑路径必须真的
  恢复可用，否则拦截逻辑写死了也照样绿。
