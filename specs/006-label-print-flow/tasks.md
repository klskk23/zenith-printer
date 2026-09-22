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

- [x] T001 安装 `@radix-ui/react-tooltip`（`package.json` + `package-lock.json`），确认版本与既有 Radix 包同代
- [x] T002 [P] 在 `vitest.config.ts` 的覆盖率 include 里加入本功能的新逻辑模块路径（`features/print/flow.ts`）

## Phase 2: Foundational（阻塞所有故事）

- [x] T010 写失败测试 `packages/web/tests/routes.test.ts`：`/labels/{id}/print`、`/labels/new/print`、`/labels/{id}/confirm`、`/design/{id}?preset=` → `label-print`、`/design/{id}` → `label`、`pathForPage` 往返
- [x] T011 在 `packages/web/src/app/routes.ts` 新增 `label-print` / `label-confirm` 两种 kind、地址生成与解析、旧地址判定，令 T010 变绿
- [x] T012 写失败测试 `packages/web/tests/flow.test.ts`：`stepsFor()` 的四行可达性表、`tally()`、`blockReason()` 的优先级
- [x] T013 新建 `packages/web/src/features/print/flow.ts` 实现上述纯函数，令 T012 变绿
- [x] T014 写失败测试 `packages/web/tests/step-bar.dom.test.tsx`：四步渲染、当前步、已过可点、未到不可点、只有符号的返回入口、右端上下文、窄屏收起
- [x] T015 新建 `packages/web/src/app/step-bar.tsx`，令 T014 变绿
- [x] T016 `packages/web/src/i18n/{zh-CN,en-US}.ts` 新增 `flow.*`（四步名称、返回、继续、上一步）
- [x] T017 `packages/web/src/App.tsx`：`label` / `label-print` / `label-confirm` 三种 kind 都交给同一个 `<EditorPage key="label" step=…>`
- [x] T018 `packages/web/src/app/workspace.tsx`：三步之间切换不触发未保存询问；离开 `label*` 才触发
- [x] T019 更新 `packages/web/tests/render-smoke.dom.test.tsx`：九个落点都能渲染，旧地址被改写

## Phase 3: User Story 1 - 从画廊直接打印（P1）🎯 MVP

### Tests（先写，必须先失败）

- [x] T020 [P] [US1] `packages/web/tests/print-step.dom.test.tsx`：打印机卡片内容与选中态、选打印机后默认参数自动选上、行选择出现在最后一节、底部合计随份数与勾选变化、「继续」的禁用与原因
- [x] T021 [P] [US1] `packages/web/tests/confirm-step.dom.test.tsx`：清单五项、合计大数字、上一步、确认打印
- [x] T022 [P] [US1] `packages/web/tests/print-submit.dom.test.tsx`：提交成功后的结果态（张数、任务编号、三个出口）、「再打一次」清空勾选保留打印机、提交失败留在原页显示三段错误、重试沿用同一幂等键
- [x] T023 [P] [US1] `packages/web/tests/gallery-print-entry.dom.test.tsx`：瓦片上的「打印」直达 `/labels/{id}/print`

### Implementation

- [x] T024 [US1] `packages/web/src/editor/editor-page.tsx`：把 `selection`、`copies`、`keyByOrdinal` 上移为会话状态；按 `step` 渲染三种主体之一
- [x] T025 [US1] 新建 `packages/web/src/features/print/print-step.tsx`：打印机卡片、打印参数卡片、行选择（复用 `RowSelectionPanel` 与 `RefreshButton`）、底部动作条
- [x] T026 [US1] 新建 `packages/web/src/features/print/confirm-step.tsx`：清单、合计、提交、结果态、错误三段、幂等键
- [x] T027 [US1] `packages/web/src/i18n/*`：新增 `print.tally`、`print.again`、`print.toQueue`、`print.backToLabels`、打印机卡片与参数卡片的文案
- [x] T028 [US1] `packages/web/src/pages/labels-page.tsx`：瓦片新增「打印」入口并排在最前
- [x] T029 [US1] 删除 `print-dialog.tsx`、`preview.tsx`、`use-label-preview.ts`、`head-figure.ts`、`head-figure.tsx`、`overflow-notice.tsx`，及 i18n 里对应的 `print.warning` / `print.headFigure` / `print.headOverflow` / `print.heading` / `print.confirm` / `print.cancel`
- [x] T031 [US1] `packages/web/tests/confirm-guard.dom.test.tsx` + 会话实现：直接打开 `/labels/{id}/confirm` 而不可提交时改写回 `/labels/{id}/print`（FR-065）；提交成功后浏览器后退不重复提交（FR-058）
- [x] T030 [US1] 改写或删除只为对话框而存在的测试：`print-preview.dom.test.tsx`、`preview-expand.dom.test.tsx`、`print-head-figure.dom.test.tsx`、`head-figure.test.ts`、`print-refresh.dom.test.tsx`、`row-selection.dom.test.tsx`、`insecure-context.dom.test.tsx`

## Phase 4: User Story 2 - 改完版面接着打印（P1）

- [x] T040 [P] [US2] 改写 `packages/web/tests/editor-toolbar.dom.test.tsx`：顶栏只有返回符号与步条；无打印机/参数下拉；撤销重做在画布头部；底部有保存/另存为/继续
- [x] T041 [P] [US2] `packages/web/tests/flow-dirty.dom.test.tsx`：改一处不保存按「继续」不问保存且服务器未变；点步条 ① 或侧栏才问；从「打印」点 ② 回来修改仍在；在「打印」页选机器不算修改
- [x] T042 [US2] `editor-page.tsx`：顶栏改为一条步条；撤销/重做移入画布头部；底部动作条；移除打印机/参数选择器与「打印」按钮
- [x] T043 [US2] 改写 `packages/web/tests/editor-back.dom.test.tsx`：返回入口只有符号（按可访问名定位）

## Phase 5: User Story 3 - 内容会被裁掉时被告知（P2）

- [x] T050 [P] [US3] `packages/web/tests/clip-summary.test.ts`：无风险返回 null；元素超界；超出打印头；未探测
- [x] T051 [US3] 在 `flow.ts` 实现 `clipSummary()`，令 T050 变绿
- [x] T052 [P] [US3] `packages/web/tests/confirm-clip.dom.test.tsx`：预检有警告时「确认」页多一行且仍可提交；无警告时那一行不出现
- [x] T053 [US3] `confirm-step.tsx` 接入 `POST /print-jobs/preflight` 与 `clipSummary()`；i18n 新增 `print.clipLine`

## Phase 6: User Story 4 - 台账的链接照旧能用（P2）

- [x] T060 [US4] 改写 `packages/web/tests/preset-link.dom.test.tsx`：旧地址落「打印」页、地址改写保留查询串、预设三项已应用、不自动出纸、预设失效仍说明原因
- [x] T061 [US4] 会话里的预设应用逻辑适配新落点（预设到达时不产生"已修改"，沿用 005 的静默应用）

## Phase 7: User Story 5 - 界面上只剩要紧的话（P2）

- [x] T070 [P] [US5] `packages/web/tests/hint-tiers.test.ts`：按 `contracts/hint-tiers.md` 断言三档（删除档不存在、收起档只被 Hint 引用、必留档仍在原位）
- [x] T071 [P] [US5] `packages/web/tests/hint.dom.test.tsx`：`<Hint>` 悬停/聚焦/点击都显示；`<ValueHint>` 点开后值可选中且有复制按钮
- [x] T072 [US5] 新建 `packages/web/src/components/ui/tooltip.tsx`（shadcn Tooltip，Nocturne 令牌）
- [x] T073 [US5] 新建 `packages/web/src/components/ui/hint.tsx`：`<Hint>` 与 `<ValueHint>`
- [x] T074 [US5] 按清单删除原理档与死文案（6 + 4 条键）及其渲染点
- [x] T075 [US5] 按清单把 11 处操作说明改挂到 `<Hint>` / `<ValueHint>`
- [x] T076 [P] [US5] `packages/web/tests/data-source-hint.dom.test.tsx`：数据源页标题旁的 `ValueHint` 含服务账号地址与复制；未配置时说明照旧
- [x] T077 [US5] `.agents/rules/ux-and-api.md` 补一节「说明文字的三档」

## Phase 8: User Story 6 - 画廊页头（P3）

- [x] T080 [P] [US6] `packages/web/tests/labels-header.dom.test.tsx`：无「标签」标题；页头一行含队列状态与四个动作；分隔线在页头与画廊之间
- [x] T081 [US6] `labels-page.tsx` 调整页头；改写 `gallery.dom.test.tsx` 中受影响的断言

## Phase 10: 2026-09-22 的修订（图看过之后）

- [x] T100 步条去掉返回箭头；第 ① 步即出口（`step-bar.tsx` 与四处测试）
- [x] T101 「打印」页铺满宽度、分节标题内联；行表不折行（`row-browser.tsx` 的单元格加 `whitespace-nowrap`）
- [x] T102 「一行都没选」只由行选择面板说一次，底条不再重复
- [x] T103 从 git 历史取回 `use-label-preview.ts`；新建 `label-preview.tsx`：收起态一张大图 + 「第 N 张，共 M 张」，展开态每页十张、可翻页、被裁的自己标红；未绑数据源或只有一行时不给展开
- [x] T104 「确认」页改为纸居中、五件事压成一条、合计靠右；去掉「按下之后就出纸了」
- [x] T105 裁切那行红字不再声称张数（预检只检查设计本身）
- [x] T106 在「打印」页选机器/参数不再把标签标成已修改（`applyProfileStock` 改为静默）
- [x] T107 `confirm-step.dom.test.tsx` 补渲染、展开、渲染失败三组；新增 `flow-dirty.dom.test.tsx`
- [x] T108 规格、plan、research、quickstart、design-consensus §6.4、CHANGELOG 按修订改写
- [x] T109 英文界面下瓦片的四个动作不再折行（去掉按钮左右内边距，画廊最小列宽 16rem → 18rem）
- [x] T110 份数字段隐藏浏览器自带的上下箭头（`− / +` 已经是那对箭头）
- [x] T111 撤销/重做与画布面板边缘留出间距
- [x] T112 打开绑了数据源的标签不再被判为「有未保存的修改」：值到达后的自动重算改为静默，且「改过什么」改由撤销栈 + 变量 + 绑定三处共同判断

## Phase 9: Polish & Cross-Cutting

- [x] T090 `docs/design-consensus.md` 新增 §6.4，记录被推翻的五处
- [x] T091 `CHANGELOG.md` 新增「未发布（MINOR）」一节
- [x] T092 `docs/nexus-assets.md` 改写第 110 行附近对落点的描述
- [x] T093 `.agents/rules/project-context.md` 更新当前功能与硬约束
- [x] T094 `specs/006-label-print-flow/checklists/acceptance.md` 逐条勾验
- [x] T095 全量 `npm run typecheck && npm run lint && npm test`；覆盖率检查新增逻辑模块 ≥ 80%

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
