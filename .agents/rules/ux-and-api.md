# UX, REST & CLI / 用户体验、REST 与 CLI

术语必须在 UI、API、CLI、日志和文档中统一；错误必须说明发生了什么、可能原因和下一步操作。 Use consistent terminology across UI, API, CLI, logs, and documentation; errors must state what happened, likely causes, and the next action.

REST JSON 字段使用 camelCase，状态码稳定且语义正确，错误响应同时包含稳定机器错误码和中文人类文案；超过 2 秒的操作提供进度，长任务立即返回可轮询任务标识与已完成份数。 REST JSON fields use camelCase, stable semantically correct status codes, and an error body with a stable machine code plus Chinese human text; operations over two seconds show progress, and long jobs return a pollable task id and completed count without blocking.

CLI 参数使用 kebab-case，与 REST 字段保持可预测映射；输出支持人类格式和 `--json`，正常结果到 stdout，错误到 stderr，退出码稳定并有文档。 CLI flags use kebab-case with predictable REST mapping; output supports human-readable and `--json` forms, success goes to stdout, errors to stderr, and exit codes are stable and documented.

## 说明文字的三档 / Three tiers of standing copy

界面上常驻的说明文字分三档处理，判据是"读它的人是谁、读完做什么"。 Standing explanatory copy falls into three tiers, judged by who reads it and what they do next.

- **原理 → 删除**：讲"为什么这样设计""改了不会出事""系统内部怎么关联"的句子。读者是用产品的人，不是维护它的人。 **Principle → delete**: sentences about why the system is built this way, or what will not break. The reader is not maintaining the product.
- **操作说明 → 收进「?」**：讲"这格该怎么填""这个参数干什么"的句子，收进控件或标题旁的问号。 **How-to → behind a `?`**: what goes in this box, what this setting does; folded into the mark beside the control or the title.
- **错误、不可撤销操作的确认、异常状态说明、空状态引导 → 原位保留，一字不少**。错误仍须说清发生了什么、可能原因、下一步。 **Errors, confirmations for irreversible actions, abnormal-state notices and empty-state guidance → stay in place, in full**; errors still state what happened, the likely cause, and the next action.

细则：判据只针对**常驻**文字。对话框是"一步一事"的临时容器，里面紧贴字段的说明就是那一步的内容，留在原位。 The tiers apply to *standing* copy only: a dialog is a transient, one-task container, and the guidance beside its fields is that task's content.

「?」两种形态：纯文字的用 `<Hint>`（悬停、键盘聚焦、触屏点击都显示）；含需要带走的值的用 `<ValueHint>`（点开，值可选中，带复制）。复制走 document 的 copy 事件，不用 `navigator.clipboard`——局域网明文 HTTP 不是安全上下文。 Two shapes: `<Hint>` for prose, `<ValueHint>` for a value somebody must carry away; copying goes through the document's copy event, never `navigator.clipboard`, which is gated behind a secure context.

新增文案前先判档；`packages/web/tests/hint-tiers.test.ts` 按 `specs/006-label-print-flow/contracts/hint-tiers.md` 静态核对。 Decide the tier before adding copy; the check is static.
