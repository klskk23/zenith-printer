# Implementation Plan: Nocturne 前端重构

**Branch**: `005-nocturne-web-redesign` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-nocturne-web-redesign/spec.md`

## Summary

把 Web 界面的视觉换成 Nocturne（深色、蓝紫强调只做线、圆角 4/8/14、描边按钮），唯一破例是标签纸的纯白与四周的微光；把信息架构从"标签页栏 + 首页 + 模板库 + 标签设计"收成"侧栏常驻 + 「标签」画廊即首页 + 点一张进整页编辑器"；用浏览器本机草稿（内容 + 撤销栈 ≤ 50）承担离开编辑器不丢东西的责任，并处理版本冲突；打印确认框加一张标签在打印头上的比例图。

技术路线：Nocturne 令牌映射进 Tailwind `@theme`，shadcn 组件靠变体呈现，不引入第二套类体系；缩略图用 `@zenith/shared` 的 `irToSvg` 在客户端渲染并代入数据源第一行；草稿走 `localStorage` + zod 校验 + 会报错的存储端口；`WorkspaceState` 从标签页集合收缩为单一活动页面。**不改服务器**。三步交付：令牌 → 草稿（标签页栏仍在）→ 去标签页栏。

## Technical Context

**Language/Version**: TypeScript 5.9（strict、`erasableSyntaxOnly`）；Node 26（服务端，本功能不触碰）

**Primary Dependencies**: React 19、Vite 7、Tailwind CSS 4（`@theme`）、shadcn/ui（Radix 原语 + `cva` + `cn()`）、@tanstack/react-query 5、`@zenith/shared`（`irToSvg`、`evaluateIr`、`labelIrSchema`、`dotsToMm`）、zod。**不新增 npm 依赖**；新增两个 Inter 子集 woff2 静态文件。

**Storage**: 浏览器 `localStorage`（草稿，键空间 `zenith.drafts.v1.*`）+ `sessionStorage`（窗口 id）。服务器 SQLite 不改。

**Testing**: Vitest 两个项目——`default`（纯 Node 逻辑）与 `web`（happy-dom + @testing-library/react）。新增逻辑模块进覆盖率 include。

**Target Platform**: 局域网内的桌面浏览器（Chromium/Firefox 近两年版本）；不为触屏与手机适配。

**Project Type**: Web 应用前端（`packages/web`），单进程部署里的静态资源。

**Performance Goals**: 画廊在 50 张标签、每张 ≤ 20 个元素时首帧 < 100 ms（纸的轮廓先出，SVG 内容随后）；草稿写入不阻塞输入（300 ms 防抖，单次序列化 ≤ 250 KB）。

**Constraints**: 宪章「UI 组件规范」——不得引入独立主题系统；每个可导航页面必须有渲染断言；测试离线确定；字体随包、无 CDN；服务无鉴权（草稿只能在本机）。

**Scale/Scope**: 8 个可导航页面（标签、数据源、打印机、队列、历史、打印预设、接口调试、设置）+ 1 个编辑器 + 2 个数据源内页；约 22 处文案改写；删除 `tab-bar.tsx`、`index-page.tsx`、`templates-page.tsx`，新增 `pages/labels-page.tsx`、`features/drafts/*`、`app/status-strip.tsx`、`features/print/head-figure.ts(x)`。

> **修订（2026-09-21）**：草稿体系（research R3/R4/R11、Phase 2/4/6/8）在用户看过实物后撤销，
> 改为"退出即放弃、最后保存为准"；壳层对齐预览方案 A（品牌进侧栏、图标、打印机状态在侧栏底部），
> 接口调试从侧栏移到设置。见 spec.md「Session 2026-09-21（修订）」与 tasks.md Phase 10。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 条款 | 门槛 | 本计划如何满足 | 状态 |
|---|---|---|---|
| I 代码质量 | `tsc` + ESLint 零错误；无 `any`；函数 ≤ 50 行 | 每步提交前跑 `typecheck && lint`；草稿 store 拆成 read/write/trim/index 四个小函数；`labels-page.tsx` 把画廊格抽成 `GalleryTile` | ✅ |
| II 测试先行 | 红-绿-重构；缺陷需回归测试 | 每个任务先写测试（tasks.md 里测试任务先于实现任务）；R12 列出逻辑/界面划分 | ✅ |
| II 界面渲染 | **每个可导航页面一条渲染断言** | `render-smoke.dom.test.tsx` 重写为八页 + 编辑器 + 两个数据源内页，逐入口点击后断言不抛；删除首页/模板库后补负向断言（侧栏里不再有它们） | ✅ 见下表 |
| II 逻辑/界面分离 | 纯逻辑不靠渲染组件测 | `drafts/store,trim,version.ts`、`thumbnail-values.ts`、`head-figure.ts`、`status-summary.ts` 全部 Node 测试；进覆盖率 include | ✅ |
| II 覆盖率 ≥ 80% | 核心逻辑 | 上述模块加入 `vitest.config.ts` include | ✅ |
| II 确定性 | 无真实时钟/随机/网络 | `createDraftStore(storage, clock, windowId)` 三者注入；缩略图值测试用假 fetch | ✅ |
| III.0 术语统一 | 同一概念一个名字 | 实体统一「标签」（Clarify Q1）；`terminology.test.ts` 锁住「模板」不复现；接口字段 `template*` 不改（避免破坏性变更） | ✅ |
| III.0 错误三要素 | 什么/为什么/下一步 | 草稿写入失败、版本过期、原标签已删除三条文案都按三要素写 | ✅ |
| III.0 不可逆需确认 | 打印、清除 | 「清理未保存的草稿」先列清单再确认；打印确认框保留 | ✅ |
| III.0 行为变更即破坏性 | 版本规则 | 去标签页栏与首页是面向用户的行为变更 → 第 3 步作为 MINOR 版本发布并在 CHANGELOG/README 说明。**MINOR 的前提是对外地址契约不变**：`/design/:id?preset=` 与 `/templates` 继续可达并跳转到新地址（T057），`docs/nexus-assets.md` 不改。若不做兼容即为 MAJOR | ✅ |
| IV 语言 | 文案经 i18n；代码英文 | 全部新文案进 `zh-CN.ts`/`en-US.ts`；`i18n-completeness` 测试保证两边齐 | ✅ |
| V 可观测 | 失败可追溯 | 草稿写入失败在 UI 显式提示（前端无结构化日志基础设施，不新建） | ✅ |
| 技术栈锁定 | 不偏离 | 无新依赖；SVG DOM；shadcn 优先 | ✅ |
| **UI 组件规范** | **不得引入独立主题/全局 CSS 体系** | Nocturne 只以令牌进入 `@theme`；不 import 其 `styles.css`；删除 `[data-classical-*]` 层 | ✅ |
| UI 自建组件说明 | 说明 shadcn 缺什么 | 见「Complexity Tracking」下方的自建组件表 | ✅ |
| 渲染确定性 | 打包字体 | Inter 随包；不进渲染字体集 | ✅ |
| 设计共识优先 | 冲突须先修订该文档 | 规格 002 的标签页模型被推翻 → `docs/design-consensus.md` 新增 §6.3 | ✅（任务里落实） |

**渲染断言清单**（Principle II「界面渲染测试」）：

| 页面 | 断言 |
|---|---|
| 标签（画廊，`/`） | 挂载不抛；空状态与有数据两种 |
| 标签编辑器（`/labels/:id`、`/labels/new/:draftId`） | 挂载不抛；带 `?preset=` 不抛 |
| 数据源 / 数据源内页 | 挂载不抛（既有，保留） |
| 打印机 | 既有，保留 |
| 队列 | 既有，保留 |
| 历史 | 既有，保留 |
| 打印预设 | 既有，保留 |
| 接口调试 | 既有，保留（懒加载 swagger） |
| 设置 | 既有，保留 + 无主题选项（既有） |
| 负向 | 侧栏里没有「首页」「模板库」「标签设计」；DOM 里没有标签页栏 |

## Project Structure

### Documentation (this feature)

```text
specs/005-nocturne-web-redesign/
├── plan.md              # 本文件
├── research.md          # R1–R12
├── data-model.md        # Draft / DraftIndex / GalleryItem / StatusSummary / HeadFigure
├── quickstart.md        # 三步各自的验收步骤
├── contracts/
│   ├── draft-store.md   # 本机草稿存储契约
│   └── visual-tokens.md # Nocturne → @theme 映射与"唯一的白"
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks 生成
```

### Source Code (repository root)

```text
packages/web/
├── public/fonts/subset/
│   ├── Inter-Regular.woff2            # 新增（第 1 步）
│   └── Inter-Medium.woff2             # 新增
├── src/
│   ├── index.css                      # 重写：Nocturne @theme、.paper、淡出分隔线；删 classical 层
│   ├── fonts.css                      # 加 Inter @font-face；保留 Serif（渲染字体）
│   ├── App.tsx                        # 第 3 步：只渲染活动页面；去 TabBar
│   ├── app/
│   │   ├── routes.ts                  # 第 3 步：'labels' / 'label' 取代 index/templates/design
│   │   ├── workspace-state.ts         # 第 2 步：+draftId；第 3 步：收缩为单页
│   │   ├── workspace.tsx              # 第 3 步：open() 前冲刷草稿
│   │   ├── sidebar.tsx                # 第 1 步：Nocturne 形态；第 3 步：八项
│   │   ├── status-bar.tsx             # 第 1 步：调色
│   │   ├── status-summary.ts          # 新增（第 3 步）：纯逻辑
│   │   ├── status-strip.tsx           # 新增（第 3 步）
│   │   └── tab-bar.tsx                # 第 2 步：改确认文案；第 3 步：删除
│   ├── components/
│   │   ├── page-header.tsx            # 第 1 步：去衬线、500 字重
│   │   └── ui/                        # 第 1 步：button/card/input/separator/table/dialog 变体调整
│   ├── editor/
│   │   ├── editor-page.tsx            # 第 2 步：useDraft 接入；第 3 步：conflict 警告、另存为新
│   │   ├── canvas.tsx                 # 第 1 步：[data-label-canvas] → .paper.paper-lg
│   │   └── undo.ts                    # 不改（trim 在 drafts/ 里）
│   ├── features/
│   │   ├── drafts/                    # 新增（第 2 步）
│   │   │   ├── schema.ts              # zod
│   │   │   ├── storage.ts             # DraftStorage：localStorage 实现 + 内存实现
│   │   │   ├── store.ts               # createDraftStore
│   │   │   ├── trim.ts                # 撤销栈裁剪/降级
│   │   │   ├── version.ts             # 基线比较、另一窗口判定
│   │   │   ├── window-id.ts           # sessionStorage
│   │   │   ├── use-draft.ts           # React hook：读/防抖写/冲刷
│   │   │   └── clear-drafts-dialog.tsx# 第 3 步
│   │   ├── templates/
│   │   │   ├── thumbnail-box.ts       # 不改
│   │   │   ├── thumbnail-values.ts    # 新增（第 3 步）：第一行 → values
│   │   │   ├── thumbnail-svg.tsx      # 新增（第 3 步）：irToSvg → <img data:>
│   │   │   ├── thumbnail-frame.tsx    # 第 1 步：bg-white → .paper
│   │   │   ├── template-bar.tsx       # 第 3 步：409 旁的「另存为新标签」
│   │   │   └── hooks.ts               # +useFirstRow(dataSourceId)
│   │   └── print/
│   │       ├── head-figure.ts         # 新增（第 3 步）：纯函数
│   │       ├── head-figure.tsx        # 新增：内联 SVG
│   │       └── print-dialog.tsx       # 第 3 步：嵌入 HeadFigure
│   ├── pages/
│   │   ├── labels-page.tsx            # 新增（第 3 步）：画廊 + 状态带
│   │   ├── index-page.tsx             # 第 3 步：删除
│   │   ├── templates-page.tsx         # 第 3 步：删除
│   │   └── consumable.ts              # 不改，被 status-summary 复用
│   └── i18n/{zh-CN,en-US}.ts          # 第 1 步：字体/主题相关；第 2 步：草稿文案；第 3 步：术语清扫
└── tests/
    ├── design-tokens.test.ts          # 第 1 步：重写
    ├── fonts.test.ts                  # 新增（第 1 步）
    ├── render-smoke.dom.test.tsx      # 第 1 步：调色后仍绿；第 3 步：八页重写
    ├── classical-shell.dom.test.tsx   # 第 1 步：删除（Classical 壳不复存在）
    ├── drafts/*.test.ts               # 新增（第 2 步）
    ├── editor-draft.dom.test.tsx      # 新增（第 2 步）
    ├── tab-close-copy.dom.test.tsx    # 新增（第 2 步）；第 3 步删除
    ├── gallery.dom.test.tsx           # 新增（第 3 步）
    ├── status-strip.dom.test.tsx      # 新增（第 3 步）
    ├── head-figure.test.ts / print-head-figure.dom.test.tsx   # 新增（第 3 步）
    ├── conflict.dom.test.tsx          # 新增（第 3 步）
    ├── terminology.test.ts            # 新增（第 3 步）
    ├── thumbnail-values.test.ts       # 新增（第 3 步）
    ├── status-summary.test.ts         # 新增（第 3 步）
    └── {workspace,routes}.test.ts     # 第 3 步：按单页模型重写；untitled-design-tabs / tab-middle-click 删除

docs/design-consensus.md               # 第 3 步：+§6.3
vitest.config.ts                       # 第 2/3 步：覆盖率 include 加新逻辑模块
```

**Structure Decision**: 沿用 `packages/web` 既有的 `app/ · components/ · editor/ · features/<域>/ · pages/` 分层。草稿是一个新的域，放 `features/drafts/`；状态带属于壳层，放 `app/`；画廊是页面，放 `pages/labels-page.tsx` 而画廊格与缩略图属于 `features/templates/`（目录名保留 `templates`，与接口字段一致——只有用户面前的词改了）。

## Complexity Tracking

> 无宪章违背需要论证。下面两张表记录的是宪章要求"说明"的事项。

**自建组件（宪章 UI 组件规范：说明 shadcn/ui 中不存在何种替代）**

| 组件 | shadcn/ui 中缺什么 | 如何复用令牌 |
|---|---|---|
| `.paper` / `ThumbnailSvg` | 没有"按物理比例的纸张"这种东西 | 只用 `#ffffff`（契约允许的唯一处）+ `--color-neutral-*` 做光晕；容器尺寸来自 `thumbnailBoxPx` |
| `GalleryTile` | `Card` 是等高卡片，画廊格的高度由纸的比例决定 | `cn()` + `--radius-md` + `--color-border`；hover 用 `--color-accent` 12% |
| `StatusStrip` | 无"状态带" | `Badge` + `Separator` 组合，文字走 `text-muted-foreground` |
| `HeadFigure` | 无比例图 | 内联 SVG，`stroke="var(--color-primary)"`、溢出段 `var(--color-destructive)` |
| `Separator fade` | shadcn Separator 是实线 | 给既有 `separator.tsx` 加一个 `fade` 变体，不另起组件 |

**被推翻的既有决定（宪章：与设计共识/既有规格冲突须书面记录）**

| 被推翻 | 出处 | 替代 | 记录位置 |
|---|---|---|---|
| 功能以标签页形式打开；多开；切换保留状态；关闭确认 | 规格 002 FR-010~013 | 单一活动页面 + 本机草稿 | `docs/design-consensus.md` §6.3 |
| 撤销栈随标签页存在、不持久化 | 规格 002 Clarification；`undo.ts` 注释 "Not persisted (FR-088)" | 撤销栈进草稿，≤ 50 步 | 同上 + `undo.ts` 注释更新 |
| 首页、模板库、标签设计三个入口 | 规格 002 | 「标签」一个入口 | 同上 |
| 浅色「衬纸」令牌与衬线标题（本会话未提交的工作） | 工作区 | Nocturne | 第 1 步直接覆盖 |
