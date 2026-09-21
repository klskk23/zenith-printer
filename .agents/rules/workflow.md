# Development Workflow / 开发工作流

开始任何任务前，先通过 `using-superpowers` 检查是否有适用 skill，加载适用技能与项目规则，并遵循其要求。 Before any task, use `using-superpowers` to check for applicable skills, load the applicable skills and project rules, and follow them.

大型、完整或包含多个步骤的需求，在报告完成前必须完整执行以下 Superpowers 流程：`brainstorming → using-git-worktrees → writing-plans → subagent-driven-development` 或 `executing-plans` → `test-driven-development` → `requesting-code-review` → `finishing-a-development-branch`。 For any large, complete, or multi-step request, complete this Superpowers workflow before reporting completion: `brainstorming → using-git-worktrees → writing-plans → subagent-driven-development` or `executing-plans` → `test-driven-development` → `requesting-code-review` → `finishing-a-development-branch`.

涉及新功能、行为变化、多个界面或组件重设计、跨文件重构、架构或接口变化，或需要多个验证步骤的需求，一律视为大型任务。 Treat new features, behavior changes, redesigns of multiple interfaces/components, cross-file refactors, architecture or interface changes, or work needing multiple verification steps as large tasks.

TDD 必须在实现过程中执行：先写失败测试，再实现，再重构；不得推迟到实现完成后。 TDD runs during implementation: write a failing test, implement, then refactor; do not defer it until implementation is finished.

所有变更应在功能分支或隔离 worktree 中进行，除非用户明确要求当前分支。提交或推送前必须完成验证与代码评审。 Make changes on a feature branch or isolated worktree unless the user explicitly requests the current branch; complete verification and code review before committing or pushing.

推送到远端必须经人工审核。提交和推送之前必须检查密钥、私钥、令牌及其他机密是否存在于当前变更或 Git 历史中。 Remote pushes require human review. Before committing or pushing, check the current changes and Git history for keys, private keys, tokens, and other secrets.
