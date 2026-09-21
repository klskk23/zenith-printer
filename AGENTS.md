# Zenith Printer

## PROJECT

- 这是项目级最小指令入口；详细规则采用渐进式披露，按需读取 `.agents/rules/` 中的规则文件。
  This is the minimal project instruction entry point; load detailed rules progressively from `.agents/rules/`.
- 每次任务开始：先读取 `.agents/rules/index.md`，再读取其中标为 **Always** 的规则；根据任务类型加载对应规则。
  At task start, read `.agents/rules/index.md`, then every rule marked **Always**; load task-specific rules as needed.
- 任何规格、计划、任务或实现工作：先读取 `.agents/rules/constitution.md`；当前功能工作还必须读取 `.agents/rules/google-sheets.md` 与 `project-context.md` 列出的规格产物。
  Before specification, planning, task, or implementation work, read `.agents/rules/constitution.md`; current-feature work must also read `.agents/rules/google-sheets.md` and the artifacts listed by `project-context.md`.
- 前端或页面变更加载 `testing.md` 与 `architecture.md`；提交、分支、推送或机密处理加载 `workflow.md` 与 `security.md`。
  For frontend or page changes load `testing.md` and `architecture.md`; for commits, branches, pushes, or secrets load `workflow.md` and `security.md`.
- 规则冲突时，用户指令优先，其次是 `.specify/memory/constitution.md`，再其次是本目录规则与具体规格。
  When rules conflict, follow user instructions first, then `.specify/memory/constitution.md`, then these rules and the applicable specification.
