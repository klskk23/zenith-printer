---
description: "Task list for 002-web-workspace-editor"
---

# Tasks: 前端工作区与标签编辑器重构

**Input**: Design documents from `/specs/002-web-workspace-editor/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: 测试任务为**强制**（宪章原则 II）。每个用户故事都包含测试任务，
且测试 **MUST** 先于对应的实现任务编写。默认测试套件 **MUST** 可脱离物理打印机运行。

**Organization**: 按用户故事分组，每组可独立实现、独立测试、独立交付。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事（US1–US5）

---

## Phase 1: Setup（共享基础）

- [x] T001 安装 `react-router-dom` 至 `packages/web/package.json`，并在 PR 描述模板中记录宪章偏离理由（plan.md Complexity Tracking）
- [x] T002 [P] 引入所需 shadcn/ui 组件至 `packages/web/src/components/ui/`：`tabs` `context-menu` `alert-dialog` `badge` `switch` `slider` `scroll-area` `tooltip` `dropdown-menu`
- [x] T003 [P] 创建 `packages/server/src/i18n/en-US.ts`（全量译文，38 条设备错误 + 16 条应用错误）。**前端的 `en-US.ts` 移至 T117**：本功能会大幅扩充前端键集合，在键稳定前翻译属重复劳动
- [x] T004 [P] 将 `packages/web/src/i18n/zh-CN.ts` 的类型抽出为 `packages/web/src/i18n/types.ts`，使两种语言共享同一份键类型（缺键即类型错误）

---

## Phase 2: Foundational（阻塞性前置）

**Purpose**: 多个用户故事共同依赖的 schema 与几何基础。**必须先于 Phase 3+ 完成。**

### Tests（先行）

- [x] T005 [P] 在 `packages/shared/tests/ir-schema.test.ts` 增加用例：`moduleWidthDots` 接受整数 ≥ 2（含奇数 3、5、7），拒绝 1、0、2.5
- [x] T006 [P] 在 `packages/shared/tests/ir-schema.test.ts` 增加 `ellipse` 元素的 schema 用例：宽高 > 0、rotation 限直角、strokeWidthDots 整数 ≥ 1
- [x] T007 [P] 新建 `packages/shared/tests/geometry.test.ts`：`rotatedBounds` 在 0/180 保持宽高、90/270 互换宽高、中心不变

### Implementation

- [x] T008 在 `packages/shared/src/ir/schema.ts` 为 `barcode` 与 `qrcode` 增加 `moduleWidthDots`（整数 ≥ 2）
- [x] T009 在 `packages/shared/src/ir/schema.ts` 增加 `EllipseElement` 并纳入判别联合
- [x] T010 新建 `packages/shared/src/geometry/index.ts`，实现 `rotatedBounds()`；从 `packages/shared/src/index.ts` 导出
- [x] T011 在 `packages/server/src/db/migrations/index.ts` 增加迁移前的数据库文件备份步骤（迁移框架与版本记录已存在，此处只补备份）

**Checkpoint**: schema 与几何就位，各用户故事可并行展开

---

## Phase 3: User Story 1 - 二维码与条码正确打印 (Priority: P1) 🎯 MVP

**Goal**: 二维码渲染为真正的二维码；条码宽度真实受控；放宽错误的偶数限制。

**Independent Test**: 纯渲染层，完全离线可验；打印件用扫码设备验收。

### Tests for User Story 1（强制，先行）⚠️

- [x] T012 [P] [US1] 在 `packages/shared/tests/barcode.test.ts` 增加：`qrcode` 输出为方形矩阵，`<path>` 数量与一维码特征不同
- [x] T013 [P] [US1] 在 `packages/shared/tests/barcode.test.ts` 增加：`eclevel` 为 H 时矩阵尺寸大于 L/M/Q（research.md R1 实测值）
- [x] T014 [P] [US1] 在 `packages/shared/tests/barcode.test.ts` 增加：二维码内容超出纠错等级容量时抛出可识别错误，且不截断
- [x] T015 [P] [US1] 从 `packages/shared/tests/barcode.test.ts` **删除**用例 `'rejects an odd module width'`——它断言的是一条不存在的规则（research.md R4）
- [x] T016 [P] [US1] 在 `packages/shared/tests/ir-to-svg.test.ts` 增加：`qrcode` 元素的渲染尺寸不超过其声明的宽高（FR-002）
- [x] T017 [P] [US1] 在 `packages/shared/tests/ir-to-svg.test.ts` 增加：同一标签上两个条码采用不同 `moduleWidthDots` 时各自独立渲染（FR-004）
- [x] T018 [P] [US1] 在 `packages/shared/tests/ir-to-svg.test.ts` 增加：条码实际宽度 == `moduleWidthDots × moduleCount`（FR-005）
- [x] T019 [P] [US1] 在 `packages/shared/tests/barcode.test.ts` 增加整点对齐回归用例：7 组码制 × 缩放 1/2/3/5/7，**每条 path 与其自身 stroke-width 配对**校验边缘为整数（修正旧脚本的测量缺陷）

### Implementation for User Story 1

- [x] T020 [US1] 在 `packages/shared/src/barcode/index.ts` 将 `assertEvenModuleWidth` 改为 `assertModuleWidth`（整数 ≥ 2），并更新文件顶部关于偶数的注释——该注释记录的是已被推翻的结论
- [x] T021 [US1] 在 `packages/shared/src/barcode/index.ts` 增加 `qrcode` 的 bcid 映射与 `eclevel` 传参，导出 `renderQrcodeSvg()`
- [x] T022 [US1] 在 `packages/shared/src/barcode/index.ts` 增加二维码容量超限的显式错误类型
- [x] T023 [US1] 在 `packages/shared/src/ir-to-svg/index.ts` 修复 `case 'qrcode'`：改用真二维码渲染，**移除硬编码的 `symbology: 'code128'`**
- [x] T024 [US1] 在 `packages/shared/src/ir-to-svg/index.ts` 实现二维码尺寸量化：`floor(声明边长 / moduleCount) × moduleCount`（向下取整以满足 FR-002）
- [x] T025 [US1] 在 `packages/shared/src/ir-to-svg/index.ts` 将条码模块宽度改为读取元素属性，**移除 `IrToSvgOptions.barcodeModuleWidthDots` 全局选项**
- [x] T026 [US1] 更新 `packages/web/src/editor/elements.ts` 与 `packages/server/` 中所有传入全局模块宽度的调用点
- [x] T027 [US1] 在 `packages/cli/src/commands/render-test.ts` 增加 `--element` 与 `--module-width` 参数，支撑 quickstart §1 的验证步骤

**Checkpoint**: 二维码可用；条码宽度受控。可独立交付。

---

## Phase 4: User Story 2 - 多标签工作区 (Priority: P2)

**Goal**: IDE 式标签栏、七项侧边栏、地址栏投影、首页概览、模板并发保护。

**Independent Test**: 全程不需要打印机。

### Tests for User Story 2（强制，先行）⚠️

- [x] T028 [P] [US2] 新建 `packages/web/tests/workspace.test.ts`：打开、切换、关闭标签页的状态转移；已打开条目再次点击为切换而非新建（FR-010）
- [x] T029 [P] [US2] 在 `packages/web/tests/workspace.test.ts` 增加：可打开多个 `design` 标签页且状态互相隔离（FR-011）
- [x] T030 [P] [US2] 在 `packages/web/tests/workspace.test.ts` 增加：切换后 `viewState` 完整保留（FR-012）
- [x] T031 [P] [US2] 在 `packages/web/tests/workspace.test.ts` 增加：达到 10 个标签页时置位提示标志，且**不阻止**继续开启（FR-083、FR-084）
- [x] T138 [P] [US2] 在 `packages/web/tests/workspace.test.ts` 增加：刷新后**只恢复地址所指的那一个**标签页，其余不恢复（FR-022）
- [x] T032 [P] [US2] 新建 `packages/web/tests/router.test.ts`：七类标签页与路径的双向映射，含 `/design/new` 与 `/design/:templateId`
- [x] T033 [P] [US2] 在 `packages/web/tests/router.test.ts` 增加：地址变化只改变激活项，**不销毁**其他标签页（FR-024）
- [x] T034 [P] [US2] 新建 `packages/server/tests/template-version.test.ts`：版本匹配则保存成功且版本 +1
- [x] T035 [P] [US2] 在 `packages/server/tests/template-version.test.ts` 增加：版本不匹配返回 **409 `TEMPLATE_VERSION_CONFLICT`**，且**数据库未发生任何写入**（FR-082）
- [x] T036 [P] [US2] 在 `packages/server/tests/template-version.test.ts` 增加：缺少 `version` 字段返回 400
- [x] T037 [P] [US2] 新建 `packages/web/tests/index-page.test.ts`：无法上报余量的机型显示明确文案而非留空（FR-026）

### Implementation for User Story 2

- [x] T038 [US2] 在 `packages/server/src/db/migrations/index.ts` 增加模板 `version` 字段迁移，既有模板初始化为 1
- [x] T039 [US2] 在 `packages/server/src/api/templates.ts` 实现版本比对；冲突返回 409 且不写库
- [x] T040 [US2] 在 `packages/server/src/api/templates.ts` 为 `GET /api/templates/:id` 响应增加 `version`
- [x] T041 [US2] 新建 `packages/web/src/app/workspace.tsx`：标签页集合状态、打开/切换/关闭、dirty 标记、软上限提示
- [x] T042 [US2] 新建 `packages/web/src/app/router.tsx`：**只决定激活项**；所有标签页保持挂载，以样式控制显隐（research.md R7）
- [x] T043 [US2] 新建 `packages/web/src/app/tab-bar.tsx`：激活与关闭使用不同符号（FR-014）、未保存标记、横向滚动（FR-017）
- [x] T044 [US2] 新建 `packages/web/src/app/sidebar.tsx`：七项导航 + 打印队列数量徽标（FR-018）
- [x] T045 [US2] 新建 `packages/web/src/app/status-bar.tsx`：连接状态；断开时在内容区顶部显示横幅（FR-019）
- [x] T046 [US2] 在 `packages/web/src/app/workspace.tsx` 接入 `beforeunload`：存在未保存修改时提示（FR-016）
- [x] T047 [US2] 在 `packages/web/src/app/tab-bar.tsx` 关闭带未保存修改的标签页时以 `alert-dialog` 确认（FR-013）
- [x] T048 [US2] 新建 `packages/web/src/pages/index-page.tsx`：打印机状态卡片、最近 6 个模板、最近 5 条打印记录
- [x] T049 [US2] 在 `packages/web/src/pages/index-page.tsx` 实现耗材余量的两种表现：可上报显示张数，不可上报显示明确说明（FR-026）
- [x] T050 [US2] 在 `packages/web/src/pages/index-page.tsx` 为失败记录提供重新提交入口（FR-028）；打印机卡片点击跳转并定位（FR-029）
- [x] T051 [US2] [P] 新建 `packages/web/src/pages/templates-page.tsx`：列表、搜索、重命名、复制、删除、打开
- [x] T052 [US2] [P] 新建 `packages/web/src/pages/queue-page.tsx`：由既有 `features/jobs/job-list.tsx` 提升而来
- [x] T053 [US2] [P] 新建 `packages/web/src/pages/history-page.tsx`：由既有 `features/jobs/history.tsx` 提升而来
- [x] T054 [US2] 在 `packages/web/src/features/templates/` 处理 409 冲突：显示服务端文案，保留当前编辑内容，提供重新加载入口
- [x] T055 [US2] 重写 `packages/web/src/App.tsx` 为工作区外壳，移除原有的两按钮切换

**Checkpoint**: 工作区骨架可用，可独立演示。

---

## Phase 5: User Story 3 - 标签编辑器交互增强 (Priority: P3)

**Goal**: 标尺、缩放、吸附、直角旋转、等比缩放、多行文本、椭圆、图层、右键菜单、撤销重做。

**Independent Test**: 完全在编辑器内验证。

### Tests for User Story 3（强制，先行）⚠️

- [x] T056 [P] [US3] 新建 `packages/web/tests/snapping.test.ts`：吸附结果落在整数 dot；基于画布 dot 网格而非逐元素换算（宪章单位约定）
- [x] T057 [P] [US3] 在 `packages/web/tests/snapping.test.ts` 增加：Alt 修饰时跳过吸附（FR-033）
- [x] T058 [P] [US3] 新建 `packages/web/tests/rotation.test.ts`：旋转手柄拖拽吸附到最近直角，永不停在中间角度（FR-035）
- [x] T059 [P] [US3] 新建 `packages/web/tests/guards-rotation.test.ts`：旋转 90°/270° 的元素越界判定使用互换后的宽高（FR-036）
- [x] T139 [P] [US3] 在 `packages/web/tests/guards-rotation.test.ts` 增加：旋转导致的越界归为**警告级**，**不禁用**打印动作（FR-067）
- [x] T060 [P] [US3] 在 `packages/shared/tests/ir-to-svg.test.ts` 增加多行文本用例：按 `\n` 拆行，行距 = 1.2 × 字号，**使用绝对 x/y 而非 dy**
- [x] T061 [P] [US3] 在 `packages/shared/tests/ir-to-svg.test.ts` 增加：单行文本渲染结果与改动前逐字节一致（回归）
- [x] T062 [P] [US3] 在 `packages/shared/tests/ir-to-svg.test.ts` 增加椭圆用例：未填充时按半个描边内缩，外边缘与包围盒重合
- [x] T063 [P] [US3] 在 `packages/shared/tests/ir-to-svg.test.ts` 增加：描边宽度 ≥ 短轴时渲染为填充、**不抛错、不改写入参**（FR-085）
- [x] T064 [P] [US3] 新建 `packages/web/tests/barcode-width-snap.test.ts`：宽度吸附到 `round(目标 / moduleCount) × moduleCount`，下限模块宽度 2
- [x] T065 [P] [US3] 新建 `packages/web/tests/undo.test.ts`：覆盖移动/缩放/旋转/增删/改属性/改画布尺寸六类操作（FR-086）
- [x] T066 [P] [US3] 在 `packages/web/tests/undo.test.ts` 增加：两个标签页的撤销历史互不影响（FR-087）
- [x] T067 [P] [US3] 在 `packages/web/tests/undo.test.ts` 增加：栈深度上限 50；连续拖拽合并为一步（research.md R8）
- [x] T137 [P] [US3] 在 `packages/web/tests/undo.test.ts` 增加：关闭标签页后重新打开同一模板，撤销历史为空（FR-088）
- [x] T068 [P] [US3] 新建 `packages/web/tests/layers.test.ts`：置顶/置底改变绘制顺序；图层面板顺序与画布同步
- [x] T135 [P] [US3] 新建 `packages/shared/tests/render-parity.test.ts`：同一 IR 分别经浏览器 DOM 路径与 resvg 渲染，比对逐像素结果（SC-009）。**MUST 覆盖多行文本与椭圆**——本功能新增的两类元素正是最需要这条保证的地方（research.md R5 建议）
- [x] T136 [P] [US3] 在 `packages/shared/tests/ir-to-svg.test.ts` 增加负向断言：超长单行文本渲染后**仍为一行**，系统不做自动折行（FR-049）——守护前后端一致性的负向需求，最易在后续"优化"中被无意破坏

### Implementation for User Story 3

- [x] T069 [US3] 在 `packages/shared/src/ir-to-svg/index.ts` 实现多行文本：`split('\n')` 后逐行 `<tspan>` 绝对定位；`text-anchor` 逐行套用
- [x] T070 [US3] 在 `packages/shared/src/ir-to-svg/index.ts` 实现椭圆渲染，含描边超短轴退化为填充
- [x] T071 [US3] 新建 `packages/web/src/editor/snapping.ts`：dot 网格吸附与 Alt 旁路
- [x] T072 [US3] 新建 `packages/web/src/editor/undo.ts`：按标签页的 IR 快照栈，深度 50，拖拽合并
- [x] T073 [US3] 新建 `packages/web/src/editor/ruler.tsx`：双轴标尺，刻度随缩放变化（FR-030、FR-031）
- [x] T074 [US3] 在 `packages/web/src/editor/canvas.tsx` 实现缩放：适应窗口 + 滚轮连续缩放（FR-032）
- [x] T075 [US3] 在 `packages/web/src/editor/canvas.tsx` 实现旋转手柄与直角吸附
- [x] T076 [US3] 在 `packages/web/src/editor/canvas.tsx` 实现各类型的缩放语义：图片/二维码等比、文本只改框、条码高度自由宽度吸附、矩形/椭圆自由（Shift 锁等比）
- [x] T077 [US3] 修改 `packages/web/src/editor/guards.ts`：`boundsOf()` 改用 `@zenith/shared` 的 `rotatedBounds()`
- [x] T078 [US3] 新建 `packages/web/src/editor/layers-panel.tsx`：元素列表、双向选中同步、置顶/置底
- [x] T079 [US3] 新建 `packages/web/src/editor/context-menu.tsx`：删除/置顶/置底（基于 shadcn `context-menu`）
- [x] T080 [US3] 在 `packages/web/src/editor/elements.ts` 增加椭圆元素工厂与调色板条目
- [x] T081 [US3] 在 `packages/web/src/editor/inspector.tsx` 增加：椭圆属性、多行文本域、模块宽度控件（dot + mm 双单位显示，宽度 mm 只读）
- [x] T082 [US3] 在 `packages/web/src/editor/inspector.tsx` 为绑定可变字段的条码显示「实际宽度随内容变化」提示（FR-068）
- [x] T083 [US3] 将 `packages/web/src/editor/editor-page.tsx` 改造为工作区内的设计标签页，接入撤销、图层、标尺、缩放

**Checkpoint**: 编辑器交互完整。

---

## Phase 6: User Story 4 - 设备偏移校正与纸张配置 (Priority: P4)

**Goal**: 偏移迁往打印机、校正页、Profile 承载纸张与边距、画布联动、打印前逐张校验。

**Independent Test**: 迁移与校验完全离线；校正页需实机。

### Tests for User Story 4（强制，先行）⚠️

- [x] T084 [P] [US4] 新建 `packages/server/tests/migration-offset.test.ts`：默认 Profile 的偏移迁入打印机
- [x] T085 [P] [US4] 在 `packages/server/tests/migration-offset.test.ts` 增加：同机多 Profile 偏移不一致时取默认值，被丢弃的值写入结构化日志，含打印机名/Profile 名/数值（FR-077）
- [x] T086 [P] [US4] 新建 `packages/server/tests/migration-render-parity.test.ts`：**迁移前后全量既有模板渲染哈希逐像素一致**（FR-078）。**MUST 排除含二维码的模板**——T023 修复二维码必然改变其渲染结果，那是预期的修复而非回归
- [x] T087 [P] [US4] 新建 `packages/server/tests/printer-offset.test.ts`：偏移使打印内容整体平移（FR-054）
- [x] T088 [P] [US4] 在 `packages/server/tests/printer-offset.test.ts` 增加：偏移绝对值超过打印头像素数时拒绝
- [x] T133 [P] [US4] 在 `packages/server/tests/printer-offset.test.ts` 增加：同一打印机切换多个 Profile 后偏移值**不变**（FR-053）——D 分支的核心结论，回归时会静默恢复旧耦合
- [x] T134 [P] [US4] 新建 `packages/web/tests/offset-directions.test.ts`：四方向输入与两个有符号轴向值的映射；相对方向互斥（FR-092）
- [x] T089 [P] [US4] 新建 `packages/server/tests/profile-fields.test.ts`：纸张尺寸必填 > 0；边距默认 0、不得为负；边距之和不得超过对应方向尺寸
- [x] T090 [P] [US4] 新建 `packages/server/tests/calibration-page.test.ts`：缺 `confirmed` 返回 400 `CONFIRMATION_REQUIRED`；打印机不可达返回 503
- [x] T091 [P] [US4] 新建 `packages/server/tests/print-job-overflow.test.ts`：`POST /api/print-jobs/preflight` 返回 200 并列出**全部**越界行而非仅第一个（FR-090）
- [x] T092 [P] [US4] 在 `packages/server/tests/print-job-overflow.test.ts` 增加：含越界标签的批次**提交成功（202）且整批照常打印**，不跳过任何一张（FR-067、FR-089）
- [x] T093 [P] [US4] 在 `packages/server/tests/print-job-overflow.test.ts` 增加：可变字段导致条码超宽的情形被 preflight 捕获（FR-069、SC-011）
- [x] T129 [P] [US4] 在 `packages/server/tests/print-job-overflow.test.ts` 增加：越界明细随任务落库，可经打印历史回看（FR-091）
- [x] T130 [P] [US4] 在 `packages/server/tests/print-job-overflow.test.ts` 增加：**不存在 `LABEL_OVERFLOW` 失败码**——越界不得成为任何 4xx 的理由（FR-067 的负向断言）
- [x] T094 [P] [US4] 新建 `packages/web/tests/profile-canvas-sync.test.ts`：选择 Profile 后画布尺寸变更且元素位置不动；该变更可撤销（FR-061–063）

### Implementation for User Story 4

- [x] T095 [US4] 在 `packages/server/src/db/migrations/index.ts` 实现偏移迁移：打印机加字段 → 取默认 Profile 值 → 记录丢弃值 → Profile 加纸张与边距 → 删除 Profile 偏移
- [x] T096 [US4] 在 `packages/server/src/domain/printer.ts` 增加 `offsetXDots` / `offsetYDots`（注明此为项目中唯一以 dot 存储的位置量及其理由）
- [x] T097 [US4] 在 `packages/server/src/domain/profile.ts` 增加纸张尺寸与四边边距，移除偏移字段
- [x] T098 [US4] 在 `packages/server/src/api/printers.ts` 更新 `PATCH /api/printers/:id` 以接受并校验偏移
- [x] T099 [US4] 在 `packages/server/src/api/templates.ts`（Profile 路由的现所在处）更新 POST/PATCH 的 zod schema 与处理逻辑
- [x] T100 [US4] 修改 `packages/server/src/render/offset.ts` 的调用方，使偏移来源由 Profile 改为打印机（平移实现本身已存在，无需改动）
- [x] T101 [US4] 新建 `packages/server/src/render/calibration-page.ts`：生成带刻度与中心十字的校正标签
- [x] T102 [US4] 在 `packages/server/src/api/printers.ts` 新增 `POST /api/printers/:id/calibration-page` 端点，沿用消耗确认规则，走既有队列返回 202
- [x] T103 [US4] 在 `packages/server/src/api/print-jobs.ts` 新增 `POST /api/print-jobs/preflight`：逐张越界检查，始终返回 200 并列出全部越界行
- [x] T131 [US4] 在 `packages/server/src/api/print-jobs.ts` 使提交端点**不因越界拒绝**，并将越界明细随任务落库
- [x] T104 [US4] 在 `packages/web/src/features/printers/printers-page.tsx` 增加偏移校正区块（上下左右四输入 + 换纸提示 + 打印校正页按钮）
- [x] T105 [US4] 在 `packages/web/src/features/profiles/profiles-panel.tsx` 增加纸张尺寸与四边边距（支持联动与分别设定）
- [x] T106 [US4] 在 `packages/web/src/editor/editor-page.tsx` 实现选择 Profile 时画布尺寸自动变更，元素不动，变更入撤销栈
- [x] T107 [US4] 在 `packages/web/src/editor/canvas.tsx` 绘制边距斜纹区域；未选 Profile 时不绘制并提示（FR-064、FR-065）
- [x] T108 [US4] 在 `packages/web/src/features/print/print-dialog.tsx` 提交前调用 preflight，逐行列出越界与原因，**不禁用提交按钮**，由使用者决定是否继续
- [x] T132 [US4] 在 `packages/web/src/pages/history-page.tsx` 展示任务上记录的越界明细（FR-091）

**Checkpoint**: 换纸校正闭环可用。

---

## Phase 7: User Story 5 - 界面偏好与双语 (Priority: P5)

**Goal**: 客户端偏好、中英双语、服务端文案随 `Accept-Language` 切换。

**Independent Test**: 切换语言后遍历页面与一个故意触发的错误。

### Tests for User Story 5（强制，先行）⚠️

- [x] T109 [P] [US5] 新建 `packages/server/tests/i18n.test.ts`：`Accept-Language: en-US` 时错误三要素为英文，`code` 字段**不随语言变化**
- [x] T110 [P] [US5] 在 `packages/server/tests/i18n.test.ts` 增加：无法识别的语言标记回退 `zh-CN`
- [x] T111 [P] [US5] 新建 `packages/server/tests/i18n-completeness.test.ts`：`en-US` 与 `zh-CN` 的键集合完全一致（缺键即失败）
- [x] T112 [P] [US5] 新建 `packages/web/tests/preferences.test.ts`：偏好写入本地存储并在重载后恢复；默认值正确
- [x] T113 [P] [US5] 在 `packages/web/tests/preferences.test.ts` 增加：偏好集合**不含任何服务端配置项**（对照 FR-070 的白名单断言）

### Implementation for User Story 5

- [x] T114 [US5] 补全 `packages/server/src/i18n/en-US.ts` 的全部错误文案（含设备错误码与应用错误）
- [x] T115 [US5] 在 `packages/server/src/i18n/error-map.ts` 与 `packages/server/src/api/errors.ts` 增加 `Accept-Language` 解析与文案选择
- [x] T116 [US5] 修改 `packages/cli/src/output.ts`，复用 `packages/server/src/i18n/` 的同一份资源，语言经参数或环境变量选择
- [x] T117 [US5] 补全 `packages/web/src/i18n/en-US.ts` 的全部界面文案
- [x] T118 [US5] 新建 `packages/web/src/features/preferences/store.ts`：本地持久化的偏好状态
- [x] T119 [US5] 在 `packages/web/src/api/client.ts` 为请求携带 `Accept-Language`，取值与偏好中的语言一致
- [x] T120 [US5] 新建 `packages/web/src/pages/settings-page.tsx`：语言、默认尺寸与 dpi、默认字体、显示单位、主题、轮询间隔、关闭确认
- [x] T121 [US5] 修改 `packages/web/src/editor/elements.ts` 的 `createBlankLabel()`，采用偏好中的默认尺寸与 dpi（FR-071）

**Checkpoint**: 双语与偏好完整。

---

## Phase 8: Polish & Cross-Cutting

- [x] T122 [P] 确认 ESLint 的 CJK 字面量规则覆盖新增的前端目录，且 `i18n/` 与测试夹具仍在豁免列表内
- [x] T123 [P] 覆盖率复核：核心逻辑 ≥ 80%（宪章质量门槛）；新增的 `geometry/` `undo.ts` `snapping.ts` 应接近全覆盖
- [x] T124 [P] 更新 `docs/frontend-design-v2.md`，补记 research.md R2 的新发现（二维码尺寸同样量化）
- [x] T125 [P] 更新 `docs/design-consensus.md`，记录本次推翻的偶数模块宽度结论与二维码渲染缺陷
- [x] T126 执行 `quickstart.md` 全流程自检（离线部分）—— 全部通过；过程中修正了字体校验命令（MANIFEST 用裸文件名，须在 `fonts/full/` 下执行，原命令从仓库根目录跑必然失败），同步修正 `fonts/README.md`
- [ ] T140 人工验收 SC-014：同时打开 10 个标签设计，确认元素拖动无可感知延迟（自动化测试无法可信地测量交互流畅度，故列为人工项）
- [x] T127 硬件实测：HW-1 二维码模块宽度下限 —— **2026-08-21 实测：2/3/4 dot 全部可读，下限维持 2 dot**（research.md R2）
- [ ] T128 硬件实测：HW-2 校正页刻度可读性、HW-3 偏移方向与标注一致、HW-4 1.2 倍行距小字号是否粘连

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 Setup
   └→ Phase 2 Foundational（schema + geometry + 迁移框架）
        ├→ Phase 3 US1（P1，MVP）───┐
        ├→ Phase 4 US2（P2）────────┤
        ├→ Phase 5 US3（P3）← 需 Phase 4 的标签页容器
        ├→ Phase 6 US4（P4）← 需 Phase 5 的画布尺寸联动
        └→ Phase 7 US5（P5）← 需 Phase 4 的设置页容器
                                    └→ Phase 8 Polish
```

### User Story Dependencies

- **US1** 完全独立，不依赖任何界面改造 —— 因此适合作为 MVP
- **US2** 独立于 US1
- **US3** 依赖 US2 的标签页容器（T041–T043）
- **US4** 依赖 US3 的画布（T074、T083）
- **US5** 依赖 US2 的设置页容器（T042、T044）

### Within Each User Story

测试任务 **MUST** 先于实现任务（宪章原则 II）。同一文件的任务串行。

### Parallel Opportunities

- Phase 2 的 T005–T007 三个测试任务可并行
- Phase 3 的 T012–T019 八个测试任务全部可并行
- Phase 4 的 T028–T037 十个测试任务全部可并行
- Phase 5 的 T056–T068 十三个测试任务全部可并行
- Phase 6 的 T084–T094 十一个测试任务全部可并行
- T051–T053（三个页面）互不相干，可并行
- Phase 8 的 T122–T125 可并行

---

## Implementation Strategy

### MVP First（仅 US1）

Phase 1 → Phase 2 → Phase 3，即可交付一个独立有价值的增量：
**二维码从"完全不可用"变为可用**。这是当前唯一正在造成实际损失的问题——
每打一张废一张，且预览与打印一致地错，用户察觉不到。

### Incremental Delivery

每个 Phase 结束都是一个可演示、可回退的检查点。
US2 之后界面骨架可演示；US3 之后编辑器可用；US4 之后换纸闭环完整；US5 之后双语完整。

### 风险提示

- **T023 修复二维码**会改变既有含二维码模板的渲染结果——这是**预期的**，
  因为原结果本就是错的。T086 的迁移哈希比对**须排除含二维码的模板**，
  否则会把这次修复误判为回归。
- **T077 修改 `boundsOf()`** 会同时影响编辑器提示与打印前校验两条路径，
  两处必须共用 `rotatedBounds()`，否则会出现"编辑器说没问题、打印时说超界"。
- **T025 移除全局模块宽度选项**是破坏性改动，须一次性更新全部调用点（T026）。
