# Project Context / 项目上下文

当前没有进行中的功能。五个功能已全部合入 `main`，最新发布为 **v0.5.0（2026-09-21）**：`specs/001-label-design-print/`、`specs/002-web-workspace-editor/`、`specs/003-variables-data-sources/`、`specs/004-google-sheets-source/`、`specs/005-nocturne-web-redesign/`。这些规格与契约是后续工作的基线；改动某一领域前，先读对应目录的 `spec.md` 与 `contracts/`。 No feature is in progress. All five features are merged into `main`; the latest release is **v0.5.0 (2026-09-21)**. Their specifications and contracts are the baseline: read the matching `spec.md` and `contracts/` before changing an area.

<!-- SPECKIT START -->
新功能由 `/speckit-specify` 在此处写入产物清单；开始实现前读取列出的每一项。 A new feature's artifact list is written here by `/speckit-specify`; read every listed artifact before implementing.
<!-- SPECKIT END -->

## 仍然有效的硬约束 / Standing hard constraints

- **界面只有一套样式体系**：Nocturne 只以令牌进入 Tailwind `@theme`，不 import 其 `styles.css`；组件走 shadcn/ui。界面里唯一的纯白是标签纸（`.paper` 与编辑器画布），其余任何地方不得出现白。 One style system only: Nocturne enters as `@theme` tokens; the only pure white is the label paper.
- **对外地址契约不变**：`/design/{templateId}?preset=…` 与 `/templates` 继续可用，改写为 `/labels/…` 且保留查询串；资产台账（`docs/nexus-assets.md`）里的链接不得失效。REST 字段仍叫 `template*`，不改。 Legacy addresses keep working and are rewritten to `/labels/…` with the query string kept; REST fields stay `template*`.
- **用户面前不出现「模板」**：实体统一叫「标签」，`terminology.test.ts` 会拦截文案里的「模板」/"template"。 The word 「模板」/"template" never appears in user-facing copy.
- **Google 边界**：`SheetsPort` 仍是唯一的 Google 接触面，真实私钥只可出现在其真实实现中；默认测试套件脱网可跑。 `SheetsPort` remains the only Google boundary; the default test suite runs offline.

## 已被推翻的决定 / Superseded decisions

依据见 `docs/design-consensus.md` §6.3（2026-09-21）。 See `docs/design-consensus.md` §6.3.

- 002 的标签页模型（FR-010~013）与"切换保留状态"不再成立：一次只有一个页面，地址名之；侧栏常驻，产品名与打印机状态都在侧栏里；「标签」画廊即首页，没有首页、模板库、标签设计三个入口。 Spec 002's tab model is superseded: one page at a time, the sidebar is the shell, the label gallery is home.
- 005 规格最初的本机草稿体系已在 2026-09-21 撤销：**离开即放弃**——编辑器的未保存修改只在它打开期间存在，离开前若有修改问一次「保留这些修改吗？」。`specs/005-nocturne-web-redesign/contracts/draft-store.md` 与 `packages/web/src/features/drafts/` 已作废，不要恢复。 The draft system in 005's original spec was withdrawn: leaving abandons unsaved work; `draft-store.md` is void.
- 版本冲突从"拒绝并要求重新载入"改为**最后保存为准**：服务器仍以 `version` + 409 `TEMPLATE_VERSION_CONFLICT` 拒绝过期写入，客户端取当前版本重试一次。 Version conflicts resolve as last-save-wins: the client refetches and retries once on 409.
