# Tasks: Nocturne 前端重构

**Input**: Design documents from `/specs/005-nocturne-web-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/draft-store.md, contracts/visual-tokens.md, quickstart.md

**Tests**: 宪章原则 II——每个故事的测试任务先于实现任务，先红后绿。每个可导航页面一条渲染断言。

**Organization**: 按用户故事分阶段。三步交付映射为：第 1 步 = US1（Phase 3）；第 2 步 = US2（Phase 4）；第 3 步 = US3 + US4 + US5 + US6（Phase 5–8）。**Phase 5 不得早于 Phase 4 合并。**

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: US1–US6
- 路径均相对仓库根目录；`web/` 指 `packages/web/`

---

## Phase 1: Setup（共享基础）

**Purpose**: 字体资产、测试配置、清掉本会话遗留的浅色方案

- [X] T001 [P] 用 `scripts/fetch-fonts.sh` 同一套方式取得 Inter Regular/Medium 源文件并用 `scripts/subset-fonts.py` 生成 Latin+数字子集，产出 `web/public/fonts/subset/Inter-Regular.woff2` 与 `Inter-Medium.woff2`（各 ≤ 60 KB）；在 `scripts/fetch-fonts.sh` 里记录来源与许可
- [X] T002 [P] 在 `vitest.config.ts` 的 coverage `include` 加入 `packages/web/src/features/drafts/*.ts`、`packages/web/src/features/print/head-figure.ts`、`packages/web/src/features/templates/thumbnail-values.ts`、`packages/web/src/app/status-summary.ts`
- [X] T003 [P] 删除 `web/tests/classical-shell.dom.test.tsx`（Classical 壳层不复存在；它断言的 `data-classical-*` 标记将随第 1 步移除）
- [X] T004 在 `.gitignore` 加入 `.playwright-mcp/`（本会话截图目录，不入库）

---

## Phase 2: Foundational（草稿领域核心，纯逻辑）

**Purpose**: US2/US3/US4/US6 都建立在草稿存储之上；先把它作为无 UI 的纯逻辑立起来并测满。**US1 不依赖本阶段，可与之并行。**

### Tests（先写，确认红）

- [X] T005 [P] `web/tests/drafts/schema.test.ts`：`draftSchema` 接受契约里的完整形状；拒绝缺字段、`past` 超过 50、非 ISO 时间；`draftIndexSchema` 只接受 `version: 1`
- [X] T006 [P] `web/tests/drafts/trim.test.ts`：`trimForStorage(draft)` 把 `past` 裁到最近 50 条；`dropHistory(draft)` 返回 `past: []` 且 `present` 不变；两者不修改入参
- [X] T007 [P] `web/tests/drafts/store.test.ts`（用内存 `DraftStorage` 假实现 + 注入时钟/窗口 id）：`write` 后 `read` 等值；`write` 更新索引；`remove` 同时清索引；`list()` 自愈（索引有键无 → 剔除；键有索引无 → 补上）；损坏 JSON → `read` 返回 `{corrupt: true}` 且 `list().corrupt` 含该 id；**`setItem` 抛 `QuotaExceededError` 一次 → 返回 `'stored-without-history'` 且存下的 `past` 为空**；连续两次抛 → `'unpersisted'` 且什么都没写；`clear()` 只删 `zenith.drafts.v1.*` 前缀的键；**`createdAt` 为 400 天前的草稿仍出现在 `list()` 中**（FR-021：没有 TTL）
- [X] T008 [P] `web/tests/drafts/version.test.ts`：`isBaselineStale(draft, serverVersion)`：`server > base` 为 true，等于/小于为 false，`base === null` 为 false；`changedByAnotherWindow(draft, windowId, lastWrittenAt)`：`writerId` 不同且 `updatedAt > lastWrittenAt` 为 true，其余 false
- [X] T009 [P] `web/tests/drafts/window-id.test.ts`：同一 `sessionStorage` 两次取同一 id；不同 storage 不同 id；storage 不可用时仍返回非空 id（内存回退）

### Implementation

- [X] T010 [P] `web/src/features/drafts/schema.ts`：`draftSchema`、`draftIndexEntrySchema`、`draftIndexSchema`，类型 `Draft`、`DraftIndexEntry`、`CorruptDraft`（引用 `@zenith/shared` 的 `labelIrSchema` 与变量 schema，`UNDO_LIMIT` 来自 `editor/undo.ts`）
- [X] T011 [P] `web/src/features/drafts/storage.ts`：`DraftStorage` 接口；`localDraftStorage()`（直接透传 `localStorage`，**不吞异常**；`keys()` 过滤前缀）；`memoryDraftStorage()`（Map 实现，供测试与隐私模式）；`isLocalStorageUsable()` 复用 `lib/storage.ts` 的探测
- [X] T012 [P] `web/src/features/drafts/trim.ts`：`trimForStorage`、`dropHistory`
- [X] T013 [P] `web/src/features/drafts/version.ts`：`isBaselineStale`、`changedByAnotherWindow`
- [X] T014 [P] `web/src/features/drafts/window-id.ts`：`windowId(storage = sessionStorage)`，键 `zenith.window`
- [X] T015 `web/src/features/drafts/store.ts`：`createDraftStore(storage, clock, windowId)` 实现契约的 `read/write/remove/list/clear`（依赖 T010–T014）；`write` 的降级序列：原样 → `dropHistory` 重试 → `'unpersisted'`
- [X] T016 `web/src/features/drafts/index.ts`：导出上述模块 + 一个默认单例 `draftStore`（`localDraftStorage` 可用则用之，否则 `memoryDraftStorage`；时钟 `() => new Date().toISOString()`）

**Checkpoint**: `npm test -- --project default` 中 `drafts/*` 全绿；`test:coverage` 里 `features/drafts/*.ts` ≥ 80%。

---

## Phase 3: User Story 1 - 界面换成暗房灯箱 (Priority: P1) 🎯 交付第 1 步

**Goal**: Nocturne 令牌进 `@theme`，纸是唯一的白并带微光，无衬线标题，字重 500，单一配色。

**Independent Test**: 每页渲染不抛；`design-tokens.test.ts` 的对比度与"唯一的白"通过；首屏无衬线字体。

### Tests（先写，确认红）

- [X] T017 [P] [US1] 重写 `web/tests/design-tokens.test.ts`：(a) 解析 `web/src/index.css` 的 `@theme` 块，断言 `contracts/visual-tokens.md` 表中每个语义令牌的值**逐字相等**（Nocturne 原值）；(b) 用 WCAG 相对亮度算：`foreground/background ≥ 4.5`、`muted-foreground/background ≥ 4.5`、`accent-300/background ≥ 4.5`、`card-foreground/card ≥ 4.5`、`secondary-foreground/secondary ≥ 4.5`、`destructive/background ≥ 4.5`、`warning/background ≥ 4.5`、`success/background ≥ 4.5`、`primary/background ≥ 3`；(c) `#ffffff`/`#fff`/`white`/`bg-white` 在 `web/src/**` 只出现在 `index.css` 的 `.paper` 规则内；(d) 保留既有的 Tailwind 调色板扫描；(e) `index.css` 不含 `classical`、`--font-display`、`--shadow-sheet`
- [X] T018 [P] [US1] 新建 `web/tests/fonts.test.ts`：扫描 `web/src/**/*.tsx` 与 `index.css` 的非 `@font-face` 规则，断言不出现 `font-display`、`font-serif`、`Noto Serif`；断言 `fonts.css` 仍声明 `Noto Serif CJK SC`（渲染字体）且新增 `Inter` 400/500 指向 `/fonts/subset/Inter-*.woff2`；断言 `web/public/fonts/subset/Inter-Regular.woff2` 与 `Inter-Medium.woff2` 存在且各 ≤ 60 KB；断言 `copy.editor.fonts` 的取值与 `packages/server/src/render/fonts.ts` 的 `FONT_FAMILIES` 都不含 `Inter`（界面字体不是渲染字体）
- [X] T019 [P] [US1] 新建 `web/tests/heading-weight.dom.test.tsx`：渲染 `PageHeader` 与 `App`，断言所有 `h1–h3` 的 class 不含 `font-bold`/`font-semibold`，含 `font-medium`（结构断言，不断言颜色）
- [X] T020 [P] [US1] 新建 `web/tests/paper.dom.test.tsx`：渲染编辑器画布与 `ThumbnailFrame`，断言 `[data-label-canvas]` 与 `[data-thumbnail-frame]` 都带 `paper` 类；断言 `ThumbnailFrame` 不再带 `bg-white`
- [X] T021 [US1] 更新 `web/tests/render-smoke.dom.test.tsx` 的侧栏文案期望为当前七项（本步不改导航），确认改令牌后每页仍能渲染；设置页"无主题选项"断言（`settings.dom.test.tsx`）保持不变

### Implementation

- [X] T022 [US1] 重写 `web/src/index.css`：按 `contracts/visual-tokens.md` 写 `@theme`（十六进制原值 + 三个新增状态色 + neutral/accent 阶梯 + `--radius-sm/md/lg` + `--shadow-sm/md/lg` + `--font-sans` + `--spacing-n1…n8`）；`.paper`/`.paper-lg`；`.separator-fade` 渐变；全局 `:focus-visible` 轮廓；`::selection`；`body` 用 `bg-background text-foreground font-sans`；保留 `.dsg-*` 与 `.scrollbar-themed` 映射（改为新令牌）；**删除所有 `[data-classical-*]`、`.classical-*`、`--color-classical-*`、`--font-display`、`--shadow-sheet`**
- [X] T023 [P] [US1] `web/src/fonts.css`：新增 Inter 400/500 `@font-face`；`Noto Serif CJK SC` 保留并加注释说明它是渲染字体而非界面字体
- [X] T024 [P] [US1] `web/src/components/ui/button.tsx`：`default` = `border border-primary text-primary bg-transparent hover:bg-primary/12 active:bg-primary/22`；`secondary` = `border border-border hover:bg-foreground/7`；`ghost` = `text-primary hover:bg-primary/10`；`destructive` = `border border-destructive text-destructive bg-transparent hover:bg-destructive/12`（描边，不填充）；`rounded-md`
- [X] T025 [P] [US1] `web/src/components/ui/card.tsx`、`dialog.tsx`、`alert-dialog.tsx`：`bg-card shadow-sm`（Card）/ `bg-card shadow-lg rounded-lg`（Dialog）；`input.tsx`、`textarea.tsx`、`select.tsx`：`bg-transparent border-input focus-visible:border-ring`；`separator.tsx` 加 `fade?: boolean` → `separator-fade`；`table.tsx` 行线用 `separator-fade` 底边；`alert.tsx` 的 `warning/destructive/info` 变体改为"淡染面 + 语义色文字 + 语义色左边线"，不做实心填充；`badge.tsx` 各变体改为"阶梯色淡染底 + 描边"（`--color-accent-800`/`--color-neutral-800` 这类阶梯色允许作底，`--color-primary` 本身不作底）
- [X] T026 [P] [US1] `web/src/components/page-header.tsx`：`h2` 去 `font-display`，用 `text-base font-medium`；改注释（不再讲衬线）
- [X] T027 [P] [US1] `web/src/editor/canvas.tsx`（及 `canvas-viewport.tsx` 若持有画布容器）：`[data-label-canvas]` 元素加 `paper paper-lg`；`web/src/features/templates/thumbnail-frame.tsx`：`bg-white border border-border` → `paper`；`web/src/features/print/preview.tsx` 与 `features/jobs/history.tsx` 的快照容器加 `paper`
- [X] T028 [P] [US1] `web/src/app/sidebar.tsx`、`app/status-bar.tsx`、`app/tab-bar.tsx`、`App.tsx`：删除 `data-classical-*` 属性与 `classical-*` 类；侧栏行用 Nocturne 形态（选中：`text-primary bg-primary/11 shadow-[inset_2px_0_0_var(--color-primary)]`；间距 `px-n3 py-n2`）；顶栏/边界一律 `border-border`
- [X] T029 [US1] 全仓 `web/src/**/*.tsx` 扫一遍 `font-semibold`/`font-bold` 用于标题的地方改 `font-medium`；`text-white` → `text-foreground`；确认 `design-tokens.test.ts`、`fonts.test.ts` 转绿
- [X] T030 [US1] i18n：`settings` 区若仍有主题相关键则删除（`zh-CN.ts`/`en-US.ts` 同步）；跑 `i18n-completeness.test.ts`

**Checkpoint**: `npm run typecheck && npm run lint && npm test` 全绿；按 quickstart 第 1 步在浏览器目视：深色、描边按钮、白纸带光、Network 无 `NotoSerif*`。**可独立提交为第 1 步。**

---

## Phase 4: User Story 2 - 编辑到一半离开，回来什么都没丢 (Priority: P1) 🎯 交付第 2 步

**Goal**: 编辑器接入草稿；标签页栏仍在；关闭确认框改为如实文案；配额降级与隐私模式提示。

**Independent Test**: 编辑不保存 → 点侧栏/刷新/关标签页再回来 → 内容与撤销在；关闭确认框说"会作为草稿保留"。

### Tests（先写，确认红）

- [ ] T031 [P] [US2] 新建 `web/tests/editor-draft.dom.test.tsx`（假 fetch 返回一张模板；注入内存 `DraftStorage`）：(a) 拖动/修改元素后 350 ms 内 `store.read(templateId)` 有 `present` 与 `past.length ≥ 1`；(b) 卸载 `EditorPage` 再重新挂载同一 `templateId` → 画布显示修改后的内容，且「撤销」按钮可用；(c) 新标签（`templateId=null`，`draftId` 给定）同样往返；(d) 保存成功后 `store.read` 为 `null`；(e) `write` 返回 `'unpersisted'` 时编辑器顶部出现 `copy.drafts.unpersisted` 文案，恢复 `'stored'` 后消失；(f) `localStorage` 不可用（内存 storage + `isLocalStorageUsable()` 假为 false）时显示 `copy.drafts.noStorage`
- [ ] T032 [P] [US2] 新建 `web/tests/tab-close-copy.dom.test.tsx`：有未保存修改的标签页点关闭 → 确认框文案含「草稿」且不含「无法恢复」；确认后草稿仍在 `store`；再次打开该模板的标签页内容仍在
- [ ] T033 [P] [US2] 更新 `web/tests/workspace.test.ts`：`openTab` 对 `templateId === null` 的设计分配稳定 `draftId`（注入的 id 工厂），`setTabTemplate` 后 `draftId` 保留（草稿键不因保存而变，保存后由 store 删除）
- [ ] T034 [P] [US2] 新建 `web/tests/use-draft.test.ts`（Node，假计时器）：`useDraft` 的纯调度核心 `scheduleWrite/flush`：300 ms 内多次调用只写一次；`flush()` 立即写；`pagehide`/`visibilitychange` 触发 `flush`

### Implementation

- [ ] T035 [P] [US2] i18n `zh-CN.ts`/`en-US.ts` 新增 `drafts` 区：`unpersisted`（三要素：修改无法在本机保留 / 本机存储空间不足 / 离开前请先保存）、`noStorage`（这台浏览器不允许保存草稿 / 隐私模式或策略限制 / 离开即丢失）、`anotherWindow`（这台机器上另一个窗口改过它）；`workspace.confirmCloseBody` 改为「修改会作为草稿保留在本机，下次打开时恢复」；`confirmCloseConfirm` 改为「关闭」
- [ ] T036 [P] [US2] `web/src/features/drafts/use-draft.ts`：`createWriteScheduler(store, delayMs, timers)`（纯逻辑，T034 测它）+ `useDraft(draftKey, { templateId, baseVersion })` hook：初始读；`update(snapshot)` 走调度；`flush()`；卸载/`pagehide`/`visibilitychange→hidden` 冲刷；暴露 `status: 'stored'|'stored-without-history'|'unpersisted'|'no-storage'`；`discard()`
- [ ] T037 [US2] `web/src/app/workspace-state.ts`：`WorkspaceTab` 加 `draftId: string`（设计标签页必有：`templateId ?? nextId()`）；`openTab` 与 `setTabTemplate` 维护它；`hasUnsavedWork` 改为读取注入的 `unpersistedIds`（只有落不了盘的才算"会丢"）
- [ ] T038 [US2] `web/src/editor/editor-page.tsx`：接收 `draftKey`；用 `useDraft` 初始化 `history`（有草稿 → `{past, present}`；无 → 服务器模板或空白）；每次 `history`/`variables`/`dataSourceId` 变化调用 `update`；`onSaved` 后 `discard()`；顶部按 `status` 显示 T035 的提示（`Alert variant="warning"`）；更新 `undo.ts` 顶部"Not persisted (FR-088)"注释为"持久化进草稿，见 005"
- [ ] T039 [US2] `web/src/App.tsx`：`EditorPage` 传 `draftKey={tab.draftId}`；`web/src/app/tab-bar.tsx`：关闭确认使用新文案；`web/src/app/workspace.tsx`：`beforeunload` 只在存在 `unpersisted` 草稿时提示
- [ ] T040 [US2] 跑 T031–T034 转绿；`render-smoke` 仍绿

**Checkpoint**: quickstart 第 2 步 7 条手动验收通过。**可独立提交为第 2 步；此后才允许 Phase 5。**

---

## Phase 5: User Story 3 - 从画廊直达编辑器 (Priority: P1) 🎯 交付第 3 步·主体

**Goal**: 去标签页栏、去首页；「标签」画廊即首页，含状态带；缩略图按比例并代入第一行；点一张进整页编辑器；文案里无「模板」。

**Independent Test**: 根地址落在画廊；八个侧栏入口都可达；点标签进编辑器且侧栏在；搜「模板」为 0。

### Tests（先写，确认红）

- [ ] T041 [P] [US3] 新建 `web/tests/status-summary.test.ts`：三台打印机（在线支持余量 / 在线不支持 / 离线）→ 三种 `remaining`；无打印机 → `queue: null`；任务列表 → `pending` 计数只含 `queued|printing`；`lastPrint` 取 `finishedAt` 最新者并带 `snapshot.templateName`
- [ ] T042 [P] [US3] 新建 `web/tests/thumbnail-values.test.ts`：`thumbnailValues(variables, firstRow)`：绑定列存在 → 取值；缺列 → `''`；`firstRow` 为 `undefined` → 等于 `designValues(variables)`
- [ ] T043 [P] [US3] 新建 `web/tests/gallery-items.test.ts`：`galleryItems(templates, draftIndex, corruptIds)`：未命名草稿在前（`createdAt` 降序）→ 孤儿草稿 → 已保存（按名）；已保存且有草稿 → `kind: 'saved-with-draft'`；模板 404 的草稿 → `'orphan-draft'`；`corruptIds` → `'corrupt-draft'`
- [ ] T044 [P] [US3] 新建 `web/tests/gallery.dom.test.tsx`（假 fetch：两张模板 50×30 与 100×150，一张绑定数据源且 `rows` 返回第一行 `{货位号: 'A-12-03'}`；内存草稿 store 里一份未命名草稿）：(a) 未命名草稿格在最前且带 `[data-unsaved]`；(b) 两张缩略图容器宽高比分别 ≈ 5:3 与 2:3（误差 ≤ 1%）且都在 `thumbnailBoxPx` 的范围内；再加一张 10×200 的标签，断言其容器被夹住（高 = 上限、宽 ≥ 最小可辨尺寸）而不是按比例撑破；(c) 绑定那张的 `<img>` `src` 解码后含 `A-12-03`；未绑定那张含 `${`；(d) 标题区不含数字总数；(e) 点一张模板 → `EditorPage` 挂载、侧栏仍在文档中、没有「返回」按钮；(f) 空列表 → 显示 `copy.labels.empty` 且状态带仍渲染；(g) `rows` 请求被拒绝时缩略图仍出现（占位符）
- [ ] T045 [P] [US3] 新建 `web/tests/status-strip.dom.test.tsx`：渲染 `StatusStrip`：显示打印机名与「在线/离线」、「余量 N 张」或「本机型无法上报余量」、「队列运行中 · N 个待处理」、「最近：<标签名> 已完成」；无打印机时显示 `copy.printers.empty`
- [ ] T046 [P] [US3] 新建 `web/tests/terminology.test.ts`：递归遍历 `copy`（函数用代表参数调用）断言所有字符串不含「模板」；`en-US` 不含 `template`（大小写不敏感，允许 `templateId` 这类键名——只检查值）
- [ ] T047 [US3] 重写 `web/tests/render-smoke.dom.test.tsx`：根地址挂载不抛且出现画廊；侧栏恰好八项且顺序为 标签、数据源、打印机、队列、历史、打印预设、接口调试、设置；逐项点击后不抛；文档中没有 `[data-tab-bar]`；没有「首页」「模板库」「标签设计」文字；`/labels/new/<id>?preset=x` 挂载不抛
- [ ] T048 [P] [US3] 重写 `web/tests/routes.test.ts` 与 `web/tests/workspace.test.ts` 为单页模型：`pathForPage`/`pageFromPath` 覆盖 `/`、`/labels/:id`、`/labels/new/:draftId`、`?preset=`；`WorkspaceState = { page }`；`open()` 直接替换；删除 `SOFT_TAB_LIMIT`、`draftNumber`、`closeTab`、`activateTab` 相关用例；**迁移 `web/tests/preset-link.dom.test.tsx`** 到新路由 API，并保留其中一条用例仍以旧地址 `/design/tpl-7?preset=pre-1` 进入——断言落在编辑器、预设生效、且 `window.location.pathname` 已被改写为 `/labels/tpl-7` 而查询串保留（旧地址兼容的回归测试）；同样为 `/templates` 加一条 → 画廊
- [ ] T049 [P] [US3] 删除 `web/tests/untitled-design-tabs.dom.test.tsx`、`tab-middle-click.dom.test.tsx`、`tab-close-copy.dom.test.tsx`、`index-templates.dom.test.tsx`、`recent-jobs.dom.test.tsx`、`open-template.dom.test.tsx`（其断言对象被删除；有价值的场景已并入 T044/T047）

### Implementation

- [ ] T050 [P] [US3] `web/src/app/status-summary.ts`：`summarize(printers, jobs): StatusSummary`（复用 `pages/consumable.ts`）
- [ ] T051 [P] [US3] `web/src/features/templates/thumbnail-values.ts`：`thumbnailValues(variables, firstRow?)`
- [ ] T052 [P] [US3] `web/src/features/templates/gallery-items.ts`：`galleryItems(...)`（data-model §5）
- [ ] T053 [P] [US3] `web/src/features/templates/hooks.ts`：新增 `useFirstRow(dataSourceId | null)`（复用既有分页接口：`GET /api/data-sources/:id/rows?page=1&pageSize=1&order=asc`，返回 `RowPage`，取 `rows[0]`；`enabled: id !== null`，`staleTime` 60 s）
- [ ] T054 [P] [US3] `web/src/features/templates/thumbnail-svg.tsx`：`ThumbnailSvg({ ir, values, widthPx, heightPx })` → `<img src="data:image/svg+xml;utf8,…" data-thumbnail>`，内容 `irToSvg(evaluateIr(ir, values))`；`evaluateIr` 抛错时回退到 `irToSvg(ir)`
- [ ] T055 [P] [US3] `web/src/app/status-strip.tsx`：`StatusStrip({ summary })`，`Badge` + `Separator fade`，文案全部走 `copy.status.*`
- [ ] T056 [US3] i18n：新增 `labels` 区（`heading: '标签'`、`new: '新建标签'`、`empty`、`emptyDetail`、`untitled: '未命名'`、`unsaved: '未保存'`、`savedWithDraft: '有未保存的修改'`、`orphan: '原标签已被删除'`、`corrupt: '无法读取'`、`clearDrafts`…）与 `status` 区；**清扫 22 处「模板」**：`workspace.tabs.*`（`labels`/`label` 取代 `index/templates/design`）、`templates.*`（heading→「标签」、save→「保存」、conflict、name、searchPlaceholder、import*、renameHint）、`index.*` 整区删除、`preview.needsTemplateForSequence`、`history.template/adHoc`、`images.pruneConfirmBody`、`softLimitWarning` 删除；`en-US` 同步；T046 转绿
- [ ] T057 [US3] `web/src/app/routes.ts`：`PAGE_KINDS = ['labels','label','data-sources','data-source','printers','queue','history','print-presets','api-docs','settings']`；`PageDescriptor { kind, templateId?, draftId?, dataSourceId?, presetId? }`；`pathForPage`/`pageFromPath`（`/` ↔ labels；`/labels/:id`、`/labels/new/:draftId` ↔ label）；侧栏顺序常量 `SIDEBAR_KINDS`；**旧地址兼容**：`pageFromPath` 接受 `/design/:id`（含查询串）→ `label`、`/design` → 新建 `label`、`/templates` → `labels`、`/` 的旧首页语义 → `labels`；`workspace.tsx` 在恢复时若解析到旧地址则 `history.replaceState` 为 `pathForPage` 的新地址（查询串保留）；`docs/nexus-assets.md`/`.en.md` **不改**
- [ ] T058 [US3] `web/src/app/workspace-state.ts` 收缩为 `{ page: PageDescriptor }` + `open(state, descriptor)`、`restoreFromPath`；删除标签页集合、软上限、`draftNumber`；`web/src/app/workspace.tsx`：`open()` 前调用注入的 `flushDrafts()`；地址栏同步保留
- [ ] T059 [US3] `web/src/pages/labels-page.tsx`：`PageHeader`（标题「标签」，无计数；动作：搜索、导入、「新建标签」→ `open({kind:'label', draftId: randomId()})`）+ `StatusStrip` + 画廊（`galleryItems` → `GalleryTile`：`.paper` 容器尺寸 `thumbnailBoxPx(item, {240,140})`、`ThumbnailSvg`、名称、`宽 × 高 mm`、`[data-unsaved]` 记号、`orphan/corrupt` 标注）+ 空状态（`Empty`）；保留原 `templates-page.tsx` 的重命名/删除/导出能力（迁入格子的上下文菜单或悬停动作）
- [ ] T060 [US3] `web/src/App.tsx`：删除 `TabBar` 与 hidden-mount 循环，按 `state.page.kind` 渲染单一页面；`label` → `EditorPage draftKey={page.draftId ?? page.templateId}`；删除 `pages/index-page.tsx`、`pages/templates-page.tsx`、`app/tab-bar.tsx`；`sidebar.tsx` 用 `SIDEBAR_KINDS`，`labels` 高亮规则：`page.kind === 'labels' || page.kind === 'label'`
- [ ] T061 [US3] `web/src/editor/editor-page.tsx`：去掉 `tabId`/`workspace.setDirty` 依赖，改为通过 `useDraft` 的 `status` 汇报；删除 `template-bar.tsx` 里"打开模板"下拉（画廊取代）；`docs/README_zh.md` 与 `README.md` 的导航说明段更新为八项与「标签」
- [ ] T062 [US3] 跑全部测试转绿；`typecheck`/`lint`

**Checkpoint**: quickstart 第 3 步 1–5、9 条通过。

---

## Phase 6: User Story 4 - 版本冲突不覆盖别人的活 (Priority: P2)

**Goal**: 打开时基线过期警告；409 → 另存为新标签；同机另一窗口提示；孤儿草稿处理。

**Independent Test**: 两个会话先后保存，后者看到警告与另存入口，两份都在。

### Tests（先写，确认红）

- [ ] T063 [P] [US4] 新建 `web/tests/conflict.dom.test.tsx`：(a) store 里草稿 `baseVersion: 1`，fetch 返回 `version: 2` → 进入编辑器前出现 `copy.drafts.staleTitle` 的 `AlertDialog`，含「继续用草稿」与「放弃草稿」；选前者 → 画布为草稿内容；选后者 → 画布为服务器内容且 `store.read` 为 `null`；(b) 保存返回 409 → 出现「另存为新标签」按钮；点击 → 名称输入 → `POST /api/templates` 被调用且 body 为草稿内容，随后 `store.read(旧 id)` 为 `null`；(c) fetch 返回 404 → 画廊该格标 `copy.labels.orphan`，编辑器仍可打开并提供另存
- [ ] T064 [P] [US4] 扩展 `web/tests/editor-draft.dom.test.tsx`：store 中草稿 `writerId` 为他窗口且 `updatedAt` 晚于本窗口上次写入 → 挂载后出现 `copy.drafts.anotherWindow`；本窗口自己写的 → 不出现

### Implementation

- [ ] T065 [P] [US4] i18n：`drafts.staleTitle/staleBody/keepDraft/discardDraft`（三要素）、`templates.saveAsNew`（「另存为新标签」）、`templates.saveAsNewName`；`templates.conflict` 改写为指向另存入口
- [ ] T066 [US4] `web/src/editor/editor-page.tsx`：加载时 `isBaselineStale(draft, template.version)` → 渲染 `StaleDraftDialog`（`AlertDialog`）；`changedByAnotherWindow` → `Alert`；孤儿（模板 404 且有草稿）→ 以草稿打开并标注
- [ ] T067 [US4] `web/src/features/templates/template-bar.tsx`：`conflict` 为真时显示「另存为新标签」→ 名称 `Dialog` → 走 `asNew` 分支；成功后 `onSaved` + `discard()`
- [ ] T068 [US4] 跑 T063–T064 转绿

**Checkpoint**: quickstart 第 3 步 6、7 条通过。

---

## Phase 7: User Story 5 - 打印前看到标签在打印头上的位置 (Priority: P3)

### Tests（先写，确认红）

- [ ] T069 [P] [US5] 新建 `web/tests/head-figure.test.ts`：`headFigure({labelWidthMm: 50, maxWidthMm: 57})` → `{labelFraction ≈ .877, overflowFraction: 0}`；`100/57` → `{1, ≈ .43}`；`maxWidthMm ≤ 0` → `null`；`maxWidthFromCapabilities(null)` → `null`，`({printheadPixels: 384, dpi: 203})` → `≈ 48.05`
- [ ] T070 [P] [US5] 新建 `web/tests/print-head-figure.dom.test.tsx`：打印框在已探测打印机上渲染 `[data-head-figure]` 且其 `aria-label` 含 `50` 与 `57`；溢出时含 `[data-overflow]`；未探测打印机不渲染 `[data-head-figure]` 而显示 `copy.print.needsProbe`；`OverflowNotice` 行为不变（既有测试仍绿）

### Implementation

- [ ] T071 [P] [US5] `web/src/features/print/head-figure.ts`：`maxWidthFromCapabilities`（`dotsToMm`）、`headFigure`
- [ ] T072 [P] [US5] `web/src/features/print/head-figure.tsx`：内联 SVG，横条 `stroke=var(--color-primary)`，标签段 `.paper` 色块，溢出段 `var(--color-destructive)`；i18n `print.headFigure(labelMm, maxMm)` 作 `aria-label`
- [ ] T073 [US5] `web/src/features/print/print-dialog.tsx`：在打印机选择下方嵌入 `HeadFigure`；`capabilities === null` 时不渲染
- [ ] T074 [US5] 跑 T069–T070 转绿

**Checkpoint**: quickstart 第 3 步第 8 条通过。

---

## Phase 8: User Story 6 - 清理未保存的草稿 (Priority: P3)

### Tests（先写，确认红）

- [ ] T075 [P] [US6] 扩展 `web/tests/gallery.dom.test.tsx`：store 有 3 份未命名 + 2 份已保存标签的草稿 → 「清理未保存的草稿」可用，点击 → `AlertDialog` 列出 5 项名称 → 确认 → `store.list().entries` 为空、画廊无 `[data-unsaved]`、两张已保存标签仍在；取消 → 不变；store 为空 → 按钮 `disabled`

### Implementation

- [ ] T076 [P] [US6] i18n：`labels.clearDrafts`、`clearDraftsTitle`、`clearDraftsBody(n)`（含不可撤销说明）、`clearDraftsConfirm`
- [ ] T077 [US6] `web/src/features/drafts/clear-drafts-dialog.tsx`：`AlertDialog` 列清单，确认 → `store.clear()` + 使画廊查询失效
- [ ] T078 [US6] `web/src/pages/labels-page.tsx`：`PageHeader` 动作区加入按钮（无草稿时 `disabled`）
- [ ] T079 [US6] 跑 T075 转绿

**Checkpoint**: quickstart 第 3 步第 10 条通过。

---

## Phase 9: Polish & Cross-Cutting

- [ ] T080 [P] `docs/design-consensus.md` 新增 §6.3「005 阶段推翻的三处」：标签页模型（002 FR-010~013）、撤销栈不持久化、首页/模板库/标签设计三入口；各写"原决定 / 为什么推翻 / 新决定"
- [ ] T081 [P] `docs/README_zh.md`、`README.md`：导航八项、「标签」画廊、草稿在本机不跨设备、清理草稿入口；`CHANGELOG.md`（若无则创建）记为 MINOR：面向用户的导航变更
- [ ] T082 [P] `web/src/editor/undo.ts` 顶部注释、`web/src/app/workspace-state.ts` 顶部注释按新模型改写（不留"每个标签页保持挂载"的过时说明）
- [ ] T083 `npm run test:coverage`：确认 `features/drafts/*`、`head-figure.ts`、`thumbnail-values.ts`、`status-summary.ts` ≥ 80%，不足处补 Node 测试
- [ ] T084 按 `quickstart.md` 三步逐条手动验收（真实浏览器，Chromium），记录到 `specs/005-nocturne-web-redesign/checklists/acceptance.md`
- [ ] T085 提交前机密检查（`workflow.md`/`security.md`）；三步各自 `git commit`（`feat(web): …` 中文描述）；**推送需用户确认**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**：无依赖。
- **Phase 2 Foundational（草稿核心）**：依赖 T002；**US1 不依赖它**，Phase 2 与 Phase 3 可并行。
- **Phase 3 US1（第 1 步）**：依赖 T001、T003。
- **Phase 4 US2（第 2 步）**：依赖 Phase 2 全部 + Phase 3（编辑器提示用新令牌的 `Alert` 变体）。
- **Phase 5 US3（第 3 步主体）**：**必须在 Phase 4 完成并提交之后**（规格 Assumptions 的硬约束）。
- **Phase 6 US4**：依赖 Phase 5（另存入口在 `template-bar`，孤儿标注在画廊）。
- **Phase 7 US5**：只依赖 Phase 3（令牌）；可与 Phase 5/6 并行。
- **Phase 8 US6**：依赖 Phase 5（画廊页存在）。
- **Phase 9**：依赖全部。

### Within Each Story

- 测试任务先写、先红；同一文件的实现任务串行。
- T022（`index.css` 重写）是 US1 的中心，T023–T028 可并行但都在 T022 之后才能转绿。
- T057 → T058 → T060 串行（路由 → 状态 → App）；T050–T055 可并行且不依赖它们。

### Parallel Opportunities

- Phase 1 的 T001–T004 全部并行。
- Phase 2 的测试 T005–T009 并行；实现 T010–T014 并行，T015 之后。
- Phase 3 的测试 T017–T020 并行；实现 T023–T028 并行（T022 之后）。
- Phase 5 的纯逻辑 T050–T055 与路由/状态 T057–T058 可由两人并行。
- Phase 7 整个可与 Phase 5/6 并行。

---

## Parallel Example: Phase 2 + Phase 3 同时进行

```bash
# 一人做草稿核心（纯 Node）：
Task: "T005–T009 drafts 测试" → "T010–T014 schema/storage/trim/version/window-id" → "T015 store"
# 另一人做视觉：
Task: "T017–T020 令牌/字体/字重/纸 测试" → "T022 index.css" → "T023–T028 组件与壳层"
```

---

## Implementation Strategy

### 第 1 步（MVP：US1）

1. Phase 1 → Phase 3。
2. **停下验收**：quickstart 第 1 步；提交 `feat(web): 采用 Nocturne 视觉令牌`。

### 第 2 步（US2）

3. Phase 2 → Phase 4。
4. **停下验收**：quickstart 第 2 步；提交 `feat(web): 编辑器草稿持久化`。

### 第 3 步（US3–US6）

5. Phase 5 → Phase 6 → Phase 7 → Phase 8 → Phase 9。
6. **停下验收**：quickstart 第 3 步全部；提交 `feat(web): 去标签页栏，标签画廊即首页`（MINOR 版本）。

---

## Notes

- 所有中文文案经 `i18n/zh-CN.ts`；`en-US.ts` 同步，`i18n-completeness` 是门。
- 缩略图/画布/快照的白只通过 `.paper`；`design-tokens.test.ts` 会抓任何别处的白。
- 草稿 store 永不抛；任何"存不下"都要走到 UI 提示。
- 删除文件时同步删除其测试；被删测试里仍有价值的断言先迁走再删。
- 每个 Checkpoint 之后 `git commit`；推送前问用户。
