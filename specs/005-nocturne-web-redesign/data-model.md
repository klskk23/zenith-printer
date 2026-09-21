# Data Model: Nocturne 前端重构

**Feature**: `005-nocturne-web-redesign` | **Date**: 2026-09-21

本功能**不改服务器数据模型**。这里的实体全部住在浏览器本机，或是既有服务器实体在前端的投影。

---

## 1. Draft（草稿）—— 浏览器本机

一张标签在这台浏览器上的未保存状态。

| 字段 | 类型 | 说明 |
|---|---|---|
| `draftId` | `string` | 本机唯一键。已保存标签的草稿用 `templateId`；未命名标签用 `randomId()`。 |
| `templateId` | `string \| null` | 所属服务器标签；`null` = 从未保存过的新标签。 |
| `baseVersion` | `number \| null` | 打开时服务器上的 `version`；新标签为 `null`。用于 FR-027 的比较。 |
| `present` | `LabelIR` | 当前内容。`labelIrSchema` 校验。 |
| `past` | `LabelIR[]` | 撤销栈，长度 ≤ 50（`UNDO_LIMIT`）。降级时可为空数组。 |
| `variables` | `VariableDefinition[]` | 与 `present` 配套的变量定义（编辑器状态的一部分）。 |
| `dataSourceId` | `string \| null` | 绑定的数据源。 |
| `name` | `string \| null` | 未命名标签暂存的名字（用户在保存前可能已输入）。 |
| `createdAt` | `string` (ISO) | 首次写入。画廊里未命名草稿按它排序。 |
| `updatedAt` | `string` (ISO) | 最后写入。FR-029 判定"另一个窗口改过"。 |
| `writerId` | `string` | 写入它的浏览器窗口 id（`sessionStorage`）。 |
| `unpersisted` | 不存储 | 运行时标志：本会话写入失败过（配额）。驱动 FR-020 提示与 `beforeunload`。 |

**校验**：读出时整体经 zod（`draftSchema`）校验；失败 → 该条目进入 `corrupt` 列表，画廊标注「无法读取」，可清理，不抛。

**不变量**：
- `past.length ≤ 50`。写入前由 `trimForStorage` 保证。
- `templateId !== null ⇒ draftId === templateId`：一张服务器标签在本机最多一份草稿（两个窗口共享它，最后写入胜出）。
- 保存成功 ⇒ 该 `draftId` 被删除（FR-023）。

**状态转移**：

```
(无) ──编辑──▶ 有草稿 ──保存成功──▶ (无)
                 │  ──清理──▶ (无)
                 │  ──写入失败(配额)──▶ 有草稿[unpersisted]（内存中仍完整）
                 └──服务器 404──▶ 有草稿[orphan]（画廊标「原标签已被删除」）
```

---

## 2. DraftIndex（草稿索引）—— 浏览器本机

一个键，列出所有草稿的摘要，让画廊不必逐键反序列化完整 IR。

| 字段 | 类型 |
|---|---|
| `version` | `1` |
| `entries` | `DraftIndexEntry[]` |

`DraftIndexEntry`：`{ draftId, templateId, name, widthMm, heightMm, createdAt, updatedAt }`。写草稿时同步更新；索引与草稿键不一致（索引有、键无）时以键为准并自愈。

---

## 3. WindowIdentity —— 浏览器窗口

`sessionStorage['zenith.window']`：一个随机 id，标签页（浏览器）生命周期内不变。仅用于 FR-029。

---

## 4. Label（标签）—— 服务器实体的前端投影

就是既有的 `Template`（`features/templates/hooks.ts`）。**不改字段**。本功能只改它在用户面前的叫法。画廊用到：`id, name, widthMm, heightMm, dpi, elements, variables, dataSourceId, version`。

---

## 5. GalleryItem（画廊格）—— 派生，不存储

画廊的一行由标签列表与草稿索引合并而来：

| 字段 | 来源 |
|---|---|
| `key` | `draftId` 或 `templateId` |
| `kind` | `'unsaved-new' \| 'saved' \| 'saved-with-draft' \| 'orphan-draft' \| 'corrupt-draft'` |
| `name` | 草稿名 → 标签名 → 「未命名」 |
| `widthMm/heightMm` | 草稿的 `present` 或标签 |
| `ir` | 缩略图用：草稿的 `present`（有草稿时）或标签的 IR |
| `dataSourceId` | 同上来源 |
| `sortKey` | `unsaved-new`/`orphan`/`corrupt` 在前（按 `createdAt` 降序），其余按标签名 |

**规则**：未保存的排最前（FR-016）；不显示总数（FR-013）。

---

## 6. ThumbnailValues —— 派生，不存储

`{ [variableName]: string }`。来源优先级：绑定数据源第一行 → `designValues(variables)`。第一行缺列 → 该键为 `''`（FR-014a）。

---

## 7. StatusSummary —— 派生，不存储

`app/status-summary.ts` 的输出：

```ts
interface StatusSummary {
  printers: Array<{ id, name, online: boolean, remaining: { kind: 'count', value } | { kind: 'unsupported' } | { kind: 'unknown' } }>
  queue: { state: 'running' | 'paused', pending: number } | null   // null = 没有打印机
  lastPrint: { labelName: string, status: JobStatus, jobId } | null
}
```

---

## 8. HeadFigure —— 派生，不存储

`print/head-figure.ts`：

```ts
interface HeadFigure { labelFraction: number; overflowFraction: number }   // 都在 [0,1]
headFigure({ labelWidthMm, maxWidthMm }) | null   // capabilities === null ⇒ null
```

---

## 9. 被移除的模型

- `WorkspaceState.tabs`（标签页集合）、`SOFT_TAB_LIMIT`、`draftNumber`、`editingTabCount/exceedsSoftLimit` —— 第 3 步删除。第 2 步期间 `WorkspaceTab` 临时增加 `draftId`。
- `TabKind` 中的 `'index'`、`'templates'`、`'design'` 合并为 `'labels'`（画廊）与 `'label'`（编辑器）；路径 `/`（画廊）、`/labels/:id`、`/labels/new/:draftId`。`?preset=` 继续挂在编辑器路径上。
