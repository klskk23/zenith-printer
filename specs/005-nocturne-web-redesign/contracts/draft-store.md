# Contract: 草稿存储（浏览器本机）

**Feature**: `005-nocturne-web-redesign` | 模块：`packages/web/src/features/drafts/`

这不是 REST 接口——本功能不新增任何端点。它是前端内部的**存储契约**：键的布局、序列化形状、失败语义。写下来是因为它跨版本存在（今天写的草稿明天的代码要读得出来），而"随手改一个字段名"正是让人第二天丢一晚上工作的方式。

---

## 键空间

| 键 | 内容 | 谁写 |
|---|---|---|
| `zenith.drafts.v1.index` | `DraftIndex` JSON | `DraftStore.write / remove / clear` |
| `zenith.drafts.v1.d.<draftId>` | `Draft` JSON | `DraftStore.write` |
| `zenith.window`（`sessionStorage`） | `string` | 首次读取时生成 |

前缀里的 `v1` 是形状版本。改字段 = 升版本 + 迁移函数；旧键读不出来时列为 `corrupt`，**不**静默删除。

---

## 接口

```ts
/** 会报错的存储端口。与 lib/storage.ts 的 safeLocalStorage 不同：这里的失败要被看见。 */
export interface DraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void   // 可能抛 QuotaExceededError
  removeItem(key: string): void
  keys(): string[]                            // 以 zenith.drafts.v1. 开头的全部键
}

export interface DraftStore {
  /** 读一份。不存在 → null；存在但校验失败 → { corrupt: true, draftId }。永不抛。 */
  read(draftId: string): Draft | CorruptDraft | null
  /** 写一份。先按原样写；QuotaExceeded → 丢 past 重写；仍失败 → 返回 'unpersisted'。永不抛。 */
  write(draft: Draft): 'stored' | 'stored-without-history' | 'unpersisted'
  remove(draftId: string): void
  /** 索引 + 自愈：索引里有而键里没有的条目被剔除；键里有而索引没有的被补上。 */
  list(): { entries: DraftIndexEntry[]; corrupt: string[] }
  /** 清理全部草稿。调用方负责 FR-024 的确认框。 */
  clear(): void
}

export function createDraftStore(storage: DraftStorage, clock: () => string, windowId: string): DraftStore
```

时钟与窗口 id 注入（宪章：时间源必须可注入）。

---

## 序列化形状（zod）

```ts
const draftSchema = z.object({
  draftId: z.string().min(1),
  templateId: z.string().min(1).nullable(),
  baseVersion: z.number().int().nonnegative().nullable(),
  present: labelIrSchema,
  past: z.array(labelIrSchema).max(UNDO_LIMIT),
  variables: z.array(variableDefinitionSchema),
  dataSourceId: z.string().nullable(),
  name: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  writerId: z.string().min(1),
})
```

`draftIndexSchema`：`{ version: z.literal(1), entries: z.array(draftIndexEntrySchema) }`。

---

## 失败语义

| 情形 | 行为 | 用户看到 |
|---|---|---|
| `setItem` 抛 `QuotaExceededError`（或任何异常） | 把 `past` 置空后重试一次 | 无提示（撤销栈静默丢弃是规格允许的降级） |
| 重试仍失败 | 返回 `'unpersisted'`，内存草稿保持完整 | 编辑器顶部：「这张标签的修改无法在本机保留，离开前请先保存」；`beforeunload` 提示启用 |
| 读到的 JSON 解析或校验失败 | `{ corrupt: true }` | 画廊格标「无法读取」，可清理 |
| `localStorage` 不可用（隐私模式） | `DraftStorage` 由内存实现替代，`write` 一律 `'unpersisted'` | 编辑器顶部：「这台浏览器不允许保存草稿，离开即丢失」 |

---

## 写入时机（调用方约定）

- 编辑器每次 `history` 变化后 300 ms 防抖写；
- `visibilitychange → hidden`、`pagehide`、页面切换（`WorkspaceProvider.open`）前**同步冲刷**；
- 保存成功后 `remove(draftId)`；
- 从不在渲染期写。

---

## 并发（同机多窗口）

最后写入胜出。回到编辑器时若 `read(draftId).writerId !== windowId` 且 `updatedAt > 本窗口上次写入时间` → 显示「这台机器上另一个窗口改过它」并以存储中的内容为准重新初始化。不加锁（与规格 002 的多用户决定一致：无鉴权下锁无主人）。
