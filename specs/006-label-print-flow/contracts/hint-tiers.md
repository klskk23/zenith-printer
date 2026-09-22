# Contract: 说明文字的三档清单

**Feature**: `006-label-print-flow` | 模块：`packages/web/src/i18n/*`、`components/ui/hint.tsx`

## 判据

| 档 | 判据 | 处置 |
|---|---|---|
| **原理** | 讲「为什么这样设计」「改了不会出事」「系统内部怎么关联」 | 删除 |
| **操作说明** | 讲「这格怎么填」「这个参数干什么」，且**常驻**在页面上 | 收进「?」 |
| **必留** | 错误、不可撤销操作的确认、异常状态说明、空状态引导 | 原位不动 |

**一条细则**：判据只针对**常驻**文字。对话框是「一步一事」的临时容器，里面紧贴字段的说明就是那一步的内容，留在原位——把一个只有一个输入框的对话框里唯一的说明藏进「?」，是把内容藏起来。

## 删除（原理）

| 键 | 行 | 现在渲染在 |
|---|---|---|
| `templates.renameHint` | 555 | `pages/labels-page.tsx` 改名弹窗 |
| `dataSources.renameHint` | 396 | `features/data-sources/data-sources-page.tsx` 改名弹窗 |
| `dataSources.explain` | 305 | 数据源页 `PageHeader` 的 `description` |
| `presets.explain` | 758 | `pages/print-presets-page.tsx` 与 `preset-dialog.tsx` |
| `presets.editExplain` | 770 | `preset-dialog.tsx` 编辑态 |
| `pools.explain` | 480 | `features/data-sources/data-source-editor.tsx` 序号池一节 |

## 删除（已经没人用的死文案）

| 键 | 行 | 说明 |
|---|---|---|
| `dataSources.keyColumnHint` | 364 | i18n 里有，界面上没有任何地方引用 |
| `dataSources.pasteHint` | 422 | 同上（`editor.image.pasteHint` 是另一条，仍在用） |
| `printForm.overrideHint` | 676 | 同上 |
| `profiles.canvasFollowsProfile` | 647 | 同上 |

## 收进「?」（常驻的操作说明）

| 键 | 行 | 挂在哪 | 形态 |
|---|---|---|---|
| `dataSources.googleShareWith` | 379 | 数据源页标题旁 | `ValueHint`（点开，地址可选中 + 复制） |
| `profiles.thresholdHint` | 652 | 打印参数表单「黑白分界」字段旁 | `Hint` |
| `profiles.halftoneHint` | 654 | 同表单「半调」字段旁 | `Hint` |
| `profiles.isDefaultHint` | 663 | 同表单「设为默认」旁 | `Hint` |
| `profiles.marginHint` | 646 | 同表单「边距」旁 | `Hint` |
| `printers.hints.printTaskName` | 118 | 打印机表单「打印任务」字段旁 | `Hint` |
| `dataSources.gridHint` | 441 | 数据源编辑器表格标题旁 | `Hint` |
| `rowSelection.orderNote` | 464 | 行选择面板的顺序切换旁 | `Hint` |
| `editor.fields.invertedHint` | 218 | 属性面板「反白」旁 | `Hint` |
| `editor.image.pasteHint` | 234 | 图片面板标题旁 | `Hint` |
| `settings.scopeNote` + `settings.localOnlyHint` | 568 / 594 | 设置页「偏好」一节标题旁，合并成一条 | `Hint` |

合并后保留 `settings.scopeNote` 一个键，`localOnlyHint` 删除；新文案要同时说清「只影响这个浏览器」与「换浏览器回默认」。

## 必留（原位不动，逐类举例）

- **错误**：`templates.saveFailed`、`presets.saveFailed` / `createFailed`、`dataSources.patchFailed`、`templates.importUnreadable`、`dataSources.rangeInvalid`
- **不可撤销的确认**：`dataSources.deleteWarning`、`dataSources.discardConfirm`、`settings.pruneConfirmBody`、`presets.removeConfirm`、`pools.deleteWarning`、`templates.importConflictBody`
- **异常状态**：`workspace.disconnectedBanner`、`templates.conflict`、`dataSources.columnChangeAffected` / `columnChangeRenameNote`、`dataSources.refreshClearedSelection`、`dataSources.googleNotConfigured`、`printers.addressChangeClearsProbe`、`queue.note` / `countManually` / `unknownCount`、`profiles.needsProfile`、`variables.needsTemplateForSequence`
- **预设失效**：`preset.missing` / `printerGone` / `profileGone`（FR-064）
- **空状态引导**：`labels.empty` / `emptyDetail`、`dataSources.empty` / `emptyDetail`、`printers.emptyDetail`、`presets.empty`、`variables.empty`
- **对话框内紧贴字段的说明**：`dataSources.googleUrlHint`、`dataSources.googlePreviewHint`、`dataSources.nexusExplain`、`dataSources.retryHint`、`apiDocs.explain`
- **真警告**：`apiDocs.liveWarning`、`settings.apiDocsHint`（「提交打印会真的出纸」）、`dataSources.googleReadOnlyNote`、`rowSelection.widthNotChecked`

## 本功能自己删掉的打印文案

| 键 | 为什么 |
|---|---|
| `print.warning`（打印会消耗标签纸且无法撤销） | FR-040：确认页本身就是确认 |
| `print.headFigure` / `print.headOverflow` | FR-040：打印头示意图去掉；超宽改由 `print.clipLine` 一行说明 |
| `print.heading` / `confirm` / `cancel`（对话框标题与按钮） | 对话框不存在了；由步条与底部动作条的文案替代 |

新增：`flow.*`（四步名称、返回、继续、上一步）、`print.clipLine`（裁切那一行）、`print.tally`（N 张 · 约 M 秒）、`print.again`（再打一次）、`print.toQueue`（去打印队列）。

## 验收方式

`packages/web/tests/hint-tiers.test.ts`（纯逻辑，不渲染）按本清单断言：

1. 「删除」档的键在 `zh-CN.ts` 与 `en-US.ts` 里都不存在
2. 「收进 ?」档的键仍存在，且在 `src/` 里只被 `<Hint>` / `<ValueHint>` 的调用点引用
3. 「必留」档的键仍存在且仍被非 Hint 的代码引用
4. 两份 i18n 的键集合完全一致（既有测试已有此项，沿用）
