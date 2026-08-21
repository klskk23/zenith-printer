<!-- SPECKIT START -->
当前功能：**002-web-workspace-editor**（前端工作区与标签编辑器重构）

开始任何实现工作前，请阅读以下产物：

- 实现计划：`specs/002-web-workspace-editor/plan.md`
- 功能规格：`specs/002-web-workspace-editor/spec.md`
- 技术决策与待实测假设：`specs/002-web-workspace-editor/research.md`
- 数据模型：`specs/002-web-workspace-editor/data-model.md`
- 接口契约：`specs/002-web-workspace-editor/contracts/`
- 环境搭建：`specs/002-web-workspace-editor/quickstart.md`
- 界面设计共识：`docs/frontend-design-v2.md`

上一功能 **001-label-design-print** 的产物仍然有效，其规格与契约是本功能的基线：
`specs/001-label-design-print/`
<!-- SPECKIT END -->

## 项目宪章

本项目的开发受 `.specify/memory/constitution.md`（Zenith Printer Constitution **v1.2.0**）约束。
开始任何规格、计划、任务或实现工作前，必须先阅读该文件并遵守其五条核心原则：

1. **代码质量优先** —— 严格类型、零 Lint 错误、显式错误处理
2. **测试标准（不可协商）** —— 测试先行；默认测试套件必须可脱离物理打印机运行
3. **用户体验一致性** —— 三段式：III.0 共通（术语统一、错误三要素）+ III.A Web/REST
   （主形态：camelCase、状态码稳定、长任务非阻塞）+ III.B CLI（辅助形态：kebab-case、
   `--json`、退出码）
4. **语言与本地化规范** —— 见下方"语言规范"
5. **可观测性与故障可诊断性** —— 结构化日志、协议帧可在 debug 级别导出

架构决策的完整依据见 `docs/design-consensus.md`（九个分支的可行性共识）。

## 技术栈（宪章已锁定）

全栈 TypeScript，前后端同仓，单进程部署。

- **后端**：Node.js + Fastify + zod + SQLite
- **前端**：Vite + React + Tailwind CSS + **shadcn/ui**；编辑器用 **SVG DOM，不用 canvas**
- **渲染**：`@resvg/resvg-js`（打包字体 + `loadSystemFonts: false`）+ `bwip-js`（条码）；
  `sharp` 仅用于二值化与格式转换，**不得**用它渲染 SVG 文字
- **打印**：精臣走 `@mmote/niimbluelib`（print task `B1`，serial `/dev/ttyACM0`）；
  霍尼韦尔走 ZSim/ZPL over raw TCP 9100

**UI 组件一律优先 shadcn/ui**，仅当其无适用组件时才自建，且必须复用其设计令牌
（Tailwind 主题变量、`cn()`、Radix 原语），并在 PR 里说明 shadcn/ui 缺少什么。

**单位**：mm 存储，`dot = round(mm × dpi / 25.4)`；画布先转整数 dot，元素坐标基于该
dot 网格计算，不要逐元素从 mm 换算。

## 语言规范（原则 IV）

- **中文**：文档、README、规格说明、计划、任务、提交信息正文、议题与 PR 描述、代码评审意见、
  以及与 AI 助手的全部对话。
- **英文**：标识符、类型名、文件名、代码注释、日志消息、错误消息模板、测试用例名称、
  提交信息的 type/scope 前缀。
- **例外**：I18N 本地化资源文件中的翻译文案使用其目标语言；键名（key）仍使用英文。
- 面向最终用户的文案必须经由 I18N 层输出，不得在代码中硬编码非英文字符串。

提交信息格式：`<type>(<scope>): <中文描述>`，例如 `feat(cli): 新增标签密度参数`。
