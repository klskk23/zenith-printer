# Tasks: 标签工作流与说明文字清理

**Feature**: `006-label-print-flow` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Format: `[ID] [P?] [Story] Description`

- `[P]` = 可与同阶段的其他 `[P]` 并行（不同文件、无未完成依赖）
- `[USn]` = 属于哪个用户故事
- 每个实现任务前面都有它的测试任务（宪章原则 II：红—绿—重构）

## Path Conventions

- 前端源码：`packages/web/src/`
- 测试：`packages/web/tests/`（`*.dom.test.tsx` 走 happy-dom 项目，`*.test.ts` 走 Node 项目）
- 文档：`docs/`、`specs/006-label-print-flow/`

---

## Phase 1: Setup

- [ ] T001 安装 `@radix-ui/react-tooltip`（`package.json` + `package-lock.json`），确认版本与既有 Radix 包同代
- [ ] T002 [P] 在 `vitest.config.ts` 的覆盖率 include 里加入本功能的新逻辑模块路径（`features/print/flow.ts`）

## Phase 2: Foundational（阻塞所有故事）

- [ ] T010 写失败测试 `packages/web/tests/routes.test.ts`：`/labels/{id}/print`、`/labels/new/print`、`/labels/{id}/confirm`、`/design/{id}?preset=` → `label-print`、`/design/{id}` → `label`、`pathForPage` 往返
- [ ] T011 在 `packages/web/src/app/routes.ts` 新增 `label-print` / `label-confirm` 两种 kind、地址生成与解析、旧地址判定，令 T010 变绿
- [ ] T012 写失败测试 `packages/web/tests/flow.test.ts`：`stepsFor()` 的四行可达性表、`tally()`、`blockReason()` 的优先级
- [ ] T013 新建 `packages/web/src/features/print/flow.ts` 实现上述纯函数，令 T012 变绿
- [ ] T014 写失败测试 `packages/web/tests/step-bar.dom.test.tsx`：四步渲染、当前步、已过可点、未到不可点、只有符号的返回入口、右端上下文、窄屏收起
- [ ] T015 新建 `packages/web/src/app/step-bar.tsx`，令 T014 变绿
- [ ] T016 `packages/web/src/i18n/{zh-CN,en-US}.ts` 新增 `flow.*`（四步名称、返回、继续、上一步）
- [ ] T017 `packages/web/src/App.tsx`：`label` / `label-print` / `label-confirm` 三种 kind 都交给同一个 `<EditorPage key="label" step=…>`
- [ ] T018 `packages/web/src/app/workspace.tsx`：三步之间切换不触发未保存询问；离开 `label*` 才触发
- [ ] T019 更新 `packages/web/tests/render-smoke.dom.test.tsx`：九个落点都能渲染，旧地址被改写

## Phase 3: User Story 1 - 从画廊直接打印（P1）🎯 MVP

### Tests（先写，必须先失败）

- [ ] T020 [P] [US1] `packages/web/tests/print-step.dom.test.tsx`：打印机卡片内容与选中态、选打印机后默认参数自动选上、行选择出现在最后一节、底部合计随份数与勾选变化、「继续」的禁用与原因
- [ ] T021 [P] [US1] `packages/web/tests/confirm-step.dom.test.tsx`：清单五项、合计大数字、上一步、确认打印
- [ ] T022 [P] [US1] `packages/web/tests/print-submit.dom.test.tsx`：提交成功后的结果态（张数、任务编号、三个出口）、「再打一次」清空勾选保留打印机、提交失败留在原页显示三段错误、重试沿用同一幂等键
- [ ] T023 [P] [US1] `packages/web/tests/gallery-print-entry.dom.test.tsx`：瓦片上的「打印」直达 `/labels/{id}/print`

### Implementation

- [ ] T024 [US1] `packages/web/src/editor/editor-page.tsx`：把 `selection`、`copies`、`keyByOrdinal` 上移为会话状态；按 `step` 渲染三种主体之一
- [ ] T025 [US1] 新建 `packages/web/src/features/print/print-step.tsx`：打印机卡片、打印参数卡片、行选择（复用 `RowSelectionPanel` 与 `RefreshButton`）、底部动作条
- [ ] T026 [US1] 新建 `packages/web/src/features/print/confirm-step.tsx`：清单、合计、提交、结果态、错误三段、幂等键
- [ ] T027 [US1] `packages/web/src/i18n/*`：新增 `print.tally`、`print.again`、`print.toQueue`、`print.backToLabels`、打印机卡片与参数卡片的文案
- [ ] T028 [US1] `packages/web/src/pages/labels-page.tsx`：瓦片新增「打印」入口并排在最前
- [ ] T029 [US1] 删除 `print-dialog.tsx`、`preview.tsx`、`use-label-preview.ts`、`head-figure.ts`、`head-figure.tsx`、`overflow-notice.tsx`，及 i18n 里对应的 `print.warning` / `print.headFigure` / `print.headOverflow` / `print.heading` / `print.confirm` / `print.cancel`
- [ ] T031 [US1] `packages/web/tests/confirm-guard.dom.test.tsx` + 会话实现：直接打开 `/labels/{id}/confirm` 而不可提交时改写回 `/labels/{id}/print`（FR-065）；提交成功后浏览器后退不重复提交（FR-058）
- [ ] T030 [US1] 改写或删除只为对话框而存在的测试：`print-preview.dom.test.tsx`、`preview-expand.dom.test.tsx`、`print-head-figure.dom.test.tsx`、`head-figure.test.ts`、`print-refresh.dom.test.tsx`、`row-selection.dom.test.tsx`、`insecure-context.dom.test.tsx`

## Phase 4: User Story 2 - 改完版面接着打印（P1）

- [ ] T040 [P] [US2] 改写 `packages/web/tests/editor-toolbar.dom.test.tsx`：顶栏只有返回符号与步条；无打印机/参数下拉；撤销重做在画布头部；底部有保存/另存为/继续
- [ ] T041 [P] [US2] `packages/web/tests/flow-dirty.dom.test.tsx`：改一处不保存按「继续」不问保存且服务器未变；按 `←`/侧栏才问；从「打印」点 ② 回来修改仍在
- [ ] T042 [US2] `editor-page.tsx`：顶栏改为 `←` + 步条；撤销/重做移入画布头部；底部动作条；移除打印机/参数选择器与「打印」按钮
- [ ] T043 [US2] 改写 `packages/web/tests/editor-back.dom.test.tsx`：返回入口只有符号（按可访问名定位）

## Phase 5: User Story 3 - 内容会被裁掉时被告知（P2）

- [ ] T050 [P] [US3] `packages/web/tests/clip-summary.test.ts`：无风险返回 null；元素超界；超出打印头；未探测
- [ ] T051 [US3] 在 `flow.ts` 实现 `clipSummary()`，令 T050 变绿
- [ ] T052 [P] [US3] `packages/web/tests/confirm-clip.dom.test.tsx`：预检有警告时「确认」页多一行且仍可提交；无警告时那一行不出现
- [ ] T053 [US3] `confirm-step.tsx` 接入 `POST /print-jobs/preflight` 与 `clipSummary()`；i18n 新增 `print.clipLine`

## Phase 6: User Story 4 - 台账的链接照旧能用（P2）

- [ ] T060 [US4] 改写 `packages/web/tests/preset-link.dom.test.tsx`：旧地址落「打印」页、地址改写保留查询串、预设三项已应用、不自动出纸、预设失效仍说明原因
- [ ] T061 [US4] 会话里的预设应用逻辑适配新落点（预设到达时不产生"已修改"，沿用 005 的静默应用）

## Phase 7: User Story 5 - 界面上只剩要紧的话（P2）

- [ ] T070 [P] [US5] `packages/web/tests/hint-tiers.test.ts`：按 `contracts/hint-tiers.md` 断言三档（删除档不存在、收起档只被 Hint 引用、必留档仍在原位）
- [ ] T071 [P] [US5] `packages/web/tests/hint.dom.test.tsx`：`<Hint>` 悬停/聚焦/点击都显示；`<ValueHint>` 点开后值可选中且有复制按钮
- [ ] T072 [US5] 新建 `packages/web/src/components/ui/tooltip.tsx`（shadcn Tooltip，Nocturne 令牌）
- [ ] T073 [US5] 新建 `packages/web/src/components/ui/hint.tsx`：`<Hint>` 与 `<ValueHint>`
- [ ] T074 [US5] 按清单删除原理档与死文案（6 + 4 条键）及其渲染点
- [ ] T075 [US5] 按清单把 11 处操作说明改挂到 `<Hint>` / `<ValueHint>`
- [ ] T076 [P] [US5] `packages/web/tests/data-source-hint.dom.test.tsx`：数据源页标题旁的 `ValueHint` 含服务账号地址与复制；未配置时说明照旧
- [ ] T077 [US5] `.agents/rules/ux-and-api.md` 补一节「说明文字的三档」

## Phase 8: User Story 6 - 画廊页头（P3）

- [ ] T080 [P] [US6] `packages/web/tests/labels-header.dom.test.tsx`：无「标签」标题；页头一行含队列状态与四个动作；分隔线在页头与画廊之间
- [ ] T081 [US6] `labels-page.tsx` 调整页头；改写 `gallery.dom.test.tsx` 中受影响的断言

## Phase 9: Polish & Cross-Cutting

- [ ] T090 `docs/design-consensus.md` 新增 §6.4，记录被推翻的五处
- [ ] T091 `CHANGELOG.md` 新增「未发布（MINOR）」一节
- [ ] T092 `docs/nexus-assets.md` 改写第 110 行附近对落点的描述
- [ ] T093 `.agents/rules/project-context.md` 更新当前功能与硬约束
- [ ] T094 `specs/006-label-print-flow/checklists/acceptance.md` 逐条勾验
- [ ] T095 全量 `npm run typecheck && npm run lint && npm test`；覆盖率检查新增逻辑模块 ≥ 80%

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3（MVP）→ 之后各故事可按序交付
- Phase 2 的 T011（routes）与 T013（flow.ts）阻塞所有页面任务
- Phase 3 的 T024（会话状态上移）阻塞 T025、T026
- Phase 7 的 T072/T073（组件）阻塞 T074/T075
- Phase 9 在全部故事完成后

## Parallel Opportunities

- T020–T023 四个测试文件互不相干，可同时写
- T040/T041、T050/T052、T070/T071/T076、T080 同理
- Phase 7 的文案清理与 Phase 8 的画廊页头互不相干

## MVP Scope

Phase 1 + 2 + 3（US1）：从画廊直达打印、选完提交、看到结果。此时「设计」页仍是旧顶栏，文案未清理，但主路径已完整可用。
