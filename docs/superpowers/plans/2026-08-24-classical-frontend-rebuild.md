# Classical 前端页面重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有路由、状态、API、SVG 编辑器和 i18n 行为的前提下，把 Zenith Printer Web 前端整体重构为 Classical editorial 视觉系统。

**Architecture:** 以全局 CSS 令牌和现有 shadcn/ui 组件为基础，重做应用壳层（状态栏、标签栏、侧边栏、内容区）与通用页面头部/卡片/表格表现层。页面逻辑继续由现有 hooks、workspace、features 和 i18n 提供，避免改变业务接口；重构优先通过 CSS 与少量结构类名完成，编辑器画布仍使用 SVG DOM。

**Tech Stack:** React 19, TypeScript strict, Vite, Tailwind CSS 4, shadcn/ui, Vitest + happy-dom, Playwright。

**Spec:** `specs/001-label-design-print/plan.md`、`specs/004-google-sheets-source/plan.md`、`docs/google-sheets-data-source.md`。

## Global Constraints

- 所有用户可见中文文案继续通过现有 i18n 层输出。
- UI 优先复用 shadcn/ui；自建样式复用 Tailwind 令牌和 `cn()`，不引入第二套组件库。
- Classical 视觉遵循纸张近白底、墨色文字、金色细线、无大面积强调色块、轻阴影、衬线标题与正文可读行距。
- 编辑器继续使用 SVG DOM，不改用 canvas；打印预览与画布的白色语义保持不变。
- 不修改 REST 契约、数据源行为、打印队列、模板编辑和 workspace reducer。
- 前端验证必须包含页面渲染断言，并继续纳入默认 `npm test`。

---

### Task 1: 建立全局 Classical 令牌与 shell 骨架

**Files:**
- Modify: `packages/web/src/index.css`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/app/status-bar.tsx`
- Modify: `packages/web/src/app/sidebar.tsx`
- Modify: `packages/web/src/app/tab-bar.tsx`
- Modify: `packages/web/src/components/page-header.tsx`
- Test: `packages/web/tests/classical-shell.dom.test.tsx`

**Interfaces:**
- Consumes: `copy`, `WorkspaceProvider`, `useWorkspace`, existing shadcn `Button`, `AlertDialog`, `ScrollArea`。
- Produces: 页面挂载后可通过 `[data-classical-shell]`、`[data-classical-sidebar]`、`[data-classical-tab-bar]` 识别 shell 结构；连接状态、tab 切换、关闭确认和导航行为保持原有接口。

- [ ] **Step 1: Write the failing test**
  - 在 `classical-shell.dom.test.tsx` 中挂载 `App` 的最小 provider 环境，断言页面出现应用标题、侧边导航、tab bar 和连接状态文本；断言导航入口仍可触发 `open` 路径。
- [ ] **Step 2: Run test to verify it fails**
  - Run: `npx vitest run --project web packages/web/tests/classical-shell.dom.test.tsx`
  - Expected: FAIL，因为新 Classical data attributes 和 shell 结构尚未存在。
- [ ] **Step 3: Write minimal implementation**
  - 在 `index.css` 增加 Classical token 层：ground、surface、ink、muted ink、accent、divider、display/body/mono font、editorial spacing、hairline shadow、focus ring。
  - 重做 `StatusBar` 为品牌 masthead + 状态标记；重做 `Sidebar` 为目录式分组和编号标记；重做 `TabBar` 为细线 tab strip；给 `App` 内容区加 shell data attribute 和更宽松的 editorial gutters；调整 `PageHeader` 为 kicker、标题、说明和右侧 actions 的统一结构。
  - 保持所有按钮事件、aria-label、dialog 和连接状态文案不变。
- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run --project web packages/web/tests/classical-shell.dom.test.tsx`
  - Expected: PASS。
- [ ] **Step 5: Commit**
  - `git add packages/web/src/index.css packages/web/src/App.tsx packages/web/src/app packages/web/src/components/page-header.tsx packages/web/tests/classical-shell.dom.test.tsx`
  - `git commit -m "feat(web): 重构 Classical 应用壳层"`

### Task 2: 统一页面级卡片、表格与空状态视觉

**Files:**
- Modify: `packages/web/src/components/ui/card.tsx`
- Modify: `packages/web/src/components/ui/button.tsx`
- Modify: `packages/web/src/components/ui/badge.tsx`
- Modify: `packages/web/src/components/ui/alert.tsx`
- Modify: `packages/web/src/components/ui/table.tsx`
- Modify: `packages/web/src/components/ui/empty.tsx`
- Modify: `packages/web/src/pages/index-page.tsx`
- Modify: `packages/web/src/pages/templates-page.tsx`
- Modify: `packages/web/src/pages/queue-page.tsx`
- Modify: `packages/web/src/pages/history-page.tsx`
- Modify: `packages/web/src/pages/settings-page.tsx`
- Modify: `packages/web/src/pages/print-presets-page.tsx`
- Modify: `packages/web/src/pages/api-docs-page.tsx`
- Modify: `packages/web/src/features/data-sources/data-sources-page.tsx`
- Modify: `packages/web/src/features/printers/printers-page.tsx`
- Test: existing page DOM tests plus `packages/web/tests/classical-pages.dom.test.tsx`

**Interfaces:**
- Consumes: existing page hooks, copy resources, data source Google Sheets states, job and printer states。
- Produces: 页面级组件使用 outlined cards、hairline dividers、Classical buttons/tags、matte plate thumbnails 和统一空状态，不改变页面对外行为。

- [ ] **Step 1: Write the failing test**
  - 新增页面渲染测试，挂载 overview、templates、queue、history、settings 和 data sources 的基础状态，断言每个页面都能挂载并存在页面标题/主要内容；断言链接数据源仍显示来源与刷新入口。
- [ ] **Step 2: Run test to verify it fails**
  - Run: `npx vitest run --project web packages/web/tests/classical-pages.dom.test.tsx`
  - Expected: FAIL，因为页面尚未使用统一的 Classical page markers/structure。
- [ ] **Step 3: Write minimal implementation**
  - 让 Card、Button、Badge、Alert、Table、Empty 组件从全局 token 获得边框、文字、hover/focus、阴影和圆角；删除页面级硬编码的大面积背景和过重的状态填充。
  - 在 overview 中把打印机、最近模板、最近任务改为 editorial sections；模板缩略图外包 `.plate`；数据表格和历史列表使用规则线；错误和空状态用小 kicker + 说明文本。
  - 对 Google Sheets 链接数据源保留只读提示、刷新、解绑和失败文案，视觉上用 accent rule 区分来源，不改变逻辑。
- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run --project web packages/web/tests/classical-pages.dom.test.tsx packages/web/tests/navigation-and-pools.dom.test.tsx packages/web/tests/recent-jobs.dom.test.tsx`
  - Expected: PASS。
- [ ] **Step 5: Commit**
  - `git add packages/web/src/components packages/web/src/pages packages/web/src/features packages/web/tests/classical-pages.dom.test.tsx`
  - `git commit -m "feat(web): 统一 Classical 页面组件视觉"`

### Task 3: 重构设计器与打印相关界面

**Files:**
- Modify: `packages/web/src/editor/editor-page.tsx`
- Modify: `packages/web/src/editor/*`（仅页面布局和 className，不修改编辑器纯逻辑）
- Modify: `packages/web/src/features/jobs/*`（仅打印对话框/队列呈现层）
- Modify: `packages/web/src/features/printers/*`（仅页面呈现层）
- Modify: `packages/web/src/index.css`
- Test: `packages/web/tests/render-smoke.dom.test.tsx`
- Test: `packages/web/tests/print-preview.dom.test.tsx`

**Interfaces:**
- Consumes: 现有 SVG IR、editor state、print dialog、queue hooks、Google Sheets refresh hooks。
- Produces: 设计器使用纸张样张画布、editorial inspector、outlined actions；打印预览与刷新入口行为不变。

- [ ] **Step 1: Write the failing test**
  - 扩展 `render-smoke.dom.test.tsx` 和 `print-preview.dom.test.tsx`，断言编辑器、画布、工具区、打印预览、刷新按钮和选择清空提示挂载成功。
- [ ] **Step 2: Run test to verify it fails**
  - Run: `npx vitest run --project web packages/web/tests/render-smoke.dom.test.tsx packages/web/tests/print-preview.dom.test.tsx`
  - Expected: FAIL，因为 Classical editor markers 和 inspector structure 尚未存在。
- [ ] **Step 3: Write minimal implementation**
  - 仅调整 editor layout classes、section labels、canvas wrapper、toolbar 和 inspector surface；保留所有 SVG 元素、拖拽、缩放、撤销、绑定和打印逻辑。
  - 用 `.plate`/outline 视觉包裹打印样张；把刷新进行中、失败保留旧行、列变化确认等状态呈现为 hairline alert，不用实体色块。
- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run --project web packages/web/tests/render-smoke.dom.test.tsx packages/web/tests/print-preview.dom.test.tsx packages/web/tests/offset-panel.dom.test.tsx`
  - Expected: PASS。
- [ ] **Step 5: Commit**
  - `git add packages/web/src/editor packages/web/src/features/jobs packages/web/src/features/printers packages/web/src/index.css packages/web/tests/render-smoke.dom.test.tsx packages/web/tests/print-preview.dom.test.tsx`
  - `git commit -m "feat(web): 重塑 Classical 设计与打印界面"`

### Task 4: 全面验证与审查

**Files:**
- Modify: only files required by verification findings。
- Test: all existing web tests and Playwright page smoke tests。

**Interfaces:**
- Consumes: Tasks 1–3 output。
- Produces: 可审查的 Classical 页面重构，所有可导航页面具备挂载断言，类型和 Lint 通过。

- [ ] **Step 1: Run focused web tests**
  - `npx vitest run --project web`
  - Expected: PASS。
- [ ] **Step 2: Run static checks**
  - `npm run typecheck`
  - `npm run lint`
  - Expected: zero errors and zero new warnings。
- [ ] **Step 3: Run Playwright smoke checks**
  - Start the existing project dev command, visit `/`, `/templates`, `/queue`, `/history`, `/settings`, `/data-sources`, and `/printers`; assert title/primary content and no uncaught page errors。
  - Expected: every navigable page mounts and the Classical shell is visible。
- [ ] **Step 4: Review diff and verify scope**
  - `git diff --stat`, `git diff --check`, inspect changed files for hard-coded non-i18n Chinese strings, hard-coded token values, accidental business logic changes, and unintended dependency changes。
- [ ] **Step 5: Commit any verification fixes**
  - Use `fix(web): ...` with a Chinese body description in the commit subject。
