---
description: "Task list for 003-variables-data-sources"
---

# Tasks: 变量与表格数据源

**Input**: `specs/003-variables-data-sources/` 的设计文档

**Prerequisites**: plan.md、spec.md、research.md、data-model.md、contracts/

**Tests**: 按宪章原则 II，测试任务**不可省略**。每个用户故事的测试任务列在实现任务之前，
且必须先看到它们变红。

**Organization**: 按用户故事分组，使每个故事可独立实现、独立验证、独立交付。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成的前置依赖）
- **[Story]**: 所属用户故事（US1 / US2 / US3）
- 每条都带确切文件路径

## Path Conventions

npm workspaces 四包结构，不新增包：

- `packages/shared/src/`、`packages/shared/tests/`
- `packages/server/src/`、`packages/server/tests/`
- `packages/web/src/`、`packages/web/tests/`
- `packages/cli/src/`

---

## Phase 1: Setup（共享基础设施）

**Purpose**: 装依赖、备夹具。三条都不触碰既有行为，四条门禁在本阶段结束时仍应全绿。

- [X] T001 在 `packages/web/package.json` 增加 `@tanstack/react-table` 依赖并 `npm install --workspace=@zenith/web`（research R10）
- [X] T002 [P] 新增 shadcn Table 原语 `packages/web/src/components/ui/table.tsx`（`Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`），复用既有 `cn()` 与主题令牌
- [X] T003 [P] 建立 CSV 测试夹具目录 `packages/server/tests/fixtures/csv/`，含五个文件：`utf8-leading-zeros.csv`（含 `007`）、`gbk-semicolon.csv`（GBK 编码、分号分隔）、`no-header.csv`、`duplicate-columns.csv`、`quoted-newline.csv`（引号内含换行与分隔符）

**Checkpoint**: 依赖与夹具就绪，尚未改动任何行为。

---

## Phase 2: Foundational（阻塞性前置）

**Purpose**: `${}` 解析器、IR 内容收窄、四步迁移、错误码与术语。三个用户故事全部依赖本阶段。

**⚠️ CRITICAL**: 本阶段完成前，任何用户故事都不能开工。

**⚠️ 本阶段中途会红**：T011 收窄 IR 的 `content` 之后，服务端与前端在 T025–T029 完成前无法编译。
这是一次有意的破坏性移除（FR-002、FR-051，当前无生产数据），**阶段末尾必须四条门禁全绿**。

### 文法解析器（先测后写）

- [X] T004 [P] 文法契约测试 `packages/shared/tests/template-parse.test.ts`：逐条覆盖 `contracts/variable-grammar.md` 的 15 条边界用例（`版本 ${major}.${minor}`、`批号 ${lot}.{已校验}`、`$${sku}`、`$$${sku}`、`$$`、`${ sku }`、`${}`、`${ }`、`${sk`、`${单价.含税}`、`${a.b.c}`、`${收件 人}`、`${说"明"}`、`价格 $100`）。先跑，必须全红
- [X] T005 [P] 求值测试 `packages/shared/tests/template-evaluate.test.ts`：可解析代入其值；`unterminated` 原样输出且**不进入未解析列表**；已闭合但名称不存在 → 原样输出并计入未解析列表；**断言求值函数在任何输入下都不抛异常**（FR-016）
- [X] T006 实现扫描器 `packages/shared/src/template/parse.ts`：`parse(content): Segment[]`，`Segment` 联合含 `literal` / `ref{name}` / `unterminated`。**单层命名空间**：花括号内除 `}` 外一律是名称的一部分，无路径分隔、无引号段
- [X] T007 实现求值 `packages/shared/src/template/evaluate.ts`：`evaluate(content, lookup): { text: string; unresolved: string[] }` 与 `collectReferences(ir): string[]`（供提交前校验与列引用扫描共用）；另出 `detectNameCollisions(variables, columns): string[]`，常量/自增与列重名时列出名称（FR-009b）
- [X] T008 变量定义 schema `packages/shared/src/template/variables.ts`：`{ name, kind: 'constant', value }` 与 `{ name, kind: 'sequence', poolId }` 的 zod 联合；名称校验按 FR-009a（不含 `}`，首尾空白去除，非空）
- [X] T009 序号格式化迁移 `packages/shared/src/template/sequence.ts`：把 `formatSequence` 与 `SequenceOverflowError` 从 `packages/shared/src/ir/resolve-variables.ts` 搬来（行为不变）
- [X] T010 在 `packages/shared/src/index.ts` 导出 `./template/parse.ts`、`./template/evaluate.ts`、`./template/variables.ts`、`./template/sequence.ts`

### IR 收窄

- [X] T011 更新 `packages/shared/tests/ir-schema.test.ts`：`content` 恒为字符串，`{ $var: 'x' }` 必须被 schema 拒绝
- [X] T012 在 `packages/shared/src/ir/schema.ts` 把 `content` 由 `string | { $var: string }` 收窄为 `string`，删除 `isVariableRef` 与 `isVariableCapable`
- [X] T013 删除 `packages/shared/src/ir/resolve-variables.ts` 与 `packages/shared/tests/resolve-variables.test.ts`（`sampleValues` 一并消失——常量与序号不再需要「样例值」这一层）
- [X] T014 `packages/shared/src/ir-to-svg/index.ts`：绘制文字/条码/二维码之前先对 `content` 求值；未解析引用沿用既有 `skipUnrenderable` 策略（编辑器容忍，打印路径严格）
- [X] T015 更新 `packages/shared/tests/ir-to-svg.test.ts`、`packages/shared/tests/ir-svg-parity.test.ts`、`packages/shared/tests/render-parity.test.ts` 以匹配新的 `content` 类型

### 术语与错误码

- [X] T016 [P] `packages/shared/src/terms.ts`：移除 `variableField`，新增 `variable`、`dataSource`、`sequencePool`、`rowSelection`；`FORBIDDEN_SYNONYMS` 同步（`field`/`placeholder` → `variable`，`table`/`dataset` → `dataSource`，`counter` → `sequencePool`）
- [X] T017 [P] `packages/server/src/api/errors.ts`：登记 `contracts/rest-api.md` 的 14 个新错误码及其状态码；移除随可变字段消失的旧码
- [X] T018 [P] `packages/server/src/i18n/zh-CN.ts`：为 14 个新错误码各写一条三要素文案（什么 / 为什么 / 下一步）
- [X] T019 [P] `packages/server/src/i18n/en-US.ts`：同上，英文
- [X] T020 [P] `packages/web/src/i18n/zh-CN.ts` 与 `packages/web/src/i18n/en-US.ts`：数据源、序号池、行选择、变量面板的界面文案键位

### 迁移（先测后写）

- [X] T021 扩充 `packages/server/tests/unit/migrations.test.ts`：断言迁移 7–10 之后 —— 三张新表与 `job_sequence_claims` 存在且索引齐备；`templates.variables` 与 `templates.data_source_id` 两列存在；`variable_fields` 表不存在；`print_jobs.seq_ranges` 列不存在；**打印机、打印参数与偏移校正值逐字段保留**（FR-052）
- [X] T022 迁移 7 于 `packages/server/src/db/migrations/index.ts`：建 `data_sources`、`data_source_rows`（主键 `(source_id, ordinal)`、外键 ON DELETE CASCADE）、`sequence_pools`、`job_sequence_claims(job_id, pool_id, start, end, step, digits)` 及 `job_sequence_claims(pool_id)` 索引
- [X] T023 迁移 8 于 `packages/server/src/db/migrations/index.ts`：`templates` 增加 `variables TEXT NOT NULL DEFAULT '[]'` 与 `data_source_id TEXT NULL REFERENCES data_sources(id)` 两列
- [X] T024 迁移 9 于 `packages/server/src/db/migrations/variable-migration.ts`（走 `apply` 钩子）：把既有 `print_jobs.seq_ranges` 的内容搬进 `job_sequence_claims`，随后 `DROP COLUMN seq_ranges`、`DROP TABLE variable_fields`
- [X] T025 迁移 10 于 `packages/server/src/db/migrations/variable-migration.ts`：既有模板元素内容中的 `{ $var: x }` 改写为 `${x}`，其余内容里字面的 `${` 转义为 `$${`（Assumptions 已声明此为必需的一次性改写）

### 拆除旧机制

- [X] T026 删除 `packages/server/src/domain/variable-field.ts`；`packages/server/src/domain/sequence-allocator.ts` 暂时改为按 `job_sequence_claims` 读写（US1 再补池语义）
- [X] T027 `packages/server/src/domain/print-job.ts`：从 `printJobInputSchema` 移除 `manualFieldValues` 与 `sequenceOverrides`；`ContentSnapshot` 预留 `rows` 与 `copiesPerRow`（US2 填充）
- [X] T028 `packages/server/src/api/templates.ts`：移除 `DELETE /api/templates/:id/print-form` 端点及其路由注册；`packages/server/src/render/job-pages.ts` 改为对空变量表求值
- [X] T029 删除前端旧件：`packages/web/src/editor/variable-field-panel.tsx`、`packages/web/src/features/print/field-form.tsx`、`packages/web/src/features/print/print-form-fields.ts`、`packages/web/tests/print-form-fields.test.ts`；`packages/web/src/features/print/print-dialog.tsx` 与 `packages/web/src/editor/preview-values.ts` 改为走 `@zenith/shared` 的求值。**残余引用由下面两条按清单清理**——`isVariableRef` / `sampleValues` / `variableFields` 还活在 13 个源文件与 9 个测试文件里
- [X] T030 清理服务端残余引用：`packages/server/src/domain/template.ts`（移除 `variableFields` 及其取值器）、`packages/server/src/domain/overflow.ts`、`packages/server/src/queue/manager.ts`（`resolveVariables` 改为新求值），以及 `packages/server/tests/unit/domain-helpers.test.ts`、`packages/server/tests/unit/job-pages.test.ts`、`packages/server/tests/integration/template-print.test.ts`、`packages/server/tests/integration/templates-api.test.ts`
- [X] T031 清理前端残余引用：`packages/web/src/editor/autofit.ts`、`packages/web/src/editor/guards.ts`、`packages/web/src/editor/layers-panel.tsx`、`packages/web/src/editor/editor-page.tsx`（八处，含变量改名时的元素联动与 `sampleValues` 调用）、`packages/web/src/pages/templates-page.tsx`、`packages/web/src/features/templates/hooks.ts`，以及 `packages/web/tests/guards.test.ts`、`packages/web/tests/preview-values.test.ts`、`packages/web/tests/editor-elements.dom.test.tsx`、`packages/web/tests/print-preview.dom.test.tsx`、`packages/web/tests/open-template.dom.test.tsx`
- [X] T032 负向断言 `packages/web/tests/print-preview.dom.test.tsx`：打印对话框**不再**渲染手工字段表单（宪章原则 II —— 页面职责被划走时补一条负向断言，锁住它不再出现在原处）

**Checkpoint**: `npm run typecheck` / `lint` / `test` / `build --workspace=@zenith/web` 四条全绿。
此时系统仍是一个能用的标签编辑器：不含变量的设计照常打印，`${x}` 显示为字面文本。

---

## Phase 3: User Story 1 - 用变量消除重复内容 (Priority: P1) 🎯 MVP

**Goal**: 三种变量中的两种（设计期常量、自增）可用；内容里内联 `${名称}`；画布显示代入后的样子；
序号池独立于设计存在、可被多个设计共用、可重置。

**Independent Test**: 新建设计，定义常量 `sku` 与自增变量 `serial`，在文字与二维码里各引用一次，
打印 5 份；确认 5 张 SKU 一致、序号递增；再打一批，确认从上次停下的号码继续。

### Tests for User Story 1（MANDATORY - 宪章原则 II）⚠️

> 先写、先看红。序号是本故事里唯一「错了就贴到实物上」的部分，测试要压住的是重号而非跳号。

- [ ] T033 [P] [US1] `packages/server/tests/unit/sequence-pool.test.ts`：`current = max(floor, 已消耗最大值)`；空历史时 `current = floor`；重置只抬高 `floor` 而不动历史；`nextValue = current + step`
- [ ] T034 [P] [US1] 重写 `packages/server/tests/unit/sequence-allocator.test.ts`：领取按**池 id** 收窄而非 `template_id`；**两个不同模板引用同一池，各领一批后号码不重叠**（AS-6）；溢出整批回滚；取消任务归还号段
- [ ] T035 [P] [US1] `packages/server/tests/integration/sequence-pools-api.test.ts`：`GET`/`POST`/`PATCH` 契约；`PATCH` 不能改 `current`；`POST /reset` 无 `confirm` → `422 CONFIRMATION_REQUIRED`，带 `confirm` → `200` 且返回新 `current`；`DELETE` 在仍被设计引用时 → `409 SEQUENCE_POOL_IN_USE` 并列出设计，否则 `204`，且**已发放的号段留存**（FR-006a）
- [ ] T036 [P] [US1] `packages/server/tests/integration/variables-print.test.ts`：**连续 10 批各 5 张**，逐批断言起始号紧接上批末号，全程无重号无跳号（AS-5、SC-004）；内容含未定义引用 → `422 VARIABLE_NOT_DEFINED` 且 `details.reference` 指出是哪一个；**未保存为模板的设计也能用自增变量**（FR-007）
- [X] T037 [P] [US1] `packages/web/tests/variable-panel.dom.test.tsx`：定义常量 `sku = ABC-123` 后，内容为 `零件 ${sku} 号` 的文字元素在画布上显示 `零件 ABC-123 号`（AS-2）；`版本 ${major}.${minor}` 代入两个值且中间点号原样（AS-3）；`$${sku}` 显示字面 `${sku}`（AS-4）
- [X] T038 [P] [US1] `packages/web/tests/variable-typing.dom.test.tsx`：在文字内容里**逐字**敲入 `$` → `${` → `${s` → `${sk` → `${sku` → `${sku}`，每一步都断言无错误提示出现、输入框保持聚焦、画布未抛异常（SC-006、FR-013、FR-016）
- [X] T039 [P] [US1] `packages/web/tests/print-blocked-unresolved.dom.test.tsx`：内容引用了未定义的名称时，画布原样显示该引用、底部出现阻塞性提示、打印按钮 `disabled`（AS-1）

### Implementation for User Story 1

- [X] T040 [P] [US1] `packages/server/src/domain/sequence-pool.ts`：`SequencePool` zod schema（`name` 唯一、`digits`、`step`、`floor`）与 `currentValue(floor, highestConsumed)` 纯函数
- [X] T041 [P] [US1] `packages/server/src/db/repositories/sequence-pool-repo.ts`：CRUD + `highestConsumed(poolId)`（查 `job_sequence_claims`，按池 id 索引）
- [X] T042 [US1] 重写 `packages/server/src/domain/sequence-allocator.ts`：领取写入 `job_sequence_claims`，`#highestConsumed` 改按 `pool_id` 查询；`suggest` / `allocate` / `release` / `conflictsWithHistory` 的签名由「字段」改为「池」（依赖 T040、T041）
- [ ] T043 [US1] `packages/server/src/api/sequence-pools.ts`：实现 `contracts/rest-api.md` 的五个端点（列表、建立、修改、重置、删除），响应含 `floor`，并在 `packages/server/src/app.ts` 注册
- [X] T044 [P] [US1] `packages/server/src/db/repositories/template-repo.ts`：读写 `variables`（JSON）与 `data_source_id` 两列，用 T008 的 schema 校验
- [X] T045 [US1] `packages/server/src/api/templates.ts`：模板的建立/更新/读取带上 `variables` 与 `dataSourceId`
- [X] T046 [US1] `packages/server/src/api/job-submission.ts`：提交前用 `collectReferences` 校验每个引用可解析，否则 `422 VARIABLE_NOT_DEFINED`；把设计的 `variables` 解析为求值表（依赖 T042）
- [ ] T047 [US1] `packages/server/src/render/job-pages.ts`：`valuesForCopy` 由 `job_sequence_claims` 与常量定义合成；`hasPerCopyContent` 按是否存在序号声明判定
- [ ] T048 [US1] `packages/server/src/api/preview.ts`：移除 `variableValues`，改为用设计的变量定义求值（`rowOrdinal` 留待 US2）
- [ ] T049 [P] [US1] `packages/web/src/api/types.ts` 与 `packages/web/src/api/client.ts`：序号池端点的类型与调用；移除 print-form 相关类型
- [X] T050 [US1] `packages/web/src/editor/variables-panel.tsx`（新建，取代已删的 `variable-field-panel.tsx`）：常量的增删改；自增变量选择或新建序号池；名称按 FR-009a 校验；与所绑数据源的列重名时就地提示（FR-009b）
- [ ] T051 [US1] `packages/web/src/editor/preview-values.ts`：改为调用 `@zenith/shared` 的 `evaluate`，返回代入后的 IR 与未解析引用列表；**任何输入都不抛异常**（依赖 T007）
- [ ] T052 [US1] `packages/web/src/editor/inspector.tsx`：接入变量面板，元素内容输入框改为普通模板串输入（不再有「绑定/未绑定」的概念）
- [X] T053 [P] [US1] `packages/web/src/features/sequence-pools/hooks.ts`：序号池的 react-query 读写
- [ ] T054 [US1] `packages/web/src/features/sequence-pools/pools-panel.tsx`：列出池与当前值；重置走 `AlertDialog`，显示当前 `floor` 以便说清「从几重置到几」，文案必须写明**可能与已贴出的标签重号**（FR-006、宪章 III.0）；删除同样走确认并列出引用它的设计（FR-006a）
- [ ] T055 [US1] `packages/web/src/pages/settings-page.tsx`：挂入序号池面板（不新增可导航页面，故不新增路由）
- [ ] T056 [US1] `packages/web/src/features/print/print-dialog.tsx`：显示未解析引用的阻塞提示并禁用打印按钮（依赖 T051）

**Checkpoint**: US1 可独立验收 —— 不引入任何数据源，系统已比改造前更好：一处改动，多处跟随。

---

## Phase 4: User Story 2 - 从表格批量打印 (Priority: P2)

**Goal**: 表格数据源（CSV 上传、剪贴板粘贴、站内编辑）；设计绑定一个数据源、内容写 `${列名}`；
打印时勾选行，每行一张。

**Independent Test**: 上传一张 20 行的 CSV，把设计绑定到它并引用其中两列，勾选第 5–12 行打印；
确认印出 8 张，内容与对应行一致，顺序与表格一致。

**Dependency**: 依赖 US1 的引用语法与求值管线；不依赖 US3。

### Tests for User Story 2（MANDATORY - 宪章原则 II）⚠️

> CSV 那一组测试压的是「印出来才发现」的一类数据损坏：`007` 变 `7`、中文变乱码、
> 整行落进一列。它们都要用 T003 的真实字节夹具，不能用手搓的字符串。

- [ ] T057 [P] [US2] `packages/shared/tests/csv-delimited.test.ts`：RFC 4180 引号规则（`""` 转义、引号内含分隔符与换行）、`\r\n` 与 `\n` 两种行尾、末行无换行
- [ ] T058 [P] [US2] `packages/server/tests/unit/csv-import.test.ts`：分隔符在 `,`/`;`/`\t` 间按表头行计数探测；GBK 夹具解码出正确中文；无表头拒绝；重复列名拒绝并指出列名；空白列名拒绝；超 10,000 行拒绝并给出行数与上限；`007` 逐字保留；数据行列数与表头不一致时的处理
- [ ] T059 [P] [US2] `packages/server/tests/unit/row-selection.test.ts`：`{all:true}` 在提交时展开为全部 ordinal；`ranges` 与 `ids` 合并去重；**结果始终按 ordinal 升序，与勾选先后无关**（AS-9、FR-037）；空选择产出空数组
- [ ] T060 [P] [US2] `packages/server/tests/unit/template-refs.test.ts`：从模板内容里扫出被引用的**列名**；按 `dataSourceId` 找出引用某数据源的全部设计（供删除与替换的影响面提示使用）
- [ ] T061 [P] [US2] `packages/server/tests/integration/data-sources-api.test.ts`：上传建立 / 分页读行 / `PATCH` 增改删 / 改名 / 删除；名称重复 → `409 DATA_SOURCE_NAME_TAKEN`（建立与改名两条路径都要拦）；**改名后设计的绑定与全部 `${列名}` 引用不受影响**（AS-4c、FR-019）；**删除即使仍被引用也 `204`**，无 `confirm` 则 `422 CONFIRMATION_REQUIRED`（FR-028）；替换导致旧列消失 → `409 DATA_SOURCE_COLUMNS_REMOVED` 且列出 `removedColumns` 与 `affectedTemplates`，带 `confirm=true` 后 `200`（AS-4a、FR-021a）；`PATCH` 引入表中没有的列 → `422 DATA_SOURCE_UNKNOWN_COLUMN`
- [ ] T062 [P] [US2] `packages/server/tests/integration/data-source-print.test.ts`：区间 `5-12` → 印 8 张且内容与对应行逐字一致；份数 2 → 每行连续两张、**含序号在内完全相同**（AS-10、FR-036）；未选行 → `422 NO_ROWS_SELECTED`；常量与所绑数据源的列重名 → `422 VARIABLE_NAME_COLLIDES` 且指出名称（FR-009b）；行数×份数 > 1000 → `422 BATCH_TOO_LARGE` 且**在打印任何东西之前**拒绝
- [ ] T063 [P] [US2] `packages/server/tests/unit/binding-issue.test.ts`：`bindingIssue` 为 `null` / `sourceMissing`（所绑数据源已删）/ `columnsMissing`（引用的列在当前表中不存在，列出列名）三态；**断言它是读取时算出来的**——先建立正常绑定并读到 `null`，再删除数据源，同一模板重新读出 `sourceMissing`，中间不做任何写入（FR-028a）
- [ ] T064 [P] [US2] `packages/web/tests/binding-warning.dom.test.tsx`：模板列表对 `bindingIssue` 非空的设计显示警告标记；设计页同样显示，且打印按钮不可用（FR-028a、FR-014）
- [ ] T065 [P] [US2] `packages/server/tests/integration/snapshot-frozen.test.ts`：任务提交后修改数据源（改值、删行），该任务的历史内容与补打结果均不变（AS-12、FR-039、FR-040、SC-005）
- [ ] T066 [P] [US2] `packages/server/tests/integration/selection-refusals.test.ts`：勾选 `5-12` 后删除第 7 行再提交 → `422 ROW_SELECTION_STALE` 且 `details.missingOrdinals` 含 7，而 `{all:true}` 在同样情形下照常提交（FR-033a）；条码引用的列在所选行中有空值 → `422 BARCODE_EMPTY_VALUE` 且指出列名与行号，**并注入计数器断言该校验一次条码都没编**（划清 FR-045b 与 FR-045 的边界）
- [ ] T067 [P] [US2] `packages/server/tests/integration/csv-import-performance.test.ts`：10,000 行 CSV 从收到请求到可用于打印 < 30 秒（SC-002-pre）。这条测的是写入策略而非机器速度 —— 逐行 `INSERT` 会稳定超时，单事务批量写入不会
- [ ] T068 [P] [US2] `packages/web/tests/paste-table.test.ts`：TSV 按制表符分列、换行分行；从选中单元格起覆盖；超出末行追加新行；**超出最后一列拒绝并说明原因**（FR-049）；粘贴内容不构成表格时作为单个单元格的值（FR-050）
- [ ] T069 [P] [US2] `packages/web/tests/data-sources-page.dom.test.tsx`：**渲染断言**（挂载不抛异常）；空状态可见；「新建」入口可达（宪章原则 II、plan 的页面表）
- [ ] T070 [P] [US2] `packages/web/tests/data-source-editor.dom.test.tsx`：**渲染断言**；表格渲染出表头与首页数据；粘贴入口可达；编辑单元格与增删行触发正确的请求体
- [ ] T071 [P] [US2] `packages/web/tests/row-selection.dom.test.tsx`：行选择区**渲染断言**；每页 10 行；「全选」按钮标明总行数且选中整表而非当前页（FR-034）；区间输入 `5-12` 选中 8 行；乱序勾选后提交的选择按行号排列

### Implementation for User Story 2

- [ ] T072 [P] [US2] `packages/shared/src/csv/parse-delimited.ts`：引号感知的分隔文本切分（供服务端 CSV 与前端粘贴共用，research R4/R11），并在 `packages/shared/src/index.ts` 导出
- [ ] T073 [P] [US2] `packages/server/src/domain/data-source.ts`：`DataSource` 与 `DataSourceRow` 的 zod schema、`MAX_ROWS = 10000`、名称与列名校验（FR-019、FR-023a、FR-026a）
- [ ] T074 [P] [US2] `packages/server/src/csv/encoding.ts`：`TextDecoder` 按 UTF-8（含 BOM）→ GB18030 → Big5 顺序探测，判据为无 U+FFFD；支持手工指定（research R2）
- [ ] T075 [P] [US2] `packages/server/src/csv/delimiter.ts`：在 `,`/`;`/`\t` 中取表头行（引号外）出现最多者；全为 0 时按逗号处理（research R3）
- [ ] T076 [US2] `packages/server/src/csv/import.ts`：编码 → 分隔符 → 切分 → 表头校验 → 行数校验的完整导入管线，**一切皆文本、不做任何类型推断**（FR-024）（依赖 T072、T074、T075）
- [ ] T077 [US2] `packages/server/src/db/repositories/data-source-repo.ts`：建立/替换/分页读行/增改删行/删除；`row_count` 冗余字段随写更新（research R7）
- [ ] T078 [P] [US2] `packages/server/src/domain/row-selection.ts`：`{all} | {ranges, ids}` 的展开，结果按 ordinal 升序去重（research R9）
- [ ] T079 [P] [US2] `packages/server/src/domain/template-refs.ts`：按 `data_source_id` 查出引用某数据源的设计（一次索引查询，不再扫描内容字符串），并用 `collectReferences` 取出它们引用的列名，供删除与替换的影响面提示使用（依赖 T007）
- [ ] T080 [US2] `packages/server/src/api/data-sources.ts`：六个端点（列表、读行、建立、替换、编辑、删除），multipart 沿用 `@fastify/multipart` 的既有用法；并在 `packages/server/src/app.ts` 注册（依赖 T076–T079）
- [ ] T081 [US2] `packages/server/src/domain/print-job.ts`：`printJobInputSchema` 增加可选 `rowSelection`；`ContentSnapshot` 落实 `rows` 与 `copiesPerRow`；`MAX_COPIES` 之外新增 `MAX_LABELS_PER_JOB = 1000`
- [ ] T082 [US2] `packages/server/src/api/job-submission.ts`：展开行选择 → 抄入快照 → 校验张数上限、零行、名称重名（FR-009b）；**上限校验先于任何渲染与领号**（FR-043）。「多数据源」无需校验——绑定是模板上的单个字段，写不出第二个（依赖 T078、T079、T081）
- [ ] T083 [US2] `packages/server/src/domain/barcode-refs.ts`：找出被条码/二维码引用的列，在所选行中**逐列比较字符串**查空值（不编码）；`packages/server/src/api/job-submission.ts` 接入该校验与行选择过期校验（FR-033a、FR-045b）
- [ ] T084 [US2] `packages/server/src/render/job-pages.ts`：`row = snapshot.rows[floor(index / copiesPerRow)]`，与序号值合并后求值（data-model 的 `irForCopy`）
- [ ] T085 [US2] `packages/server/src/api/preview.ts`：新增可选 `rowOrdinal`，缺省取打印顺序上的第一行（FR-041）
- [ ] T086 [P] [US2] `packages/web/src/api/types.ts` 与 `packages/web/src/api/client.ts`：数据源端点、`rowSelection` 提交字段的类型与调用
- [ ] T087 [P] [US2] `packages/web/src/features/data-sources/hooks.ts`：列表、分页读行、上传、替换、编辑、删除的 react-query 封装
- [ ] T088 [P] [US2] `packages/web/src/features/data-sources/paste.ts`：剪贴板 `text/plain` 的表格还原（依赖 T072），含追加行、拒绝新增列、非表格降级为单格（FR-046–FR-050）
- [ ] T089 [US2] `packages/web/src/features/data-sources/columns.tsx`：TanStack Table 的列定义，两处共用（编辑页与行选择），编辑能力不共用（research R10）
- [ ] T090 [US2] `packages/server/src/domain/binding-issue.ts` 与 `packages/server/src/api/templates.ts`：读取模板时计算 `bindingIssue`（所绑数据源是否存在、其列是否覆盖内容里引用的名字），**不落库**——存储的状态会与数据源的实际情况漂移，而漂移的方向恰好是「显示正常、实则已断」（FR-028a，依赖 T079）
- [ ] T091 [US2] `packages/web/src/pages/templates-page.tsx` 与 `packages/web/src/editor/data-source-binding.tsx`：对 `bindingIssue` 非空的设计显示警告标记并说明可以重新绑定（FR-028a）
- [ ] T092 [US2] `packages/web/src/features/data-sources/data-sources-page.tsx`：列表页，显示每个数据源的行数与列名（FR-027）；空状态与「新建」入口
- [ ] T093 [US2] `packages/web/src/features/data-sources/data-source-editor.tsx`：可编辑表格 —— 单元格编辑、增行、删行、粘贴（依赖 T088、T089）
- [ ] T094 [P] [US2] `packages/web/src/features/data-sources/upload-dialog.tsx`：CSV 上传，名称默认取自来源文件名（去扩展名）且可改（FR-020）；失败时可手工指定编码与分隔符后重试（FR-022、FR-022a）
- [ ] T095 [US2] 导入进度反馈：`packages/server/src/api/data-sources.ts` 按已解析行数上报，`packages/web/src/features/data-sources/upload-dialog.tsx` 显示进度（宪章 III.0：超 2 秒的操作 MUST 有进度；万行导入的预算是 30 秒）
- [ ] T096 [P] [US2] `packages/web/src/features/data-sources/destructive-dialogs.tsx`：替换确认（列出会断掉的设计与消失的列名）与删除确认（理由是**表内的行不可恢复**，不列引用者、不因被引用而拦）两个对话框，外加就地改名（FR-021a、FR-028）
- [ ] T097 [US2] `packages/web/src/app/routes.ts`：`TAB_KINDS` 与 `STATIC_PATHS` 增加 `data-sources`（`/data-sources`）与数据源编辑（`/data-sources/:id`）；`packages/web/tests/routes.test.ts` 同步扩充
- [ ] T098 [US2] `packages/web/src/app/sidebar.tsx` 与 `packages/web/src/app/workspace.tsx`：接入两个新页面
- [ ] T099 [P] [US2] `packages/web/src/features/print/selection.ts`：前端侧的选择状态（全选 / 区间 / 勾选）与紧凑表示的互转，纯函数
- [ ] T100 [US2] `packages/web/src/features/print/row-selection.tsx`：打印对话框中的行选择区，每页 10 行、全选标明行数、区间输入（依赖 T089、T099）
- [ ] T101 [US2] `packages/web/src/features/print/print-dialog.tsx`：接入行选择；张数显示为「所选行数 × 份数」；**明确写出「未按行检查内容宽度」**（FR-045a）
- [ ] T102 [US2] `packages/web/src/features/print/preview.tsx`：预览打印顺序上的第一张（依赖 T085）

- [ ] T103 [US2] `packages/web/src/editor/data-source-binding.tsx`、`packages/web/src/editor/preview-values.ts` 与 `packages/web/src/features/data-sources/hooks.ts`：属性栏里选择设计所绑的数据源（可清空）并列出其列名供插入；编辑器对 `${列名}` 代入所绑数据源的**首行值**（FR-009、FR-015）。少了这一步，引用了数据源的设计在画布上永远是空白 —— 而画布正是判断排版的唯一依据


**Checkpoint**: US1 与 US2 均可独立验收。一个模板覆盖一整批内容不同的标签已经成立。

---

## Phase 5: User Story 3 - 大批量不必空等 (Priority: P3)

**Goal**: 驱动端口由数组改为「总数 + 按序取页」，第一张标签在一秒内开始输出。

**Independent Test**: 提交一个 500 张的任务，测量从点击「确认打印」到第一张开始出纸的时间。

**Dependency**: 逻辑上独立于 US1/US2，但只有在 US2 之后才有真实的大批量可测。

### Tests for User Story 3（MANDATORY - 宪章原则 II）⚠️

> 这组测试要压住的是「惰性」本身。断言「结果正确」不足以发现预先渲染 —— 数组版也正确，
> 只是慢。因此断言的是**渲染发生的时机与次数**。

- [ ] T104 [P] [US3] `packages/server/tests/unit/page-source.test.ts`：构造 `pageSource(job, render)` 时 `render` **调用次数为 0**；`at(0)` 后为 1；`total` 与「行数 × 份数」一致；同一行的多份复用同一次渲染
- [ ] T105 [P] [US3] 扩充 `packages/server/tests/support/queue-harness.ts` 记录 `renderPage` 的调用序，并在 `packages/server/tests/integration/queue.test.ts` 断言**驱动发出第一页时，渲染调用次数不超过 1**
- [ ] T106 [P] [US3] 扩充 `packages/server/tests/integration/performance.test.ts`：500 张任务从提交到第一页交付驱动的耗时 < 1 秒（SC-003）。**vitest 超时须显式设置为大于测试自身预算**，否则失败会表现为无断言信息的超时
- [ ] T107 [P] [US3] `packages/server/tests/integration/partial-failure.test.ts`：大批量中途驱动抛错，`pagesPrinted` 如实记录已发出张数；崩溃导致不可知时为 `null`（AS-3、FR-053 既有语义）

- [ ] T108 [P] [US3] 改写 `packages/server/tests/unit/print-job-overflow.test.ts`：注入条码编码计数器，断言提交 1000 张的任务时**编码次数与行数无关**；设计本身的越界仍被检出（FR-045）
- [ ] T109 [P] [US3] 更新既有驱动测试的调用形态为 `PageSource`：`packages/server/tests/unit/dry-run-driver.test.ts`、`packages/server/tests/unit/driver-lifecycle.test.ts`（9 处）、`packages/server/tests/integration/zpl-driver.test.ts`（5 处）、`packages/server/tests/integration/niimbot-driver.test.ts`、`packages/server/tests/integration/printers-api.test.ts`


### Implementation for User Story 3

- [ ] T110 [US3] `packages/server/src/drivers/port.ts`：新增 `PageSource { readonly total: number; at(index: number): BinaryBitmap }`，`PrinterDriver.printPages` 的首参由 `BinaryBitmap[]` 改为 `PageSource`（contracts/driver-port.md）
- [ ] T111 [US3] `packages/server/src/render/job-pages.ts`：`buildJobPages` 改为 `pageSource(job, render): PageSource`，按下标惰性渲染，**MUST NOT 预先构建数组**（依赖 T110）
- [ ] T112 [US3] `packages/server/src/queue/print-queue.ts`：改为构造 `PageSource` 后立即交给驱动，第一页渲染完即开始输出（依赖 T111）
- [ ] T113 [US3] `packages/server/src/domain/overflow.ts` 与 `packages/server/src/api/print-jobs.ts`：**停止逐份展开的 `checkBatch`**，改为只检查设计本身（用编辑器同款的代入值）。这是 FR-045 的落点，也是 SC-003 的前提 —— 现状是 1000 行的任务要在开印前编 1000 次条码，正好抵消流式渲染换来的那一秒
- [ ] T114 [P] [US3] `packages/server/src/drivers/niimbot/niimbot-driver.ts` 与 `packages/server/src/drivers/niimbot/bitmap-source.ts`：逐页取用，每页发出后上报进度
- [ ] T115 [P] [US3] `packages/server/src/drivers/zpl/zpl-driver.ts`：同上
- [ ] T116 [P] [US3] `packages/server/src/drivers/dry-run/dry-run-driver.ts`：同上
- [ ] T117 [US3] `packages/cli/src/commands/zpl-test.ts:135`：`printPages` 的调用改为 `PageSource`（CLI 是端口的第五个消费方，漏掉它会直接打红 `typecheck` 门禁）
- [ ] T118 [US3] 在 `docs/design-consensus.md` 或 `tspl-gp3120tu` 分支的 README 记一条待办：搁置中的 TSPL 驱动需跟随本次端口变更（contracts/driver-port.md 已列为受影响的第四个驱动）

**Checkpoint**: 三个用户故事均独立可用。

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T119 [P] `packages/web/tests/i18n-completeness.test.ts`：确认 14 个新错误码在两种语言里都有三要素文案，界面新键位无缺失
- [ ] T120 [P] 覆盖率复核：`packages/shared/src/template/`、`packages/shared/src/csv/`、`packages/server/src/csv/`、`packages/server/src/domain/row-selection.ts`、`packages/server/src/domain/sequence-pool.ts` 的行覆盖 ≥ 80%（宪章原则 II）
- [ ] T121 [P] `docs/variables-and-data-sources.md`：标注本期实现范围与 Google Sheets 的暂缓状态
- [ ] T122 [P] `docs/frontend-design-v2.md`：补入数据源两页与打印对话框行选择区的界面约定
- [ ] T123 [P] `CLAUDE.md`：SPECKIT 段确认指向 003（plan 阶段已更新，此处复核）
- [ ] T124 **「写了但没接上」复查**：对 `packages/shared/src/template/`、`packages/shared/src/csv/`、`packages/server/src/csv/`、`packages/web/src/features/data-sources/`、`packages/web/src/features/sequence-pools/` 逐个模块确认存在真实调用方 —— 空目录、算了却没用的值、引用不到的组件、只能从预览端点抵达的参数，都算未完成
- [ ] T125 按 `quickstart.md` 走一遍手工验收路径（变量、数据源、流式、四处破坏性确认）
- [ ] T126 在 `specs/003-variables-data-sources/quickstart.md` 的「待实测」表中登记 HW-A（1000 张中途拔线，已印张数如实记录且可补打差额）与 HW-B（进度上报与实际出纸同步）的执行结果，须物理打印机

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**：无依赖，可立即开始
- **Foundational (Phase 2)**：依赖 Setup —— **阻塞所有用户故事**
- **US1 (Phase 3)**：依赖 Phase 2
- **US2 (Phase 4)**：依赖 Phase 2 与 US1（复用引用语法与求值管线）
- **US3 (Phase 5)**：依赖 Phase 2；逻辑上不依赖 US1/US2，但真实大批量要等 US2
- **Polish (Phase 6)**：依赖所有已交付的故事

### User Story Dependencies

- **US1 (P1)**：Phase 2 之后即可开工，不依赖其他故事 —— 这是 MVP
- **US2 (P2)**：依赖 US1 的 `${}` 求值管线。US1 未完成时可先做 CSV 与数据源的服务端部分（T072–T080 与其测试），它们不碰求值
- **US3 (P3)**：与 US1/US2 基本无耦合，可并行。**一处例外**：T113 落在 US3（它服务 SC-003），
  但改的是 US2 引入的提交路径 —— 分头做时应排在 T082 之后

### Within Each User Story

- 测试先写、先看红（宪章原则 II，不可协商）
- schema/domain → repository → service/API → 前端
- 纯逻辑先抽离再测（解析、探测、展开、粘贴切分），组件只回答「挂得起来吗」

### Parallel Opportunities

- Phase 1 的 T002、T003 可并行
- Phase 2 的 T004/T005（测试）、T016–T020（术语与 i18n）各自成组并行
- 每个故事的测试任务几乎全部标 [P]，可一次性铺开
- US2 的服务端（T072–T085）与前端（T086–T102）在契约确定后可由两人并行
- US3 的三个驱动（T114、T115、T116）互不相干，可并行

---

## Parallel Example: User Story 1

```bash
# 先把 US1 的七条测试一次铺开（全部标 [P]，互不相干）：
Task: "packages/server/tests/unit/sequence-pool.test.ts"
Task: "packages/server/tests/unit/sequence-allocator.test.ts"
Task: "packages/server/tests/integration/sequence-pools-api.test.ts"
Task: "packages/server/tests/integration/variables-print.test.ts"
Task: "packages/web/tests/variable-panel.dom.test.tsx"
Task: "packages/web/tests/variable-typing.dom.test.tsx"
Task: "packages/web/tests/print-blocked-unresolved.dom.test.tsx"

# 确认全红之后，两个无依赖的领域件可并行：
Task: "packages/server/src/domain/sequence-pool.ts"
Task: "packages/server/src/db/repositories/sequence-pool-repo.ts"
```

---

## Implementation Strategy

### MVP First（只做 US1）

1. Phase 1 Setup
2. Phase 2 Foundational（**关键路径，阻塞一切**）
3. Phase 3 US1
4. **停下来验收**：按 quickstart 第 1 节走一遍，含逐字输入 `${sku}` 的中间状态
5. 此时已可交付：一个比改造前更好的编辑器，一处改动多处跟随

### Incremental Delivery

1. Setup + Foundational → 地基就绪，旧机制拆净
2. + US1 → 变量可用（**MVP**）
3. + US2 → 一个模板覆盖一整批标签（本功能的主体价值）
4. + US3 → 大批量不再空等

### 关键路径上的四个风险点

- **T024/T025（迁移 9/10）**：破坏性且不可逆。当前无生产数据是它成立的唯一前提，
  该前提写在 spec.md 的 Assumptions 里，动工前应再确认一次
- **T042（序号领取改按池 id）**：research R5 指出这使扫描无法再靠 `template_id` 索引收窄。
  T022 的 `job_sequence_claims` 表就是为此而建；若跳过它而沿用 `seq_ranges` JSON，
  任务量增长后每次提交都要全表扫描并解析 JSON
- **T110（端口契约变更）**：**五个**消费方同步改 —— 四个驱动、CLI（T117），另有 5 个既有
  驱动测试文件按数组调用（T109）。其中 TSPL 在另一分支上（T118）
- **T113（停止逐份条码检查）**：容易被当成优化而延后，但它是 SC-003 的前提。既有的
  `checkBatch` 给每一份编一次条码，1000 行就是开印前先编 1000 次 —— 恰好抵消流式渲染
  换来的那一秒。FR-045 论证过取消它，而论证得越充分，越容易被读成「已经安排了」

---

## Notes

- [P] = 不同文件、无未完成前置
- 每个故事独立可完成、可验收；中途停在任一 Checkpoint 都应是一个能用的系统
- 实现前先确认测试确实变红 —— 一条永远不会失败的测试比没有测试更糟，因为它给出保证的假象
- 逐任务或按逻辑组提交，提交信息格式 `<type>(<scope>): <中文描述>`
