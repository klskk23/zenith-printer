# Security & Secrets / 安全与机密

提交或推送前检查工作区、暂存区、提交内容和 Git 历史中的 API key、私钥、令牌、密码、证书及环境文件。 Before committing or pushing, inspect the worktree, index, commit contents, and Git history for API keys, private keys, tokens, passwords, certificates, and environment files.

Google Sheets 的私钥只允许出现在真实 `SheetsPort` 实现这一处；测试必须使用假实现，不得把密钥放入规格、日志、测试夹具或示例。 Google Sheets private keys may appear only in the real `SheetsPort` implementation; tests must use a fake and secrets must not appear in specifications, logs, fixtures, or examples.

结构化日志必须支持 `error`/`warn`/`info`/`debug` 分级。debug 可导出协议十六进制帧，但任何级别都不得记录密钥、令牌或未脱敏的设备标识。 Structured logs must support `error`/`warn`/`info`/`debug`; debug may export protocol frames as hex, but no level may log secrets, tokens, or unredacted device identifiers.

推送远端是需要人工审核的操作；未获得人工审核前，不执行远端 push。 Pushing to a remote is a human-reviewed operation; do not push until human review is granted.
