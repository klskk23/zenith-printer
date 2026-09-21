# Testing / 测试

- 默认测试套件必须脱离物理打印机、Google 网络和其他外部网络运行。The default test suite must run without physical printers, Google network access, or other external network access.
- 新功能与缺陷修复遵循红—绿—重构：先写会失败的测试，再写最小实现，最后重构。Features and bug fixes follow red-green-refactor: write a failing test, implement the minimum, then refactor.
- 前端必须使用 Playwright 进行自动化测试；每个可从导航到达的页面必须有渲染断言，并且测试实际执行路径。Frontend work must use Playwright for automated testing; every navigable page needs a rendering assertion, and tests must exercise execution paths.
- 逻辑测试与界面测试分开；纯逻辑保持纯 Node，DOM 测试单独配置，并纳入默认测试命令。Keep logic and UI tests separate; pure logic stays in Node, DOM tests use a separate project, and the project is included in the default test command.
- Google 集成测试使用 `SheetsPort` 假实现；硬件或联网实测必须单独隔离并记录环境。Google integration tests use a fake `SheetsPort`; hardware or network tests must be isolated and document their environment.
- 测试应验证行为、错误路径和成功执行路径，不只验证拦截或请求被调用。Tests must verify behavior, error paths, and successful execution paths, not only interception or that a request was called.
