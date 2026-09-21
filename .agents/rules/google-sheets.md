# Google Sheets Source / Google Sheets 数据源

实现前先阅读 `.agents/rules/constitution.md`、`.agents/rules/project-context.md` 列出的全部规格，以及 `.agents/rules/testing.md` 与 `.agents/rules/security.md`。 Before implementation, read the constitution, every specification listed by `project-context.md`, and the testing and security rules.

三条支配性决定：

1. 使用服务账号而非 OAuth2；表只能通过显式分享可见。 Use a service account rather than OAuth2; a sheet is visible only when explicitly shared.
2. 行保留在本地，刷新由用户手动触发；渲染、`PageSource` 和提交时快照不改行，打印不依赖外网。 Keep rows local and refresh manually; rendering, `PageSource`, and submission snapshots do not mutate rows, and printing does not depend on the network.
3. 同步失败不拒绝打印：表不可用、列不匹配、超行数或超时都保留旧行并说明原因；只有列消失或改名会阻止继续。 Sync failures do not reject printing: preserve old rows and explain unavailable sheets, mismatched columns, row limits, and timeouts; only removed or renamed columns block continuation.

默认测试必须脱网；Google 侧一律使用 `SheetsPort` 假实现。只有 `quickstart.md` 第五节规定的两项联网实测可在 `hardware` 项目执行。 The default suite is offline and Google access always uses a fake `SheetsPort`; only the two network checks in section five of `quickstart.md` may run in the `hardware` project.
