# Rule Index / 规则索引

规则文件按任务加载，避免把完整项目背景重复放进每个会话。Rule files are loaded by task so the root entry stays small.

| Rule | Load timing / 加载时机 |
|---|---|
| `constitution.md` | **Always**：任何规格、计划、任务、实现、评审或文档结构变更前。 **Always**: before specification, planning, implementation, review, or documentation structure changes. |
| `language.md` | **Always**：任何对话、代码、注释、提交或文档工作。 **Always**: for conversation, code, comments, commits, or documentation. |
| `workflow.md` | **Always for changes**：开始变更、使用技能、分支、提交、推送前。 **Always for changes**: before changes, skills, branches, commits, or pushes. |
| `project-context.md` | 当前功能或需要理解既有规格时。 For the active feature or existing specification context. |
| `architecture.md` | 后端、前端、渲染、打印、部署或跨模块变更时。 For backend, frontend, rendering, printing, deployment, or cross-module changes. |
| `testing.md` | 测试、功能、缺陷修复、页面或验证工作时。 For tests, features, bug fixes, pages, or verification. |
| `security.md` | 凭据、外部服务、日志、提交、推送或历史检查时。 For credentials, external services, logs, commits, pushes, or history checks. |
| `google-sheets.md` | 004 Google Sheets 数据源相关工作时。 For work related to feature 004 Google Sheets data source. |

仅加载与任务相关的规则；规则文件中的链接是权威来源，按需继续读取。Load only relevant rules; follow linked authoritative sources when a rule points to one.
