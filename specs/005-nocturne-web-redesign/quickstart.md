# Quickstart: Nocturne 前端重构

**Feature**: `005-nocturne-web-redesign`

三步交付，每一步独立可验证。下面每一步都是"启动 → 做什么 → 应当看到什么 → 跑哪些测试"。

## 启动

```bash
npm run dev            # 服务 + Vite；打开终端里打印的地址
npm test               # 逻辑 + 界面两个项目
npm run typecheck && npm run lint
```

不需要打印机。要看状态带里的"在线/余量"，加一台假地址的打印机即可（离线态也是要验的状态）。

---

## 第 1 步：视觉令牌与壳层

**看**：
1. 任意页面：底 `#161826`、面板 `#232532`、文字浅灰；主按钮是蓝紫描边、透明底。
2. 标签设计页：画布纯白，四周有微光；周围一切都是深色。
3. 设置页：没有「主题」。
4. 开发者工具 → Network → Font：首屏只有 `Inter*` 与 `NotoSansCJKsc*`，没有 `NotoSerif*`。在编辑器把一段文字字体改成「宋体」后才会加载它。
5. 标题不加粗（500）。

**测**：`design-tokens.test.ts`（对比度、唯一的白、无调色板类）、`fonts.test.ts`（衬线不进界面）、`render-smoke.dom.test.tsx`（每页能渲染）。

---

## 第 2 步：草稿（标签页栏仍在）

**做**：
1. 打开一张标签，拖两个元素，**不保存**。
2. 分别试：点侧栏别的入口再回来 / F5 / 关掉浏览器标签页再打开同一地址。
3. 回来后按 Ctrl+Z——应能退回。
4. 关闭一个有修改的标签页：确认框说"修改会作为草稿保留在本机"，不再说"无法恢复"。
5. 开发者工具 → Application → Local Storage：看到 `zenith.drafts.v1.index` 与 `zenith.drafts.v1.d.<id>`。
6. 保存后：那两个键消失。
7. 模拟配额：在控制台 `localStorage.setItem('x', 'a'.repeat(5e6))` 填满，再编辑——编辑器顶部出现「无法在本机保留」提示；把 `x` 删掉后再编辑，提示消失。

**测**：`drafts/store.test.ts`、`drafts/trim.test.ts`、`drafts/version.test.ts`（Node）；`editor-draft.dom.test.tsx`（离开再回来）、`tab-close-copy.dom.test.tsx`（确认框文案）。

---

## 第 3 步：无标签页栏，画廊即首页

**看**：
1. 打开根地址：落在「标签」画廊，没有标签页栏，没有「首页」；侧栏八项。
2. 顶部状态带：打印机在线/离线与余量、队列、最近一次打印。
3. 画廊：50×30 是横的、100×150 是竖的；绑定了数据源的标签，缩略图里是第一行的值。
4. 点一张：整页编辑器，侧栏还在，没有返回键；点侧栏「标签」回画廊。
5. 「新建标签」：进编辑器，同时画廊最上面多了「未命名 · 未保存」。
6. 两个浏览器窗口开同一张：各改一处，先后离开；先离开的那个再回来看到「另一个窗口改过它」。
7. 用第二个浏览器（或隐私窗口）保存同一张标签，回到第一个窗口打开它：先看到"服务器版本更新"警告；继续用草稿并保存：被拒，出现「另存为新标签」。
8. 打印确认框：已探测打印机画出幅宽横条；未探测不画并说明。
9. 整个界面搜「模板」：没有。
10. 「清理未保存的草稿」：先列清单，确认后画廊记号消失。

**测**：`gallery.dom.test.tsx`、`status-strip.dom.test.tsx`、`head-figure.test.ts` + `print-head-figure.dom.test.tsx`、`conflict.dom.test.tsx`、`terminology.test.ts`、`render-smoke.dom.test.tsx`（重写为八页）。

---

## 完成定义

- `npm run typecheck && npm run lint && npm test` 全绿；`npm run test:coverage` 中新增的逻辑模块 ≥ 80%。
- 三步各自独立提交；第 3 步的提交不早于第 2 步。
- `docs/design-consensus.md` 新增 §6.3 记录对规格 002 标签页模型的推翻。
- 推送前按 `workflow.md` 做机密检查；**推送需要用户手动确认**。
