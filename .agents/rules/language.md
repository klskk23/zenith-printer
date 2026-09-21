# Language & Localization / 语言与本地化

- 与 AI 助手的对话使用中文。Conversation with the AI assistant uses Chinese.
- 代码、标识符、类型名、文件名、代码注释、日志消息、错误消息模板、测试用例名称，以及提交信息的 type/scope 前缀使用英文。Code, identifiers, type names, filenames, code comments, log messages, error-message templates, test names, and commit type/scope prefixes use English.
- Superpowers 相关文档使用中文。Superpowers documentation uses Chinese.
- 其他阅读性文档使用中英双语，除非其所在规范指定了目标语言。Other reader-facing documentation uses Chinese and English unless its governing specification sets a target language.
- I18N 资源遵循目标语言；键名仍使用英文。I18N resources follow the target language; keys remain English.
- 面向最终用户的文案必须经由 I18N 层输出，不得在代码中硬编码非英文字符串。User-facing copy must go through the I18N layer; do not hard-code non-English strings in code.
- 提交信息格式为 `<type>(<scope>): <中文描述>`，例如 `feat(cli): 新增标签密度参数`。Commit messages use `<type>(<scope>): <中文描述>`.
