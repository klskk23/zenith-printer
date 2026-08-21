# Implementation Plan: 前端工作区与标签编辑器重构

**Branch**: `002-web-workspace-editor` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-web-workspace-editor/spec.md`

---

## Summary

把当前"两个顶部按钮切换两个页面"的前端，重构为 IDE 式多标签工作区：
顶部状态栏 + 可关闭的标签栏 + 七项侧边栏，标签页集合为应用状态、地址栏只投影当前激活项。
编辑器补齐直角旋转、等比缩放、双轴标尺、缩放、网格吸附、图层置顶置底、右键菜单、
撤销重做、多行文本与椭圆元素。设备物理偏移从 Profile 迁往打印机，
Profile 改为承载纸张尺寸与四边边距。设置页提供本地偏好与中英双语。

同时修复三处现有缺陷：**二维码被渲染成一维条码**（硬伤，当前二维码功能完全不可用）、
条码 `widthMm` 在渲染时被忽略、模块宽度的偶数限制不成立。

技术路径的核心判断：**标签 IR 与共享渲染管线是本次改动的中心**。
新增椭圆、多行文本、条码/二维码模块宽度都要落到 `@zenith/shared`，
前端 DOM 渲染与后端 resvg 渲染共用同一份 `ir-to-svg` —— 这条既有的一致性保证
必须在本次扩展后依然成立，因此所有新元素与新属性都以「两端读同一份实现」为前提设计。

---

## Technical Context

**Language/Version**: TypeScript 5.9（严格模式，`erasableSyntaxOnly`），Node.js ≥ 26（`--experimental-strip-types`）

**Primary Dependencies**:
既有 —— Fastify 5、zod 4、`node:sqlite`、`@resvg/resvg-js`、`bwip-js`、`sharp`、
`@mmote/niimbluelib`；Vite 7 + React 19 + Tailwind 4 + shadcn/ui + TanStack Query 5。
**新增 —— `react-router-dom`**（宪章偏离，见 Constitution Check 与 research.md R7）。
新增 shadcn/ui 组件：`tabs` `context-menu` `alert-dialog` `badge` `switch` `slider`
`scroll-area` `tooltip` `dropdown-menu`（均为 shadcn/ui 既有组件，非第三方引入）。

**Storage**: SQLite（`node:sqlite`）。本功能涉及 schema 变更：
打印机新增偏移字段、Profile 新增纸张尺寸与四边边距并移除偏移字段、模板新增版本字段。

**Testing**: Vitest。默认套件 **MUST** 可在无物理打印机的情况下运行（宪章原则 II）。
渲染类改动以逐像素哈希比对验证；迁移以「迁移前后全量模板渲染哈希一致」验证。

**Target Platform**: 局域网内单机部署，单进程；浏览器端为现代桌面浏览器。

**Project Type**: Web 应用（前后端同仓，npm workspaces 四包）

**Performance Goals**:
同时打开 10 个设计标签页时元素拖动无可感知延迟（SC-014）；
编辑器预览与实际打印的元素位置偏差 ≤ 1 dot（SC-009）。

**Constraints**:
- 未激活标签页 **MUST** 保持挂载（FR-024），因此内存随标签页数线性增长——
  这正是软上限 10 个（FR-083）的由来。
- 编辑器 **MUST NOT** 改用 canvas（宪章锁定 SVG DOM）。
- 尺寸 **MUST** 以 mm 存储，元素坐标 **MUST** 基于画布的整数 dot 网格计算。

**Scale/Scope**:
7 个功能页、约 10 个新增 shadcn 组件、2 个新增 IR 元素能力（椭圆、多行文本）、
3 处数据模型变更、1 次数据迁移、91 条功能需求。

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 门槛 | 评估 | 结论 |
|---|---|---|---|
| **I. 代码质量优先** | 严格类型、零 Lint 错误、显式错误处理 | 沿用既有配置；新增的越界与并发冲突均以显式错误类型表达 | ✅ 通过 |
| **II. 测试标准（不可协商）** | 测试先行；默认套件可脱离物理打印机 | 全部新增能力（渲染、几何、撤销、迁移、并发）均可离线测试；4 项需实机验证的已列入 research.md 待实测清单，不进默认套件 | ✅ 通过 |
| **III.0 共通** | 术语统一、错误三要素 | 侧边栏命名统一（spec §1）；并发冲突与批次拒绝均按 what/why/next 三要素表达 | ✅ 通过 |
| **III.A Web/REST** | camelCase、状态码稳定、长任务非阻塞 | 新增字段沿用 camelCase；并发冲突使用 409；越界不产生失败码（仅警告）；打印仍走既有队列 | ✅ 通过 |
| **III.B CLI** | kebab-case、`--json`、退出码 | 本功能不新增 CLI 命令；校正页打印复用既有 CLI 的确认规则 | ✅ 通过 |
| **IV. 语言与本地化** | 文案经 I18N 层输出，不硬编码 | FR-075 直接对应；本功能扩展为中英双语双层 i18n | ✅ 通过 |
| **V. 可观测性** | 结构化日志 | 迁移过程与被丢弃的偏移值记入结构化日志（FR-077） | ✅ 通过 |
| **技术栈（锁定）** | 偏离须论证 | **新增 `react-router-dom`** | ⚠️ 见下方 Complexity Tracking |
| **UI 组件规范** | 优先 shadcn/ui，自建须说明 | 所需交互组件 shadcn/ui 全部覆盖；自建仅限画布/标尺/图层面板/属性面板等领域构件 | ✅ 通过（PR 须说明） |
| **渲染确定性** | 打包字体 + `loadSystemFonts: false` | 不改动字体配置；多行文本已实测三种写法逐像素一致 | ✅ 通过 |
| **单位约定** | mm 存储，基于整数 dot 网格 | 网格吸附与行距计算均基于画布 dot 网格 | ✅ 通过 |
| **质量门槛** | 类型/Lint/测试/覆盖率 ≥ 80% | 沿用 CI 配置 | ✅ 通过 |

**Post-Phase-1 复查**: Phase 1 设计未引入新的偏离项。
数据模型变更全部落在既有 SQLite 与 IR schema 内，未新增存储技术；
契约变更全部沿用既有 REST 风格与错误结构。**门槛维持通过。**

---

## Project Structure

### Documentation (this feature)

```text
specs/002-web-workspace-editor/
├── plan.md              # 本文件
├── spec.md              # 功能规格（91 条 FR）
├── research.md          # Phase 0：13 项技术决策 + 待实测清单
├── data-model.md        # Phase 1：实体与迁移
├── quickstart.md        # Phase 1：本地验证步骤
├── contracts/           # Phase 1：接口契约
│   ├── ir-schema.md         # IR 变更（椭圆、多行文本、模块宽度）
│   ├── rest-api.md          # REST 变更（偏移、Profile、模板版本）
│   └── ui-contract.md       # 界面行为契约（标签页、路由、撤销、吸附）
├── checklists/
│   └── requirements.md  # 规格质量检查清单（16/16）
└── tasks.md             # Phase 2 输出（由 /speckit.tasks 生成，本命令不创建）
```

### Source Code (repository root)

```text
packages/
├── shared/src/
│   ├── ir/schema.ts              # 变更：新增 ellipse；text 多行；barcode/qrcode 模块宽度
│   ├── ir-to-svg/index.ts        # 变更：修复 qrcode；多行 tspan；模块宽度改元素属性
│   ├── barcode/index.ts          # 变更：放宽偶数限制；新增 qrcode bcid
│   ├── geometry/                 # 新增：旋转包围盒（前后端共用）
│   └── units.ts                  # 不变：dot 网格换算的唯一实现
│
├── server/src/
│   ├── domain/                   # 变更：printer 偏移、profile 纸张与边距、template 版本
│   ├── db/migrations/            # 新增：偏移迁移 + schema 变更
│   ├── routes/                   # 变更：偏移端点、Profile 字段、模板版本冲突、校正页
│   ├── render/                   # 变更：校正页生成
│   └── i18n/{zh-CN,en-US}.ts     # 新增 en-US；错误文案按 Accept-Language 选择
│
├── web/src/
│   ├── app/                      # 新增：工作区外壳（状态栏、标签栏、侧边栏、路由）
│   │   ├── workspace.tsx             # 标签页集合状态；全部保持挂载
│   │   ├── router.tsx                # 只决定激活项，不决定挂载
│   │   └── sidebar.tsx
│   ├── pages/                    # 新增：index / templates / queue / history / settings
│   ├── editor/
│   │   ├── canvas.tsx            # 变更：缩放、旋转手柄、等比缩放
│   │   ├── ruler.tsx             # 新增：双轴标尺
│   │   ├── layers-panel.tsx      # 新增：图层面板
│   │   ├── guards.ts             # 变更：boundsOf 支持旋转
│   │   ├── undo.ts               # 新增：按标签页的快照栈
│   │   └── snapping.ts           # 新增：dot 网格吸附
│   ├── features/printers/        # 变更：偏移校正 UI、校正页入口
│   ├── features/profiles/        # 变更：纸张尺寸与四边边距
│   └── i18n/{zh-CN,en-US}.ts     # 新增 en-US；语言偏好存本地
│
└── cli/                          # 本功能不改动
```

**Structure Decision**: 沿用既有的 npm workspaces 四包结构，不新增包。

关键放置决策：**旋转包围盒放进 `@zenith/shared/geometry` 而非前端**。
理由是越界判定在两处发生——编辑器实时提示（FR-036）与打印前逐张校验（FR-069）——
若两处各写一份，必然出现"编辑器说没问题、打印时说超界"的分歧。
这与 `ir-to-svg` 前后端共用是同一条原则。

---

## Complexity Tracking

> 仅在 Constitution Check 存在需要论证的偏离时填写

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 新增依赖 `react-router-dom`（不在宪章锁定技术栈表中） | FR-020 – FR-023 要求可分享的深链与刷新恢复，需要地址栏与应用状态双向同步 | 自建 History API 极小路由技术上可行且更贴合本模型（路由职责极少，仅决定激活项），但**使用者已明确选择 React Router**。按宪章「UI 组件规范」同一条规则，实现时的 PR 须说明引入理由 |
| 标签页全部保持挂载，内存随数量线性增长 | FR-024 明确要求未激活标签页保持编辑状态；卸载会丢失选中、缩放与撤销历史（违反 FR-012） | 「若干分钟后卸载并保留内容摘要」在澄清阶段作为选项 D 被使用者否决，因其与 FR-024 直接冲突。改以软上限 10 个（FR-083）把代价显式告知使用者 |

---

## 实施顺序

规格的用户故事优先级即建议的交付顺序，各阶段可独立验证：

| 阶段 | 内容 | 依赖 | 可独立验证 |
|---|---|---|---|
| P1 | 三处渲染缺陷修复（US1） | 无 | 是，纯渲染层，离线可验 |
| P2 | 工作区外壳 + 路由 + 首页（US2） | 无 | 是，不需打印机 |
| P3 | 编辑器交互增强（US3） | P2 的标签页容器 | 是 |
| P4 | 偏移校正 + 纸张 Profile（US4） | P3 的画布尺寸联动 | 部分需实机 |
| P5 | 偏好与双语（US5） | P2 的设置页容器 | 是 |

**P1 排在最前**是有意的：二维码当前完全不可用，且预览与打印一致地错——
用户察觉不到，每打一张废一张。它不依赖任何界面改造，应尽早交付。

数据迁移（FR-076 – FR-078）与其测试**一并在 P4 执行**（tasks.md T084 – T086、T095）。

注意断言的边界：「迁移前后全量模板渲染哈希一致」**必须排除含二维码的模板**——
P1 修复二维码必然改变其渲染结果，那是预期的修复而非回归。
这条已写入 T086 的任务描述本身，而不只写在风险提示里。
