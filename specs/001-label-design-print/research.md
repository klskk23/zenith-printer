# Phase 0：研究与技术决策

**Feature**: 001-label-design-print | **Date**: 2026-08-20

本文件记录 Technical Context 中需要论证的选择，以及尚未验证、可能推翻设计的硬件假设。
九个架构分支的完整推导见 [`docs/design-consensus.md`](../../docs/design-consensus.md)，
此处只记录该文档未覆盖或需要收紧的部分。

---

## 1. 矢量渲染器：`@resvg/resvg-js`

**Decision**: 采用 `@resvg/resvg-js@2.6.2`，配置 `loadSystemFonts: false` + `fontFiles`。

**Rationale**: 宪章「渲染确定性」条款要求同一模板在任意机器上逐像素一致。已核实 2.6.2 的
类型定义提供全部所需选项：

```ts
loadSystemFonts?: boolean   // 设为 false 后完全不碰系统 fontconfig
fontFiles?: string[]        // 直接指定字体文件路径
fontDirs?: string[]
defaultFontFamily?: string
```

**Alternatives considered**:

- **`sharp` 渲染 SVG** —— 已否决并写入宪章。其链路为 `sharp → libvips → librsvg → fontconfig
  + pango + harfbuzz`，文字渲染完全依赖系统字体栈。社区长期痛点（lovell/sharp#1549、#2399、
  #2936）：`.otf` 常不识别、macOS 与 Linux 行为不同、容器内未执行 `fc-cache` 即渲染为豆腐块、
  sharp 版本升级会改变渲染结果。对标签打印不可接受。
- **`node-canvas`** —— 需要 cairo 原生编译链，且同样依赖系统字体配置，未解决根本问题。
- **Puppeteer/无头浏览器** —— 能保证与前端预览完全一致，但引入整个浏览器运行时，
  对单进程本机部署过重，且启动延迟无法满足单张渲染 <200ms。

## 2. 像素获取路径：绕过 PNG 编解码

**Decision**: 使用 `RenderedImage.pixels`（RGBA `Buffer`）直接构造 `ImageSource`，
不经 `asPng()`。

**Rationale**: 已核实 2.6.2 的 `RenderedImage` 同时提供 `asPng(): Buffer` 与
`get pixels(): Buffer`（注释为 "Get the RGBA pixels of the image"）。省去一次 PNG 编码与
一次解码，且二值化阈值完全由己方控制，不受 `sharp.threshold()` 的行为约束。

**⚠️ 实现陷阱**: `niimblue-node` 的 `SharpImageSource` 用 `buffer.at(idx) !== 0xff` 判断像素，
那是**单通道灰度**索引（它先执行了 `.toColorspace("b-w")`）。resvg 给出的是 **RGBA 四通道**，
索引必须 `× 4`。这是静默错误——不会抛异常，只会打出一张乱码图。该处必须有单元测试覆盖。

## 3. 精臣驱动：直接依赖 `niimbluelib`，不依赖 `niimblue-node`

**Decision**: 仅依赖 `@mmote/niimbluelib`；`niimblue-node` 已从仓库移除。

**Rationale**: `niimbluelib` 已定义平台无关接口，`ImageEncoder.encode(source, printDirection)`
是公开 API：

```ts
interface ImageSource {
  readonly width: number
  readonly height: number
  isPixelNonWhite(x: number, y: number, printDirection: PrintDirection): boolean
}
```

`niimblue-node` 的全部增量只是一个 30 行的 `SharpImageSource` 适配器。既然本项目从 resvg 取
RGBA，自行实现 `ResvgImageSource` 更直接。

其 `server/worker.ts` 持有全局单例 `let client: NiimbotAbstractClient | null = null`，
一次只能连一台打印机，与多打印机目标冲突；当库使用则无此限制（`printImages(client, ...)`
完全无状态）。

**参考但不复制**：`printImages` 的页循环、`SharpImageSource` 中 `printDirection === "left"`
的旋转索引变换（该变换容易推错，应移植而非重新推导）。

**不使用 `initClient`**：它把 `printprogress`、`heartbeatfailed` 全部 `console.log` 掉了。
应直接 `new NiimbotNodeSerialClient()` 并自行挂载监听，否则拿不到逐页进度——而那是 100 份
任务唯一的进度来源（FR-020、FR-035）。

**print task 取值**：B3S_P 使用 **`B1`**。已核实完整枚举为 `D11_V1 · D110 · B1 · B21_V1 ·
B21_L2B · D110M_V4 · H1S`，共 7 个，**不存在 `P1`**。

## 4. 请求校验：`fastify-type-provider-zod`

**Decision**: `fastify@5.12.1` + `zod@4.4.3` + `fastify-type-provider-zod@7.0.0`。

**Rationale**: 宪章要求所有外部输入经 zod schema 校验。该 type provider 的 peer 依赖为
`fastify: ^5.5.0` 与 `zod: >=4.1.5`，与选定版本兼容（已核实）。它让路由 schema 与 TypeScript
类型来自同一处定义，消除「schema 与类型不同步」这一类 bug。

**注意**: `niimblue-node` 使用的是 zod 3.x；本项目采用 zod 4.x。二者 API 有差异，
移植其 schema 代码时需要调整。

## 5. 持久化：`node:sqlite`

**Decision**: Node.js 26 内建的 `node:sqlite`，无外部依赖（已在目标环境验证可用）。

**Rationale**: 消除 `better-sqlite3` 的原生编译依赖，简化部署（宪章原则 V 要求文档化原生模块
的安装前置条件——不引入即无需文档化）。本项目数据量在个位数用户、数千条任务历史的量级，
内建实现完全够用。

**Alternatives considered**: `better-sqlite3` 性能更好但需 node-gyp 编译链；
JSON 文件存储无法满足序号区间的原子分配（见第 7 节）。

## 6. 测试运行器：`vitest`

**Decision**: `vitest` + `@vitest/coverage-v8`，前后端共用。

**Rationale**: 前端本就是 Vite，共用同一运行器避免维护两套配置与两套 mock 机制。
V8 覆盖率可直接支撑宪章的 ≥80% 门槛。真机测试以 `*.hardware.test.ts` 命名并默认 `exclude`，
满足「需要真实硬件的测试 MUST 单独标记并从默认套件中隔离」。

## 7. 序号区间的原子分配

**Decision**: 序号区间在**任务入队时**于单个数据库事务内分配并写入任务记录（FR-049）。

**Rationale**: 澄清问题 3 确定「系统建议 + 用户可覆盖」，问题 5 确定崩溃时「区间视为已全部
消耗」。二者合起来要求区间必须在入队时就落盘——若延迟到开始打印时才计算，先后入队的两个任务
会读到同一个「已消耗最大值」，产生重号。

分配逻辑：在事务中读取该字段历史最大已消耗序号 → 校验用户覆盖值（若有）→ 写入
`[start, start + copies × step)` 区间 → 提交。SQLite 的写事务串行化天然提供所需的互斥。

**统一原则**：**跳号无害、重号有害**。三条决定共同遵循它——入队时锁定区间防并发重号、
崩溃时视为全消耗防崩溃重号、位数溢出时拒绝而非回绕（FR-046）。

## 8. 幂等打印提交

**Decision**: `POST /api/print-jobs` 要求客户端提供幂等键（`Idempotency-Key` 头）。

**Rationale**: 宪章 III.0 要求「消耗耗材或不可撤销的操作 MUST 要求显式确认，MUST NOT 由
隐式或幂等重试触发」（FR-017）。打印是不可撤销的物理动作，浏览器刷新或网络重试导致的重复
提交会直接浪费耗材、并错误消耗一段序号。服务端以幂等键去重，重复请求返回原任务而非新建。

## 9. 前端数据层：轮询而非推送

**Decision**: `@tanstack/react-query` 轮询任务状态，不引入 WebSocket/SSE。

**Rationale**: 澄清阶段已确定前端感知方式为轮询。100 份任务约 3 分钟，2 秒一次的轮询足够，
且无需维护长连接的重连、心跳与背压。个位数并发用户下轮询开销可忽略。

---

## 硬件实测：结果

**7 项中 6 项已实测**，其中两项的结论与原假设不符。第 1 项仍在观察中。

| # | 待验证 | 状态 | 结论 |
|---|---|---|---|
| 1 | `setAutoShutDownTime(4)` 是 60 分钟还是**永不** | 🟡 长期观察 | 写入已确认（`probe` 显示 `autoShutdownTime: 4`）。截至 2026-08-21 实际使用中**未观察到设备离线**——倾向于「永不」，但一次未复现不足以定论，转入日常使用中继续观察 |
| 2 | 精臣 serial 握手耗时 | ✅ | **124 ms** —— 按需连接开销可忽略，无需「正在唤醒」提示 |
| 3 | PC310T 切至 ZSim 后 `^GF` 定位 | ✅ | **正确出图**，整张位图方案成立 |
| 4 | ZSim 是否支持 `:Z64:` | ✅ | **支持**，压缩比 15.8×，保持 `z64` 为默认 |
| 5 | PC310T 单张 `^GF` 缓冲上限 | 🟡 部分 | 单次 24 KB 正常接收；满幅长标签未测 |
| 6 | 第三方纸的 `rfidInfo()` 行为 | ✅ | ⚠️ **不抛异常**，与原假设相反 |
| 7 | 1 dot 线宽是否可见 | ✅ | **可见**，默认阈值 128 无需调整 |

### #2 —— 握手 124 ms

```json
{ "handshakeMs": 124, "modelMetadata": { "model": "B3S_P", "dpi": 203, "printheadPixels": 576 } }
```

按需连接的开销可以忽略，UI **不需要**「正在唤醒打印机…」这类提示。
能力参数与 `docs/B3S_P.info` 完全一致（dpi 203、printheadPixels 576、密度 1–5、paperTypes [1,2,3,5]）。

**顺带证实了一个设计前提**：`detectedPrintTask` 返回 `null`。
`getPrintTaskType()` 对 B3S_P 无法探测，这正是「print task 必须手选」的依据（第 3 节、FR-024）——
现在有了实测证据，不再只是从上游代码推断。

### #3 / #4 / #5 —— 霍尼韦尔 PC310T @ 10.72.1.10:9100

50×30mm（400×240 dot）测试标签，两种编码各打一张：

| 编码 | 载荷 | 结果 |
|---|---|---|
| `:Z64:` | **1 519 字节** | ✅ 正常出图，定位正确 |
| 纯 hex | **24 041 字节** | ✅ 正常出图，定位正确 |

**#3**：整张 `^GF` + `^LH0,0` 在 ZSim 下定位正确。首版「两侧都走位图」的决定不必推翻，
也无需为 ZSim 的字体与码制差异逐个排雷。

**#4**：ZSim **支持** `:Z64:`，压缩比 **15.8×**。驱动保持 `z64` 为默认。
这个差异在大标签上会放大：满幅 104×150mm（832×1198 dot）原始位图约 124 KB，
hex 约 249 KB，Z64 后约 15 KB 量级。

**#5**：hex 形式的 24 041 字节单次写入无异常，接收缓冲至少能吃下这个量。
**但满幅长标签未测**——若某天被迫回退到 hex 且要打 104×150mm，249 KB 的单次写入是否安全无据。
由于 Z64 已确认可用，实际载荷会一直停在 KB 量级，这条限制短期内触不到；
一旦发现 Z64 在某些固件上失效，需重测此项。

### #6 —— 第三方纸不抛异常 ⚠️ 与原假设相反

| 耗材 | `rfidInfo()` 返回 |
|---|---|
| 原厂 RFID 纸 | `{ tagPresent: true, allPaper: 216, usedPaper: 6, capacity: 180, barCode: "6975746638852" }` |
| 第三方纸 | `{ tagPresent: false, allPaper: -1, usedPaper: -1, consumablesType: 0 }` |

**原假设是「抛异常」，实际是正常返回**。这个差异有实际后果：若按「读到值就当余量」实现，
第三方纸的 `allPaper: -1` 会被算成负余量，于是**每一个任务都会被判定耗材不足而拒绝打印**。

现有实现恰好正确——守卫是 `if (rfid.tagPresent && rfid.allPaper > 0)`，两个条件都不满足，
`remainingLabels` 保持 `null`，预检放行（FR-016）。但**代码注释原本写的是「第三方纸抛异常」，已纠正**，
并补了三条基于真实返回值的测试。

### #7 —— 1 dot 线宽可见

以默认阈值 128 实打，一个点宽的横线在纸上清晰可见。
`binarize.ts` 的 `DEFAULT_THRESHOLD` 保持 128，FR-008「最小 1 dot」的判据成立。

### 一处待确认的语义

原厂纸同时返回 `allPaper: 216` 与 `capacity: 180`，两者不一致。
当前按 `allPaper - usedPaper` 计算余量（= 210）。若 `capacity` 才是整卷张数，
预检会高估约 30 张，表现为「说够但打到一半没纸」。这需要打完一整卷才能验证，暂按 `allPaper` 处理。

---

## 第 1 项：自动关机（观察中）

`AutoShutdownTime` 枚举的官方注释（库自身亦不确定）：

```ts
enum AutoShutdownTime {
  ShutdownTime1 = 1,  /** Usually 15 minutes. */
  ShutdownTime2 = 2,  /** Usually 30 minutes. */
  ShutdownTime3 = 3,  /** May be 45 or 60 minutes (depending on model). */
  ShutdownTime4 = 4,  /** May be 60 minutes or never (depending on model). */
}
```

niimblue CLI 未暴露该命令（仅 print/info/scan/server/flash），必须经
`abstraction.setAutoShutDownTime()` 调用——这是 `@zenith/cli` 存在的首要理由。

### 保活：对付自动关机的第二条路

读 `niimbluelib` 的 `abstract_client.js` 发现，**客户端在 `connect` 事件上自动启动心跳**：

```js
this.on("connect", () => this.startHeartbeat());
// startHeartbeat: setInterval(() => this.abstraction.heartbeat(), this.heartbeatIntervalMs)
// 默认 1000ms，可经 setHeartbeatInterval() 调整
```

每次心跳是一次**真实的协议收发**，因此保持连接很可能会重置打印机的空闲计时器。
「很可能」不等于「确定」，而这个答案决定队列**能否**保持长连接——它与
「按需连接」的决策直接冲突。

两条路解决同一个问题，应在同一次实测中一并验证：

| 方案 | 命令 | 结论含义 |
|---|---|---|
| 设备级：请求永不休眠 | `zenith set-shutdown -a /dev/ttyACM0 --time 4` | 成功则问题在设备层消失，无需保活 |
| 连接级：持续心跳 | `zenith keepalive -a /dev/ttyACM0 --minutes 75` | 成功则「常连接」重新成为可选项，需重新评估 B 分支 |

`keepalive` 命令会在心跳首次失败时立即停止并报告发生时刻——那正是打印机睡着的样子。

**当前进度**：`set-shutdown --time 4` 已写入并读回确认（`probe` 显示 `autoShutdownTime: 4`），
剩下 70 分钟闲置观察。

**顺带发现两个上游缺陷**（均不影响本项目，但值得记录）：

1. `isHeartbeatStarted()` 的返回值是反的：
   ```js
   isHeartbeatStarted() { return this.heartbeatTimer === undefined }  // 应为 !==
   ```
2. 心跳失败时库内直接 `console.error(e)`，绕过任何结构化日志——这是不使用
   `initClient` 之外，又一个需要自行掌控事件的理由（宪章原则 V）。

---

## 遗留至设计阶段的边界情况

规格的 Edge Cases 中有 15 条刻意保留为开放问题。以下几条在 Phase 1 设计中一并决定，
其余属实现细节：

| 边界情况 | 处理方向 |
|---|---|
| 删除仍被历史快照引用的图片资源 | 图片改为引用计数 / 软删除，保证 FR-051「历史引用的图片 MUST 保持可解析」 |
| 用户覆盖的起始值与已消耗区间冲突 | 允许覆盖但返回警示，不阻断（用户可能有意重打报废批次） |
| 两位用户同时编辑同一模板 | 后写覆盖 + 保存时基于 `updatedAt` 的乐观检查，冲突时提示而非静默丢弃 |
| 装纸尺寸与模板尺寸不符 | 精臣的 `RfidInfo` 不含尺寸字段，**无法自动检测**；仅能在 UI 上提示用户自行确认 |
| 任务历史无界增长 | 快照使记录变大，但该量级下可接受；不做自动清理，提供手动清除入口 |
