<!--
Sync Impact Report
==================
Version change: [模板未填充] → 1.0.0
Bump rationale: 首次批准（初始批准）。将模板占位符替换为具体条款，确立 5 条核心原则与治理规则。

Modified principles:
- [PRINCIPLE_1_NAME] → I. 代码质量优先（Code Quality First）
- [PRINCIPLE_2_NAME] → II. 测试标准（Testing Standards）（不可协商）
- [PRINCIPLE_3_NAME] → III. 用户体验一致性（UX Consistency）
- [PRINCIPLE_4_NAME] → IV. 语言与本地化规范（Language & Localization）
- [PRINCIPLE_5_NAME] → V. 可观测性与故障可诊断性（Observability & Diagnosability）

Added sections:
- 技术约束与质量门槛（原 [SECTION_2_NAME]）
- 开发工作流与评审流程（原 [SECTION_3_NAME]）

Removed sections: 无

Templates requiring updates:
- ✅ .specify/templates/plan-template.md —— "Constitution Check" 为动态占位，由 /speckit-plan 依据本文件填充，无需改动
- ✅ .specify/templates/spec-template.md —— "User Scenarios & Testing" 章节已满足原则 II/III，无需改动
- ✅ .specify/templates/tasks-template.md —— 已更新：测试任务由 "OPTIONAL" 改为受原则 II 约束的强制项
- ✅ .specify/templates/checklist-template.md —— 通用结构，无原则冲突
- ✅ CLAUDE.md —— 已追加语言规范与宪章引用（原则 IV）

Follow-up TODOs: 无

--- 修订 v1.1.0 (2026-08-20) ---
Version change: 1.0.0 → 1.1.0
Bump rationale: MINOR。新增「技术栈（锁定）」「UI 组件规范」两个小节，并扩展「其他约束」
（渲染确定性、单位约定）。为新增约束，未移除或重定义既有原则，故为 MINOR 而非 MAJOR。

Modified sections:
- 技术约束与质量门槛 —— 由一段散文式技术栈描述，扩展为锁定选型表 + UI 组件规范 + 其他约束

Added rules:
- 技术栈锁定表（Fastify / niimbluelib / ZSim / resvg-js / bwip-js / sharp / zod / SQLite /
  Vite+React+Tailwind+shadcn-ui / SVG DOM），偏离须在计划文档论证
- UI 组件 MUST 优先 shadcn/ui，无适用组件时方可自建，且须复用其设计令牌
- 渲染确定性：MUST 使用打包字体 + loadSystemFonts:false，MUST NOT 依赖系统 fontconfig
- 单位约定：mm 存储、round 取整、基于 dot 网格计算

Removed rules:
- 原「图像处理使用 sharp」的笼统表述 —— 收窄为「仅用于二值化与格式转换，MUST NOT 用它
  渲染 SVG 文字」（sharp→librsvg→fontconfig 链路破坏可复现性）
- 原「CLI 使用 commander」—— 本项目为 web 服务，非 CLI 工具，该条不再适用

Source: docs/design-consensus.md（九个架构分支的可行性共识）

Templates requiring updates (v1.1.0):
- ✅ 无模板需改动 —— 本次仅新增技术约束，未触及原则编号或任务分类

--- 修订 v1.2.0 (2026-08-20) ---
Version change: 1.1.0 → 1.2.0
Bump rationale: MINOR。原则 III 由单一列表重组为 III.0 共通 + III.A Web/REST + III.B CLI
三段式，并新增 REST 专属条款。原则编号与数量不变，无约束被移除（CLI 条款完整保留于
III.B），故为 MINOR 而非 MAJOR。

Modified principles:
- III. 用户体验一致性 —— 重组为三段式，明确 Web/REST 为主交付形态、CLI 为辅助形态

Added rules (III.A Web/REST):
- JSON 字段 camelCase；HTTP 状态码语义正确且同类失败恒定
- 错误响应统一结构：机器可读错误码 + 人类可读中文文案
- 长耗时操作 MUST 立即返回可轮询任务标识，MUST NOT 阻塞至物理动作完成
- 任务状态 MUST 暴露已完成份数，支持部分失败后精确补打

Added rules (III.0 共通):
- 设备错误 MUST 由错误码映射为可读文案，MUST NOT 透传数字
- 消耗耗材/不可撤销操作 MUST 显式确认，MUST NOT 由幂等重试触发

Retained (moved to III.B):
- kebab-case ⟷ camelCase 映射、--json 双格式、stdout/stderr 分流、退出码稳定

Templates requiring updates (v1.2.0):
- ✅ 无模板需改动 —— 原则编号未变，任务分类未受影响
-->

# Zenith Printer Constitution

## Core Principles

### I. 代码质量优先（Code Quality First）

代码是长期资产，可读性优先于聪明写法。

- 所有提交的 TypeScript 代码 **MUST** 通过 `tsc` 类型检查与 ESLint 检查，零错误、零新增警告。
- **MUST** 启用并遵守严格类型模式；禁止使用 `any` 逃逸类型系统，确需动态类型时 **MUST**
  使用 `unknown` 并配合显式收窄，或使用 zod 在边界处校验。
- 公共 API（导出的函数、类、CLI 命令、REST 端点）**MUST** 具备显式的参数与返回类型标注。
- 单个函数 **SHOULD** 控制在 50 行以内、圈复杂度不超过 10；超出时 **MUST** 在评审中说明理由。
- 重复逻辑出现第三次时 **MUST** 抽取复用；抽取前不得为"将来可能复用"预先泛化（YAGNI）。
- 错误 **MUST** 显式处理：禁止空 `catch` 块，禁止吞掉异常；无法处理的错误 **MUST** 向上抛出
  并携带上下文。

**理由**：本项目直接驱动物理硬件（热敏标签打印机），静默失败会造成耗材浪费与不可见的错误输出。
类型与静态检查是成本最低的第一道防线。

### II. 测试标准（Testing Standards）（不可协商）

测试先行，且测试必须能在无硬件环境下运行。

- 新功能与缺陷修复 **MUST** 遵循"先写测试 → 测试失败 → 再实现 → 测试通过"的红-绿-重构循环。
- 缺陷修复 **MUST** 附带一个能复现该缺陷的回归测试；该测试在修复前必须失败。
- 以下场景 **MUST** 具备集成测试：打印协议编解码、图像转换与抖动处理、设备连接生命周期
  （连接/断开/重连）、CLI 命令契约、REST 端点契约。
- 所有依赖打印机硬件的代码 **MUST** 通过接口注入传输层（transport），使测试可用 fake/mock 替换；
  默认测试套件 **MUST** 在无物理设备的情况下完整通过。
- 需要真实硬件的测试 **MUST** 单独标记并从默认套件中隔离，且 **MUST** 记录所用打印机型号。
- 核心逻辑（协议、图像处理、状态机）的行覆盖率 **MUST** 不低于 80%；覆盖率下降的 PR **MUST** 被拒绝。
- 测试 **MUST** 确定性：禁止依赖真实时钟、随机数或网络；时间与随机源 **MUST** 可注入。

**理由**：打印机固件差异大、真机验证慢且不可自动化。只有可脱机运行的确定性测试套件，
才能让 CI 真正成为质量门槛。

### III. 用户体验一致性（UX Consistency）

Web 界面、REST API、运维 CLI 与文档必须表现为同一个产品，而非几套独立工具。
**Web/REST 是本项目的主交付形态**；CLI 仅用于运维与硬件实测，是辅助形态。

#### III.0 共通条款（适用于所有交付形态）

- 术语 **MUST** 全局统一：同一概念在 UI 文案、API 字段、CLI 参数、日志与文档中使用同一个
  名称（例如密度统一为 `density`，不得在别处出现 `darkness`/`heat`）。
- 错误信息 **MUST** 包含三要素：发生了什么、可能的原因、下一步可执行的操作。禁止仅抛出
  原始堆栈或裸错误码。设备错误 **MUST** 由错误码映射为可读文案，**MUST NOT** 直接透传数字。
- 耗时超过 2 秒的操作 **MUST** 提供进度反馈。
- 消耗耗材或不可撤销的操作（打印、清除任务历史）**MUST** 要求显式确认，**MUST NOT** 由
  隐式或幂等重试触发。
- 任何面向用户的行为变更（字段/参数重命名、默认值变更、输出格式变更）**MUST** 视为破坏性
  变更，遵循本文件治理章节的版本规则。

#### III.A Web / REST（主交付形态）

- REST 的 JSON 字段 **MUST** 使用 camelCase。
- HTTP 状态码 **MUST** 语义正确且稳定：客户端输入错误用 4xx，服务端与设备故障用 5xx；
  同类失败 **MUST** 始终使用同一状态码。
- 错误响应 **MUST** 采用统一结构，同时包含机器可读的稳定错误码与人类可读的中文文案，
  **MUST NOT** 只返回一段自由文本。
- 可能长时间运行的操作（提交打印任务）**MUST** 立即返回可轮询的任务标识，**MUST NOT**
  阻塞请求直到物理动作完成。
- 任务状态 **MUST** 可通过轮询获知，且 **MUST** 暴露已完成份数，使部分失败的任务可被
  精确补打。

#### III.B CLI（运维与硬件实测，辅助形态）

- CLI 参数命名 **MUST** 使用 kebab-case，且与对应 REST 字段的 camelCase 保持一一对应的
  可预测映射（`--label-width` ⟷ `labelWidth`）。
- 所有输出 **MUST** 同时支持人类可读格式与 `--json` 机器可读格式。
- 正常结果 **MUST** 输出到 stdout，错误 **MUST** 输出到 stderr。
- 退出码 **MUST** 稳定且有文档：`0` 成功，非 `0` 表示失败且同类失败使用同一退出码。

**理由**：用户会在 Web 与脚本之间来回切换。术语和错误语义不一致会直接破坏用户已有的自动化。
拆分 A/B 两节是因为二者的约定天然不同（HTTP 状态码 vs 退出码、`Accept` vs `--json`），
硬套一套规则只会让两边都别扭；但共通条款必须统一，否则就成了两个产品。

### IV. 语言与本地化规范（Language & Localization）

- 面向人的沟通 —— 文档、README、规格说明、计划、任务、提交信息正文、议题与 PR 描述、
  代码评审意见、与 AI 助手的对话 —— **MUST** 使用中文。
- 面向机器与开发者的代码产物 —— 标识符、类型名、文件名、代码注释、日志消息、错误消息模板、
  测试用例名称、提交信息的 type/scope 前缀 —— **MUST** 使用英文。
- 唯一例外：I18N 本地化资源文件（如 `locales/zh-CN.json`）中的翻译文案 **MUST** 使用其目标
  语言；此类文件中的键名（key）仍 **MUST** 使用英文。
- 面向最终用户的可见文案 **MUST** 通过 I18N 层输出，**MUST NOT** 在代码中硬编码非英文字符串。

**理由**：中文降低团队沟通与决策成本；英文代码保证与上游依赖（niimbluelib、Node 生态）、
搜索引擎和未来贡献者的兼容性。二者分工明确才不会互相污染。

### V. 可观测性与故障可诊断性（Observability & Diagnosability）

硬件交互失败必须可以事后复盘，而不是让用户重现。

- **MUST** 采用结构化日志，并支持分级（`error`/`warn`/`info`/`debug`）与运行时级别控制。
- 与打印机之间的每一次协议收发 **MUST** 可在 `debug` 级别下记录为十六进制帧，用于协议排障。
- 日志与错误信息 **MUST NOT** 包含设备序列号、MAC 地址等标识信息之外的敏感数据；
  上述标识信息在 `info` 及以上级别 **MUST** 脱敏。
- 每个错误 **MUST** 可追溯到具体的操作与设备状态（型号、固件版本、连接方式）。
- 新增的外部依赖或原生模块 **MUST** 在文档中说明其安装前置条件（编译工具链、系统权限）。

**理由**：蓝牙/串口连接的失败模式高度依赖环境。没有可导出的协议日志，远程排障几乎不可能。

## 技术约束与质量门槛

### 技术栈（锁定）

全栈 **TypeScript（严格模式）**，前后端同仓，单进程部署。选型依据见
`docs/design-consensus.md`；偏离下表 **MUST** 在计划文档中论证。

| 层 | 选型 | 不可替换的理由 |
|---|---|---|
| 后端运行时 | Node.js + **Fastify** | `@mmote/niimbluelib` 是 TS 库，且 Fastify 的 schema 校验契合边界校验原则 |
| 打印协议（精臣） | **`@mmote/niimbluelib`** | 目前唯一支持 B3S_P 的开源实现，已实测验证 |
| 打印协议（霍尼韦尔） | **ZSim / ZPL II over raw TCP 9100** | 打印机原生支持，无需驱动 |
| 矢量渲染 | **`@resvg/resvg-js`** | `loadSystemFonts: false` + 打包字体，保证跨机器逐像素一致 |
| 条码生成 | **`bwip-js`** | 输出 SVG 片段，可直接内嵌 |
| 图像后处理 | **`sharp`** | 仅用于二值化与格式转换，**MUST NOT** 用它渲染 SVG 文字 |
| 运行时校验 | **`zod`** | |
| 持久化 | **SQLite** | |
| 前端 | **Vite + React + Tailwind CSS + shadcn/ui** | |
| 编辑器渲染 | **SVG DOM** | 与后端 resvg 同源，**MUST NOT** 改用 canvas |

### UI 组件规范

- 所有 UI 组件 **MUST** 优先使用 **shadcn/ui**。仅当 shadcn/ui 无适用组件时，才允许自建或
  引入第三方组件。
- 自建或引入第三方组件时 **MUST** 在 PR 描述中说明「shadcn/ui 中不存在何种替代」。
- 自建组件 **MUST** 复用 shadcn/ui 的设计令牌（Tailwind 主题变量、`cn()` 合并工具、
  Radix 无障碍原语），**MUST NOT** 另起一套样式体系。
- **MUST NOT** 为使用某个第三方组件而引入与 Tailwind 冲突的全局 CSS 或独立主题系统。

### 其他约束

- **边界校验**：所有外部输入（HTTP 请求体、CLI 参数、配置文件、设备返回帧）**MUST** 在进入
  业务逻辑前通过 zod schema 校验。
- **渲染确定性**：文字渲染 **MUST** 使用随项目打包的字体文件并禁用系统字体加载
  （`loadSystemFonts: false`）。**MUST NOT** 依赖系统 fontconfig——同一模板在任意机器上
  必须渲染出逐像素一致的结果。
- **单位约定**：坐标与尺寸 **MUST** 以 mm 存储，`dot = round(mm × dpi / 25.4)`，取整
  **MUST** 使用 `round`。画布尺寸先转为整数 dot，元素坐标 **MUST** 基于该 dot 网格计算，
  **MUST NOT** 逐元素独立从 mm 换算（误差会累积）。
- **硬件兼容性**：打印机型号相关的参数（DPI、打印头像素数、密度范围、纸张类型）**MUST** 从
  型号元数据读取，**MUST NOT** 硬编码。新增型号支持 **MUST** 记录实测结果与固件版本。
- **资源安全**：设备连接 **MUST** 具备确定性的释放路径（成功与失败路径均需释放）；
  并发访问同一设备 **MUST** 通过互斥保护。
- **质量门槛（CI 强制）**：类型检查通过、Lint 无错误、测试全绿、核心逻辑覆盖率 ≥ 80%。
  任一项失败即阻断合并，**MUST NOT** 以"后续修复"为由绕过。

## 开发工作流与评审流程

- 功能开发 **MUST** 遵循 Spec Kit 流程：`/speckit.specify` → `/speckit.plan` → `/speckit.tasks`
  → `/speckit.implement`，各阶段产物归档于 `specs/<###-feature-name>/`。
- 所有变更 **MUST** 在功能分支上进行，分支命名遵循 `###-feature-name`，**MUST NOT** 直接
  提交到主分支。
- `/speckit.plan` 生成的计划 **MUST** 包含"Constitution Check"章节，逐条核对本文件的五条原则；
  存在违背时 **MUST** 记录在"Complexity Tracking"表中并说明为何更简单的方案不可行。
- 代码评审 **MUST** 显式确认：类型与 Lint 通过、测试先行、术语一致、语言规范符合原则 IV。
  评审者发现违背原则的改动 **MUST** 要求修改或要求正式豁免记录。
- 提交信息 **MUST** 采用 Conventional Commits 格式：英文 type/scope 前缀 + 中文描述正文
  （例如 `feat(cli): 新增标签密度参数`）。

## Governance

本宪章优先于所有其他开发实践与惯例。当宪章与其他文档、模板或既有代码风格冲突时，以本宪章为准。

**修订程序**：

1. 任何修订 **MUST** 以 PR 形式提出，明确说明修改条款、动机与影响范围。
2. PR **MUST** 包含 Sync Impact Report，列出需要同步更新的模板与文档。
3. 修订合并后 **MUST** 同步更新 `.specify/templates/` 下受影响的模板，不得留下悬空引用。

**版本策略**（语义化版本）：

- **MAJOR**：移除或不向后兼容地重定义原则、治理规则。
- **MINOR**：新增原则或章节，或实质性扩展既有条款的约束范围。
- **PATCH**：措辞澄清、错别字修正、不改变约束语义的细化。

**合规审查**：

- 每个 PR **MUST** 由评审者核对宪章合规性；不合规的 PR **MUST NOT** 合并。
- 复杂度 **MUST** 被论证：任何偏离"最简可行方案"的设计都需要书面理由。
- 运行时开发指引参见 `CLAUDE.md` 与当前功能的 `specs/<###-feature-name>/plan.md`。
- 架构决策依据参见 `docs/design-consensus.md`；与之冲突的实现 **MUST** 先修订该文档。

**Version**: 1.2.0 | **Ratified**: 2026-08-20 | **Last Amended**: 2026-08-20
