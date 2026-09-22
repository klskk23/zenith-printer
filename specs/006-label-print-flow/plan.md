# Implementation Plan: 标签工作流与说明文字清理

**Branch**: `006-label-print-flow` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-label-print-flow/spec.md`

## Summary

两条主线，共用一次前端改造：

1. **四步工作流**。标签的四件事各占一步——画廊、设计、打印、确认——由一条常驻步条标位置（步条不设返回箭头，第 ① 步就是出口）。打印确认对话框拆成两页：「打印」做选择、铺满整页，「确认」把要打的那张画出来、可展开逐张看。常驻消耗警示与打印头示意图去掉；裁切风险只在真会发生时说一行。
2. **说明文字三档清理**。原理性常驻说明删除，操作说明收进「?」，错误与不可撤销确认原位保留。规则写进 `.agents/rules/ux-and-api.md`。

服务端一行不动。「打印」与「确认」用的全是既有端点：`POST /print-jobs`（带幂等键）、`POST /print-jobs/preflight`（逐行裁切判断）、`GET /printers`、`GET /printers/:id/profiles`、`GET /data-sources`、`GET /data-sources/:id/rows`。

## Technical Context

**Language/Version**: TypeScript 5（strict），Node 22，ESM

**Primary Dependencies**: React 19 + Vite + Tailwind CSS v4 + shadcn/ui（Radix）。新增一个依赖：`@radix-ui/react-tooltip`（「?」的悬停形态；shadcn Tooltip 的底座）

**Storage**: 不涉及。行的勾选、打印机与参数的选择都是内存态

**Testing**: vitest 双项目（Node 逻辑 + happy-dom 界面），`npm test` 跑两个；Playwright 用于人工核对渲染

**Target Platform**: 局域网内的桌面浏览器，深色单配色

**Project Type**: 单仓多包（cli / server / shared / web），单进程部署

**Performance Goals**: 「打印」页的行表沿用服务端分页（每页 10 行），总行数增长不改变请求大小；步条与合计的重算在一帧内完成

**Constraints**: 不新增端点、不改字段；不引入第二套样式体系（Nocturne 只经 `@theme` 令牌）；不引入认证；纯白只给纸

**Scale/Scope**: 新增 2 个可导航页面（打印、确认）+ 1 条步条 + 1 个标签渲染组件；删除 1 个对话框与 2 个它专属的组件；清理约 20 处文案

## Constitution Check

`.specify/memory/constitution.md` v1.5.0 的五条原则逐条对照：

| 原则 | 本功能怎么满足 |
|---|---|
| I 代码质量优先 | 纯逻辑（步骤可达性、合计、裁切摘要、文案档位清单）抽成无组件模块；「打印」「确认」两页各自是组件，状态仍由标签会话单点持有，不复制 |
| II 测试标准不可协商 | 红—绿—重构逐条执行：先写会失败的测试再实现。每个可导航页面保留渲染断言；四步各有独立测试；删掉的对话框测试改写为新页面的测试而非直接删掉 |
| III 用户体验一致性 | 术语沿用「标签/数据源/打印参数」；错误仍是三段（发生了什么、为什么、下一步）；「?」是同一个组件，两种形态外观区分 |
| IV 语言与本地化 | 文案全部经 i18n；键名英文，中文为目标语言，英文同步；提交信息 `<type>(<scope>): <中文>` |
| V 可观测性与可诊断 | 不新增服务端行为，故无新日志；前端的失败路径（预检失败、提交失败、预设失效）都有可见说明与稳定的 `data-*` 钩子供测试定位 |

**偏离**：无。唯一的新增依赖 `@radix-ui/react-tooltip` 属于 shadcn/ui 体系内（架构规则要求优先 shadcn/ui），不是第二套样式体系。

## Project Structure

### Documentation (this feature)

```text
specs/006-label-print-flow/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── tasks.md
├── contracts/
│   ├── flow-routes.md      # 四步的地址、旧地址改写、可达性
│   └── hint-tiers.md       # 文案三档的逐条清单
└── checklists/
    ├── requirements.md
    └── acceptance.md
```

### Source Code (repository root)

```text
packages/web/src/
├── app/
│   ├── routes.ts              # 改：新增 label-print / label-confirm 两种 page kind 与地址
│   ├── step-bar.tsx           # 新：四步步条（无返回控件，① 即出口）
│   ├── workspace.tsx          # 改：离开整条流程才问未保存（步与步之间不问）
│   └── sidebar.tsx            # 不动
├── editor/
│   └── editor-page.tsx        # 改：成为「标签会话」，按 step 渲染三种主体之一
├── features/print/
│   ├── flow.ts                # 新：纯逻辑——步骤可达性、合计、裁切摘要、阻塞原因
│   ├── print-step.tsx         # 新：第 ③ 步主体
│   ├── confirm-step.tsx       # 新：第 ④ 步主体
│   ├── row-selection.tsx      # 沿用
│   ├── selection.ts           # 沿用
│   ├── print-dialog.tsx       # 删
│   ├── label-preview.tsx      # 新：「确认」页的标签渲染，可展开逐张看
│   ├── use-label-preview.ts   # 沿用（从 005 的 preview.tsx 拆出的那只钩子）
│   ├── head-figure.ts/.tsx    # 删（FR-040）
│   └── overflow-notice.tsx    # 删（改为「确认」页一行）
├── components/ui/
│   ├── tooltip.tsx            # 新：shadcn Tooltip
│   └── hint.tsx               # 新：<Hint>（悬停/聚焦）与 <ValueHint>（点开 + 复制）
├── pages/labels-page.tsx      # 改：去标题、队列并入页头、瓦片加「打印」
└── i18n/{zh-CN,en-US}.ts      # 改：三档清理 + 新增步条/打印页/确认页文案
```

**Structure Decision**: 沿用既有布局，不新建包。「标签会话」继续由 `editor/editor-page.tsx` 持有，因为标签内容（IR 与撤销栈）、打印机、打印参数、预设的应用都已经在它手里；把状态搬到新的 provider 会让三页之间的往返（FR-025）多一层无谓的风险。步的主体各自成文件，会话只负责选谁上场。

## 关键设计决定

### 一、三页共用一个会话，`step` 决定渲染谁

`/labels/:id`、`/labels/:id/print`、`/labels/:id/confirm` 解析成三种 page kind，但在 `App.tsx` 里都交给同一个 `<EditorPage key="label" step=…>`：React 元素的 `key` 不变，组件不卸载，所以 IR、撤销栈、打印机与参数的选择、行的勾选在三步之间天然保留（FR-025）。步与步之间不触发未保存询问；询问只发生在离开 `label*` 这三种 kind 时（FR-026）。

### 二、行的勾选与份数上移到会话

现在 `selection` 与 `copies` 在对话框内部，随对话框一起消失。改为会话持有：「打印」页读写它们，「确认」页只读，提交成功后清空勾选（FR-056 的「再打一次」靠这个）。

### 三、幂等键的生命周期

对话框为「每次打开」铸一个键。新结构里改为**每次进入「确认」页**铸一个：重试沿用同一个键（FR-059），而回到「打印」页改了选择再来，就是另一批，换新键。

### 四、裁切风险分两处说，因为它有两种来源

`POST /print-jobs/preflight` 只检查这张**设计**本身（服务端传的行索引恒为 0），所以「确认」页那行红字只说超出多少毫米，不声称有几张受影响。**哪几张**由展开的逐张渲染回答：每张预览的响应头带 `X-Clipped`，被裁的那张自己标红。两者合起来才是完整答案；预检失败与渲染失败都不阻止提交。

### 五、「?」两种形态，一个概念

`<Hint>` 包一个 `?` 按钮与 Radix Tooltip：悬停、键盘聚焦都显示，触屏上点击也显示（Radix Tooltip 的 `onClick` 打开）。`<ValueHint>` 用既有的 Popover：点击打开，内容可选中，带一个「复制」按钮（`navigator.clipboard` 不可用时退化为选中文本 + 说明）。两者外观都是 16px 的圆形 `?`，`ValueHint` 的边比 `Hint` 实一点，提示它点得开。

### 六、文案清理是一张清单，不是一次搜索替换

`contracts/hint-tiers.md` 逐条列出：键名、现在在哪、判为哪一档、去哪。实现时按清单改，测试按清单验。规则本身写进 `.agents/rules/ux-and-api.md`，这样下次加文案有依据。

## Complexity Tracking

| 复杂点 | 为什么必要 | 简化的做法为什么不行 |
|---|---|---|
| 三种 page kind 共用一个组件 | 三步之间要保留未保存的修改与勾选 | 三个独立页面各自加载模板：一进「打印」就丢掉未保存的修改，FR-024/025 不成立 |
| 会话持有 selection / copies | 「确认」页要读，「再打一次」要清 | 留在「打印」页内部：换步即丢，「确认」页无从得知打几张 |
| 每进「确认」铸一次幂等键 | 重试不能变成第二批 | 每次提交铸一次：双击就是两批标签 |

## 交付顺序

1. **底座**：routes、步条、会话按 step 渲染（此时「打印」「确认」是空页面）——可导航、可测
2. **US1 打印与确认**：两页主体、合计、提交、结果态；删对话框与三个专属组件
3. **US2 设计页衔接**：顶栏收成一条步条，撤销/重做进画布头部，底条保存/另存为/继续
4. **US3 裁切说明**：预检接入「确认」页一行
5. **US4 旧地址**：`?preset=` 落「打印」页，回归测试
6. **US5 文案三档**：Tooltip 与 Hint 组件、按清单清理、规则入 `.agents/rules`
7. **US6 画廊页头**：去标题、队列并入页头、瓦片加「打印」
8. **收尾**：文档（CHANGELOG、design-consensus §6.4、nexus-assets 第 110 行）、覆盖率、全量测试
