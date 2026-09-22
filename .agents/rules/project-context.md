# Project Context / 项目上下文

当前功能是 **006-label-print-flow**（标签四步工作流 + 说明文字三档清理）。此前五个功能的规格与契约仍是基线：`specs/001-label-design-print/`、`002-web-workspace-editor/`、`003-variables-data-sources/`、`004-google-sheets-source/`、`005-nocturne-web-redesign/`。改动某一领域前，先读对应目录的 `spec.md` 与 `contracts/`。 The active feature is **006-label-print-flow**; the first five features' specifications and contracts remain the baseline.

<!-- SPECKIT START -->
开始该功能的实现前，读取：

- `specs/006-label-print-flow/spec.md`
- `specs/006-label-print-flow/plan.md`
- `specs/006-label-print-flow/research.md`
- `specs/006-label-print-flow/data-model.md`
- `specs/006-label-print-flow/contracts/flow-routes.md`
- `specs/006-label-print-flow/contracts/hint-tiers.md`
- `specs/006-label-print-flow/quickstart.md`

Before implementing this feature, read every artifact listed above.
<!-- SPECKIT END -->

## 仍然有效的硬约束 / Standing hard constraints

- **界面只有一套样式体系**：Nocturne 只以令牌进入 Tailwind `@theme`，不 import 其 `styles.css`；组件走 shadcn/ui。界面里唯一的纯白是标签纸（`.paper` 与编辑器画布），其余任何地方不得出现白。 One style system only: Nocturne enters as `@theme` tokens; the only pure white is the label paper.
- **对外地址契约不变**：`/design/{templateId}?preset=…` 与 `/templates` 继续可用，改写为 `/labels/…` 且保留查询串；资产台账（`docs/nexus-assets.md`）里的链接不得失效。REST 字段仍叫 `template*`，不改。 Legacy addresses keep working and are rewritten to `/labels/…` with the query string kept; REST fields stay `template*`.
- **说明文字分三档**：原理删除、操作说明收进「?」、错误与不可撤销确认原位保留；判据与清单见 `.agents/rules/ux-and-api.md` 与 `specs/006-label-print-flow/contracts/hint-tiers.md`。 Standing copy falls into three tiers; see the rule and the list.
- **打印是两页，不是对话框**：「打印」选机器/参数/行/份数，「确认」看一眼再出纸；正常路径上不出现任何提示。 Printing is two pages, not a dialog, and the ordinary path carries no notices.
- **用户面前不出现「模板」**：实体统一叫「标签」，`terminology.test.ts` 会拦截文案里的「模板」/"template"。 The word 「模板」/"template" never appears in user-facing copy.
- **Google 边界**：`SheetsPort` 仍是唯一的 Google 接触面，真实私钥只可出现在其真实实现中；默认测试套件脱网可跑。 `SheetsPort` remains the only Google boundary; the default test suite runs offline.

## 已被推翻的决定 / Superseded decisions

依据见 `docs/design-consensus.md` §6.3（2026-09-21）。 See `docs/design-consensus.md` §6.3.

- 002 的标签页模型（FR-010~013）与"切换保留状态"不再成立：一次只有一个页面，地址名之；侧栏常驻，产品名与打印机状态都在侧栏里；「标签」画廊即首页，没有首页、模板库、标签设计三个入口。 Spec 002's tab model is superseded: one page at a time, the sidebar is the shell, the label gallery is home.
- 005 规格最初的本机草稿体系已在 2026-09-21 撤销：**离开即放弃**——编辑器的未保存修改只在它打开期间存在，离开前若有修改问一次「保留这些修改吗？」。`specs/005-nocturne-web-redesign/contracts/draft-store.md` 与 `packages/web/src/features/drafts/` 已作废，不要恢复。 The draft system in 005's original spec was withdrawn: leaving abandons unsaved work; `draft-store.md` is void.
- 打印确认对话框（含预览、常驻消耗警示、打印头示意图）已在 006 拆成「打印」与「确认」两页，三样提示删除；裁切风险只在真会发生时出现。 The print dialog became two pages in 006; its preview, standing warning and head figure are gone.
- 版本冲突从"拒绝并要求重新载入"改为**最后保存为准**：服务器仍以 `version` + 409 `TEMPLATE_VERSION_CONFLICT` 拒绝过期写入，客户端取当前版本重试一次。 Version conflicts resolve as last-save-wins: the client refetches and retries once on 409.
