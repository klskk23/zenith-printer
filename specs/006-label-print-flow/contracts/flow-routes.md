# Contract: 四步的地址与可达性

**Feature**: `006-label-print-flow` | 模块：`packages/web/src/app/routes.ts`、`packages/web/src/features/print/flow.ts`

这不是 REST 接口——本功能不新增端点。它是地址契约：外部系统（资产台账）拿着旧地址进来，必须落在对的地方；每一步的地址必须能被收藏、刷新、前进后退。

## 地址 → 页面

| 地址 | 落点 | 说明 |
|---|---|---|
| `/` | ① 标签画廊 | 不变 |
| `/labels/{id}` | ② 设计 | 不变 |
| `/labels/new` | ② 设计（未保存） | 不变 |
| `/labels/{id}/print` | ③ 打印 | 新增 |
| `/labels/new/print` | ③ 打印（未保存的标签也能打） | 新增 |
| `/labels/{id}/confirm` | ④ 确认 | 新增 |
| `/labels/new/confirm` | ④ 确认（未保存） | 新增 |
| `/design/{id}?preset={p}` | ③ 打印，改写为 `/labels/{id}/print?preset={p}` | **变化点**：以前落编辑器 |
| `/design/{id}` | ② 设计，改写为 `/labels/{id}` | 不变 |
| `/design`、`/design/new`、`/design/new/{任意}` | ② 设计（未保存），改写为 `/labels/new` | 不变 |
| `/templates` | ① 画廊，改写为 `/` | 不变 |
| 其他 | `null`（由壳层显示「这个地址不对」并给回画廊的路） | 不变 |

`?preset={id}` 只在 `label` / `label-print` / `label-confirm` 三种地址上有意义，且在这三者之间切换时保留在地址里。

## 页面 → 地址

`pathForPage()` 对三种 label kind 分别产出上表的形式；`presetId` 存在时追加 `?preset=`（值经 `encodeURIComponent`）。

## 改写（rewrite）

`isLegacyAddress()` 判定为真的地址，由 workspace 用 `history.replaceState` 改写成新形式，**查询串保留**，不产生新的历史条目——否则后退键会回到旧地址再被改写一次，形成死循环。

`/design/{id}?preset=` 改写后落在 `label-print`。判据是**有 `?preset=`**：预设的意思是「打印机、参数、份数都给你摆好了」，那是打印的语境，不是排版的语境。

## 可达性

```
stepsFor({ page, canSubmit })
```

| page | ① | ② | ③ | ④ |
|---|---|---|---|---|
| `labels` | current | ahead | ahead | ahead |
| `label` | past | current | ahead | ahead |
| `label-print` | past | past | current | `canSubmit ? ahead : blocked` |
| `label-confirm` | past | past | past | current |

- `past` 可点，点了就切到那一步
- `ahead` / `blocked` 不可点
- `canSubmit` = 选了打印机 && （未绑数据源 || 已勾选至少一行）

从画廊直达：画廊上的瓦片有两个入口，缩略图/名称 → `label`，「打印」→ `label-print`。这不经过 `stepsFor`，它只负责画那条条。

## 守卫

- 打开 `/labels/{id}/confirm` 而 `canSubmit === false` 时，会话把地址改写回 `/labels/{id}/print`（`replaceState`，不留历史）
- 三步之间切换**不触发**未保存询问；离开这三种 kind（侧栏、返回符号、关闭页面）才触发
- 提交成功后不改地址；结果态是「确认」页的一个状态。此时按后退回到 `/labels/{id}/print`，不会重复提交（幂等键只在进入「确认」页时铸造，且提交已完成）

## 不变的对外契约

- `POST /api/print-presets/{presetId}/print`：台账的直接打印，服务端行为与界面无关，一行不动
- `GET /api/print-presets`：不动
- `docs/nexus-assets.md` 的链接形式不变，但第 110 行「画布也跟着预设的纸型走」需要改写——新落点没有画布
