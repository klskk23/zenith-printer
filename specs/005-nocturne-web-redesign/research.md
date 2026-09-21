# Research: Nocturne 前端重构

**Feature**: `005-nocturne-web-redesign` | **Date**: 2026-09-21

每一条都是"决定 / 理由 / 否决的替代方案"。没有 NEEDS CLARIFICATION 留到这里——规格阶段的访谈把产品层面的分叉都裁定了，本文件处理的是**怎么落地**的分叉。

---

## R1. Nocturne 怎样在宪章之下落地

**决定**：把 Nocturne `styles.css` 的 `:root` 值逐一映射进 Tailwind v4 的 `@theme`，覆盖 shadcn 用的那套语义令牌（`--color-background/foreground/card/primary/border/ring/...`），并新增 Nocturne 独有的角色（`--color-accent-300`、`--color-neutral-*` 阶梯、`--shadow-sm/md/lg`、`--radius-sm/md/lg = 4/8/14px`）。shadcn 组件通过既有的 `cva` 变体呈现 Nocturne 的形态（主按钮描边不填充——`button.tsx` 的 `default` 变体已经是描边的）。**不引入** Nocturne 的 `.btn/.card/.nav/.table` 类，不 `@import` 它的 `styles.css`。现有的 `[data-classical-*]` 属性选择器层整层删除。

**理由**：宪章「UI 组件规范」明令不得引入与 Tailwind 冲突的独立主题系统。Nocturne 的价值在令牌与方向，不在它的类名；令牌进 `@theme` 后每个 `bg-background`、`text-muted-foreground` 自动变成 Nocturne 的颜色，组件一个都不用改类名。

**替代方案否决**：
- 直接 `@import` Nocturne `styles.css` 并给元素加 `.btn` 等类 —— 违宪；两套按钮样式并存。
- 只改颜色、不动圆角与阴影 —— 用户明确要求「一个 token 不动」，圆角 4/8/14 与阴影是 Nocturne 之所以是 Nocturne。

**密度的处理（诚实记录）**：Nocturne 的 0.70× 是它自己的 `--space-1…8` 阶梯。Tailwind 的 `--spacing` 是全局基数，把它改成 0.175rem 会同时缩掉编辑器标尺、表格、第三方网格的所有内边距——影响远超壳层。决定：**壳层（侧栏、顶栏、状态带、画廊格、属性面板）按 Nocturne 的像素值显式设置内边距**，不改全局基数；编辑器画布区与数据表格保持现状。这样"看到的密度"是 Nocturne 的，而工具类的语义不被偷换。

---

## R2. 画廊缩略图的渲染路径

**决定**：**客户端纯函数渲染**。`useTemplates()` 返回的列表已带完整 IR（`elements`、`variables`、`widthMm/heightMm/dpi`）。缩略图 = `irToSvg(evaluateIr(ir, values))`，其中 `values` 来自绑定数据源的第一行（每个数据源一次 `rows` 查询，`limit=1`，react-query 缓存；多张标签绑同一表共用一次请求）；没有绑定、表空或请求失败时 `values` 退回 `designValues(variables)`（编辑器已有的占位逻辑）。SVG 字符串以 `<img src="data:image/svg+xml,...">` 呈现，被 `.paper` 容器包住。纸的轮廓（尺寸由 `thumbnailBoxPx` 决定）先渲染，`rows` 查询在途时用占位值，到达后替换——满足 FR-014b。

**理由**：
- 与画布"同一套呈现"是字面意义上的同一函数（设计共识 §F：IR→SVG 是前后端共享的同一个模块）。
- 确定性、离线可测：happy-dom 里断言 SVG 字符串含第一行的值即可，不需要 resvg。
- 服务端 `/api/templates/:id/thumbnail` 的 PNG 是保存时生成的，无法代入之后才变的数据，且 `thumbnail-frame.tsx` 的注释已否决"每卡一次 resvg"。

**替代方案否决**：
- 服务端保存时按第一行渲染 PNG，数据源刷新时重渲 —— 引入服务端到数据源的反向依赖；数据源刷新一次要重渲所有绑定它的模板；仍不满足"轮廓先出现"。
- 每张卡 POST `/api/preview` —— 每次访问 N 次 resvg，已在既有代码注释里否决。

**风险**：`irToSvg` 输出的 `<text>` 依赖字体族名；浏览器端用子集字体，生僻字豆腐块——这是设计共识早已接受的代价，缩略图不新增风险。条码由 `bwip-js` 生成 SVG 片段，`@zenith/shared` 已在浏览器端可用（编辑器画布已在用）。

---

## R3. 草稿存哪里、怎么存

**决定**：`localStorage`，键空间 `zenith.drafts.v1.*`：一个索引键 + 每份草稿一个键。读出时用 zod 校验（存储里的数据是外部输入，宪章「边界校验」）；校验失败的条目视为损坏，列出但标注，可清理。写入走一个**会报错的**存储端口（`DraftStorage`），不是 `safeLocalStorage`（它吞掉 `setItem` 异常，而 FR-020 要求配额不足时感知并降级）。写入策略：编辑后 300 ms 防抖 + `visibilitychange`/`pagehide`/页面切换时立即冲刷。降级：`QuotaExceededError` → 丢撤销栈重试 → 仍失败则把该草稿标为 `unpersisted` 并在编辑器显示 FR-020 的提示。

**容量估算**：一份 IR 是几个元素的 JSON，1–5 KB；50 步撤销 ≤ 250 KB；localStorage 通常 5 MB → 十几份带完整撤销栈的草稿绰绰有余，且降级路径在。

**窗口标识**：`sessionStorage` 里一个随机 id（每个浏览器标签页独立），写草稿时记入 `writerId`；回到编辑器时若草稿的 `writerId` 不是自己且 `updatedAt` 晚于本窗口上次写入 → 显示「这台机器上另一个窗口改过它」（FR-029）。

**替代方案否决**：
- IndexedDB —— 容量更大、异步、代码多一倍；以上估算说明不需要。
- 服务端草稿 —— 规格 Assumptions 明确排除（无鉴权下"谁的草稿"无法回答）。
- 复用 `safeLocalStorage` —— 它的设计前提是"存的东西不值得为之失败"，草稿恰好相反。

---

## R4. 版本基线与冲突

**决定**：草稿记录 `baseVersion`（打开时 `template.version`）。打开有草稿的标签时先取服务器模板：`server.version > draft.baseVersion` → FR-027 警告框（继续用草稿 / 放弃草稿）。保存沿用 `TemplateBar` 的 PATCH+`version`；409 时 `TemplateBar` 已识别 `conflict`，在其旁边提供「另存为新标签」= 走已有的 `asNew` 分支并要求输入名称（FR-028）。草稿对应模板 404 → 画廊显示「原标签已被删除」（FR-030），可另存或清理。

**不改服务器**：`version`、409 `TEMPLATE_VERSION_CONFLICT`、`POST /api/templates` 全部现成。

---

## R5. 第 3 步的导航模型

**决定**：保留 `routes.ts` 的路径↔页面映射，把 `WorkspaceState` 从「标签页集合」收缩为「一个活动页面描述符」：`{ page: TabDescriptor }`。`App.tsx` 只渲染活动页面（不再 hidden-mount 所有标签页）。编辑器的进出状态由草稿承担：进入 → 读草稿或服务器模板；离开 → 冲刷草稿。`tab-bar.tsx`、`SOFT_TAB_LIMIT`、`draftNumber` 编号、`untitled-design-tabs` 与 `tab-middle-click` 测试随标签页栏一起删除。

**理由**：标签页集合存在的唯一理由是"切走再切回来状态还在"（App.tsx 顶部注释）。草稿把这个保证搬到了存储里，集合就失去了理由。react-router-dom 虽在依赖里，但现有的 `routes.ts` 已足够且被测试覆盖，整体迁移到 react-router 是无关的大改。

**规格 002 的推翻**：002 的 FR-010~013（标签页形式、多开、切换保留状态、关闭确认）与 Clarification「撤销栈随标签页独立存在，不随模板持久化」被本功能取代。记录到 `docs/design-consensus.md` 新增 §6.3（宪章：与设计共识冲突的实现必须先修订该文档）。

**「新建标签」在画廊里的一格**：本地草稿没有服务器 id，用 `draftId`（`randomId()`）作键；画廊把索引里 `templateId === null` 的草稿排在最前。多个未命名草稿靠 `createdAt` 排序，不再有 1/2/3 编号（编号是标签页栏时代的产物）。

---

## R6. 打印头幅宽示意

**决定**：纯函数 `headFigure({ labelWidthMm, maxWidthMm })` → `{ labelFraction, overflowFraction }`（夹在 [0,1]，溢出时 `labelFraction = 1`、`overflowFraction = (label-max)/label`）。`maxWidthMm = dotsToMm(capabilities.printheadPixels, capabilities.dpi)`（`@zenith/shared/units.ts` 已有 `dotsToMm`，与服务端 `maxLabelWidthMm` 同一算式）。`capabilities === null` → 不画，显示既有文案 `print.needsProbe`。画法：一个内联 SVG，两个矩形，用 `--color-accent`（描边/线，不填充）与 `--color-destructive` 标溢出段。

**不改** `OverflowNotice` 与 preflight 行为（FR-033）。

---

## R7. 状态带

**决定**：把 `index-page.tsx` 里对打印机在线/余量、队列运行/暂停/待处理数、最近一次打印的汇总逻辑抽成 `app/status-summary.ts`（纯函数，输入是 `Printer[]`、`PrintJobSummary[]`，输出一个可直接渲染的摘要对象），`StatusStrip` 组件只负责排布。`consumable.ts` 已是纯逻辑且在覆盖率名单里，直接复用。首页删除后，「重新提交」失败任务的入口保留在历史页（已存在）与状态带的"最近一次打印"上。

---

## R8. 字体

**决定**：
- **Inter**：随包提供子集 woff2（Latin + 数字 + 常用标点，Regular 400 与 Medium 500，各约 30–50 KB），放 `packages/web/public/fonts/subset/`，在 `fonts.css` 声明；`--font-sans: 'Inter', 'Noto Sans CJK SC', …`。**不用 CDN**：这是局域网设备，可能无外网。Inter **不是**标签渲染字体，不得出现在编辑器的字体选项与服务端 `FONT_FAMILIES` 里（`fonts.css` 注释：族名必须与服务端一致——那是对*渲染*字体说的）。子集用仓库已有的 `scripts/subset-fonts.py` 流程生成，来源文件走 `scripts/fetch-fonts.sh` 同一套方式记录。
- **衬线体**：`Noto Serif CJK SC` 的 `@font-face` **保留**——它是标签的可选渲染字体（`editor.fonts.serif: '宋体'`），画布上用到它时必须能加载。删除的是 `--font-display` 及所有把它用于界面标题的规则。`font-display: swap` 下浏览器只在有元素使用时才下载，所以"首屏不加载衬线"（SC-008）成立。测试：扫描源码，`font-display`/`font-serif`/`Noto Serif` 不得出现在 `.tsx` 与 `index.css` 的非 `@font-face` 规则中。
- 标题字重：`h1–h6` 与 `PageHeader` 用 `font-medium`（500），不再 `font-semibold/bold`。

---

## R9. 「模板」→「标签」文案清扫

**决定**：`zh-CN.ts` 里 22 处「模板」全部改写（`templates.*`、`index.*`、`workspace.tabs.*`、`preview.needsTemplateForSequence`、`history.template/adHoc`、图片清理文案等）。键名不改（英文、内部用）。新增测试 `terminology.test.ts`：递归遍历 `copy` 对象的所有字符串（含函数返回值用代表参数调用），断言不含「模板」；`en-US.ts` 同步改 "template" → "label" 以保持 `i18n-completeness` 通过。「标签页」（浏览器 tab）一词在第 3 步后只出现在 `leavePrompt` 等浏览器语境，与实体名不冲突——但为避免歧义，实体相关文案里不再用「标签页」指代浏览器 tab，改用「窗口」。

---

## R10. 对比度与"唯一的白"的自动验证

**决定**：重写 `design-tokens.test.ts`：
1. 从 `index.css` 解析 `@theme` 里的十六进制值（Nocturne 给的是 hex，直接存 hex，不转 oklch——"一个 token 不动"），用 WCAG 公式计算：`foreground/background ≥ 4.5`、`muted-foreground/background ≥ 4.5`、`accent-300/background ≥ 4.5`（正文字号的强调文字）、`accent/background ≥ 3`（线与大字）、`border/background ≥ 1.2`（装饰线不设门槛，只防不可见）。
2. `#ffffff`/`white`/`bg-white` 在 `src/**` 中只允许出现在 `.paper` 的定义处；`thumbnail-frame.tsx` 现有的 `bg-white` 改为 `.paper`。
3. 现有的 Tailwind 调色板扫描保留。

---

## R11. 第 2 步在标签页栏下的接入方式

**决定**：`EditorPage` 接收 `draftKey`（`templateId` 或本地 `draftId`），内部用 `useDraft(draftKey)` 读写；标签页栏时代 `WorkspaceTab` 增加 `draftId` 字段（未命名标签的稳定键，替代 `draftNumber` 作为身份，编号仍用于标题）。打开标签页 → 若有草稿则以草稿内容初始化 `history`（含 `past`）；关闭标签页 → 确认框文案改为 FR-026a 的说法，关闭后草稿仍在。`hasUnsavedWork` 仍驱动 `beforeunload`，但因为草稿已落盘，第 2 步把 `beforeunload` 提示改为只在 `unpersisted` 草稿存在时触发（FR-025）。

---

## R12. 测试项目划分

| 逻辑（Node） | 界面（happy-dom） |
|---|---|
| `drafts/store.ts`（读写、zod 校验、配额降级、索引） | 画廊：格子按比例、记号、排序、空状态、缩略图含第一行值 |
| `drafts/trim.ts`（撤销栈裁剪到 50、降级时丢栈） | 编辑器：离开再回来内容与撤销在；FR-027 警告；409 另存 |
| `drafts/version.ts`（基线比较、另一窗口判定） | 状态带：三类信息与三种空态 |
| `templates/thumbnail-values.ts`（第一行 → values，缺列留空） | 打印框：已探测画/未探测不画 |
| `print/head-figure.ts` | 8 个页面各一条渲染断言（`render-smoke` 重写） |
| `app/status-summary.ts` | 设置页无主题选项（已有，保留） |
| `design-tokens.test.ts`、`terminology.test.ts`、`fonts.test.ts`（源码扫描） | 第 2 步：关闭确认框文案；第 3 步：无标签页栏、无首页 |

覆盖率名单（`vitest.config.ts` include）新增：`packages/web/src/features/drafts/*.ts`、`packages/web/src/features/print/head-figure.ts`、`packages/web/src/features/templates/thumbnail-values.ts`。
