# UX, REST & CLI / 用户体验、REST 与 CLI

术语必须在 UI、API、CLI、日志和文档中统一；错误必须说明发生了什么、可能原因和下一步操作。 Use consistent terminology across UI, API, CLI, logs, and documentation; errors must state what happened, likely causes, and the next action.

REST JSON 字段使用 camelCase，状态码稳定且语义正确，错误响应同时包含稳定机器错误码和中文人类文案；超过 2 秒的操作提供进度，长任务立即返回可轮询任务标识与已完成份数。 REST JSON fields use camelCase, stable semantically correct status codes, and an error body with a stable machine code plus Chinese human text; operations over two seconds show progress, and long jobs return a pollable task id and completed count without blocking.

CLI 参数使用 kebab-case，与 REST 字段保持可预测映射；输出支持人类格式和 `--json`，正常结果到 stdout，错误到 stderr，退出码稳定并有文档。 CLI flags use kebab-case with predictable REST mapping; output supports human-readable and `--json` forms, success goes to stdout, errors to stderr, and exit codes are stable and documented.
