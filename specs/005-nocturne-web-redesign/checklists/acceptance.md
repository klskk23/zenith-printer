# 验收记录：Nocturne 前端重构

**Date**: 2026-09-21 | **Branch**: `005-nocturne-web-redesign` | **环境**: Chromium（Playwright），本机 dev 服务（`npm run dev`），真实 SQLite 数据

## 自动验证

- `npm run typecheck`、`npm run lint`：零错误
- `npm test`：197 个文件、2608 个测试全绿
- `npm run test:coverage`：总体 96%；`head-figure.ts`、`gallery-items.ts` 100%，`routes.ts` 94%

## 浏览器目视（quickstart 第 1 步、第 3 步）

- [x] 深色 Nocturne 令牌；主按钮描边；输入框有边；标题 500 字重
- [x] 画布纯白带微光（灯箱），四周无其他纯白
- [x] 侧栏一整块：产品名在顶部、七项带图标、底部三台打印机各自的探测状态/余量上报能力、服务连接状态；无「接口调试」
- [x] 「标签」画廊：状态带（队列、最近一次打印）；两张 60×40 标签按真实比例呈现，绑定台账的缩略图里是第一行真实值
- [x] 旧地址 `/templates` → `/`；台账格式 `/design/{templateId}?preset={presetId}` → `/labels/{templateId}?preset=…`，编辑器打开并提示「已按预设「种子路由器」摆好打印机、打印参数与份数」
- [x] 编辑器左上「返回标签」

## nexus-assets 对接核对

| 契约点（docs/nexus-assets.md） | 结果 |
|---|---|
| `NEXUS_ASSETS_SERVICE_URL` / `_API_KEY` 环境变量 | 服务端未动，`env-example-coverage` 测试通过 |
| Zenith → 台账 `GET /api/categories`、`GET /api/rows?…` | 服务端 nexus-client 未动，集成测试通过 |
| 台账 → Zenith `GET /api/print-presets` 信封 `{presets}` | 真实服务返回 `envelope keys: ['presets']`，含 `templateId` |
| 深链接 `{ZENITH_URL}/design/{templateId}?preset={presetId}` | 真实浏览器验证：改写为新地址、查询串保留、预设已应用；`preset-link.dom` 与 `routes` 测试锁定 |
| 不自动弹打印对话框 | 未变，测试锁定 |
| `POST /api/print-presets/{id}/print`、`GET /api/print-jobs/{id}` | 服务端未动，集成测试通过 |

## 未做

- 隐私模式下的表现只由 DOM 测试覆盖（无 `localStorage` 已不再影响任何功能）。
- 推送到远程仓库需要用户确认（未推送）。
