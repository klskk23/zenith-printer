# Zenith Printer 设计共识

**状态**：可行性讨论已收口，作为 `/speckit.specify` 的输入
**日期**：2026-08-20
**范围**：标签设计与打印环境的整体架构共识。不含实现细节，不含批量打印与外部数据源（已明确推迟）。

---

## 1. 项目目标

一个部署在本机的标签设计与打印环境：

- 他人通过局域网 web 端设计标签并提交打印任务
- 打印机接入本机（精臣走 USB 串口）或本机所在网络（霍尼韦尔走以太网）
- 适配多种标签打印机，首批两台：**精臣 B3S_P**、**霍尼韦尔 PC310T**

---

## 2. 硬件与接入方式

| 打印机 | 接入 | 地址 | 命令层 | DPI | 幅宽 |
|---|---|---|---|---|---|
| 精臣 B3S_P | USB CDC 串口 | `/dev/ttyACM0` | NIIMBOT 二进制协议（niimbluelib） | 203 | 576 dot ≈ 72.1 mm |
| 霍尼韦尔 PC310T | **以太网**（静态 IP） | `<ip>:9100` raw TCP | **ZSim**（ZPL II 模拟器） | 203 | 832 dot ≈ 104 mm |

> 两台设备均已实测出图：B3S_P @ `/dev/ttyACM0`（握手 124 ms），PC310T @ `10.72.1.10:9100`（`^GF` 定位正确）。

**要点**

- PC310T **不挂载在本机**，是网络端点。raw TCP 9100 不需要驱动、不需要 CUPS、不需要 root。
- PC310T 的以太网/蓝牙/WiFi 均为选配模块；本项目使用的是以太网型号。
- ZSim 需在打印机内置网页或 PrintSet 5 中切换为当前命令语言。

### 2.1 精臣 print task

`niimbluelib` 的完整 print task 列表（共 7 个）：

```
D11_V1 · D110 · B1 · B21_V1 · B21_L2B · D110M_V4 · H1S
```

**B3S_P 使用 `B1`**，已实测验证：

```bash
niimblue-cli print -t serial -d -a /dev/ttyACM0 -p B1 -o top \
  docs/samples/label_15x30.png --label-width 400 --label-height 240
```

> ⚠️ **不存在 `P1` 这个 print task。** 早期笔记中的「机型 P1」是对 `-p B1` 的误读（`-p` 是 `--print-task` 的短选项）。`printTaskNames` 在库中是枚举类型，填错会被直接拒绝。

### 2.2 B3S_P 设备元数据

见 `docs/B3S_P.info`。关键字段：

```
model: 'B3S_P'   id: [272]        dpi: 203
printDirection: 'top'             printheadPixels: 576
paperTypes: [1,2,3,5]             densityMin: 1  densityMax: 5  densityDefault: 3
autoShutdownTime: 3               ← 1 小时闲置关机
```

---

## 3. 整体架构

```
浏览器  Vite + React + Tailwind + shadcn/ui
        编辑器 = SVG DOM（非 canvas）
           │  IR (JSON, mm 坐标)
           ▼
Fastify (Node + TypeScript) ── 单进程，同时托管前端静态文件
   ├─ SQLite: Device / Profile / Template / 任务历史
   ├─ 每台打印机一个串行 FIFO 队列（内存）
   └─ 渲染管线
        IR ──[ ir-to-svg  ★前后端共享模块 ]──▶ SVG
                                    (条码由 bwip-js 生成并内嵌)
              └─▶ resvg-js（打包字体, loadSystemFonts: false）
                    └─▶ RGBA ──▶ 二值化 ──▶ ImageSource
                          ├─▶ 精臣    niimbluelib ImageEncoder.encode()
                          │            → serial /dev/ttyACM0，按需连接
                          └─▶ 霍尼韦尔 ^GF + :Z64:，分批发送
                                       → TCP 9100，按需连接
```

---

## 4. 分支决策

### A. 中间表示：统一 Label IR

- 前端 canvas 不直接出图。**IR 是一份 JSON**：元素列表（text / barcode / qrcode / image / line / rect）+ mm 坐标 + 样式。
- **模板绑定具体设备，不跨机器复用**（50×30mm 的精臣模板放不进 104mm 的 PC310T）。
- **但 IR 只有一门语言。** 模板不通用 ≠ IR 不通用。为两台机器各搞一套 IR 会让编辑器、模板存储、数据绑定、预览全部写两遍，且第三台打印机接入时成本线性叠加。

**渲染策略（分两步走）**

| 阶段 | 精臣 | 霍尼韦尔 |
|---|---|---|
| **首版** | IR → 位图 | IR → 位图 → 整张 `^GF`（配 `:Z64:` 压缩） |
| **后续优化** | 无变化（只吃位图） | 逐元素原生化，**先条码**（`^BC`/`^BQ`），再西文文字 |

首版两侧共用同一套渲染代码，ZSim 只需踩「一张图能不能打对位置」这一个坑。**优化时 IR 层完全不动。**

**为什么后端必须能独立渲染**：后续要接外部数据源做批量打印，那个场景下没有前端在场。「前端出图传后端」这条路从一开始就是死的。

### B. 队列 / 取消 / 暂停

| 项 | 决策 |
|---|---|
| 连接生命周期 | **按需**：每个 job 开 → 打 → 关。两条链路语义一致 |
| 队列 | 每台打印机一个串行 FIFO，内存态 |
| 提交语义 | 立即返回「已排队」+ 任务 ID，不阻塞 |
| **取消** | **只能取消未开始的任务** = 从队列移除。正在打印的任务不可中断 |
| **暂停** | **暂停的是队列**，不是打印。标记该机为暂停 → 不再派发新任务 → 当前任务打完为止 |

**推论**：取消不作用于进行中的任务，因此 `printImages` 的页循环**无需改造成带中断点**，可原样使用。

**为什么不做页级暂停**：`AbstractPrintTask` 没有 pause/resume/abort。应用层挂起只能撑秒级——受 `pageTimeoutMs`、心跳（失败 5 次自动断开）、1 小时自动关机三重夹击。而换纸/加碳带是分钟级场景，长暂停必须升级为「中断 + 断点续打」，要持久化进度并处理恢复时设备状态已变，代价与收益不成比例。按需连接下一个 100 张任务几分钟就跑完，等它打完再换纸完全可接受。

**霍尼韦尔分批发送**：仍然逐张/分批发，理由是**进度反馈 + 接收缓冲区安全**（不再是为了取消）。

### C. 三实体模型

| 实体 | 谁维护 | 内容 | 何时变 |
|---|---|---|---|
| **Device** | 地址与 print task **手填**，其余**连上后探测**；含可写设置 | 传输类型+地址、print task / 命令语言；DPI、printheadPixels、序列号、固件版本、densityMin/Max、paperTypes | 插上新机器 |
| **Profile** | 用户编辑，绑 Device | 密度、速度、labelType（gap/黑标/连续）、**偏移校正**、打印方向 | 换纸批次、调效果 |
| **Template** | 用户编辑，绑 Device | 画布 mm 尺寸 + IR 元素布局 | 业务需求变 |

打印时 = `Template × Profile × Device` 运行时组合，**不预先绑死**。

- 换同尺寸的纸 → 只改 Profile，模板一个都不碰
- 换不同尺寸的纸 → 模板本来就得重做
- Template → Profile 默认 N:1（同一模板一般不切参数），但**数据模型上不绑死**——零成本的保险

**手填 vs 探测的划分原则**：手填的是「怎么找到它、怎么跟它说话」，探测的是「它是什么」。print task 归手填，因为 `getPrintTaskType()` 探测不可靠（`worker.ts` 里就有 `"Unable to detect print task, please set it manually"` 分支）。

### D. 依赖与进程拓扑

**只依赖 `@mmote/niimbluelib`。`niimblue-node` 已删除。**

理由：`niimbluelib` 已定义平台无关接口

```ts
interface ImageSource {
  readonly width: number
  readonly height: number
  isPixelNonWhite(x: number, y: number, printDirection: PrintDirection): boolean
}
ImageEncoder.encode(source: ImageSource, printDirection?): EncodedImage   // 公开 API
```

`niimblue-node` 做的只是加了个 30 行的 `SharpImageSource` 适配器。本项目自己实现 **`ResvgImageSource`**（直接读 resvg 的 raw RGBA buffer）反而更好——跳过 PNG 编码/解码，二值化阈值自己控制。

**参考但不依赖**：`printImages` 的页循环、`SharpImageSource` 的 `printDirection === "left"` 旋转索引变换（容易写错，别自己推）。

> ⚠️ **抄索引变换时注意**：`SharpImageSource` 用 `buffer.at(idx) !== 0xff`，那是**单通道灰度**（先做了 `.toColorspace("b-w")`）。resvg 给的是 **RGBA 四通道**，索引要 `× 4`。这是静默错误——不崩，只会打出乱码图。

**不使用 niimblue-node 的 server 模式**：它是全局单例（`let client: NiimbotAbstractClient | null = null`），一次只能连一台打印机。当库用则无此限制——`printImages(client, ...)` 完全无状态。

**事件监听**：不要用 `initClient`（它把所有事件 `console.log` 掉了）。直接 `new NiimbotNodeSerialClient()` 自己挂：

```ts
client.on("printprogress", e => /* e.page, e.pagesTotal, e.pagePrintProgress, e.pageFeedProgress */)
client.on("heartbeatfailed", e => /* e.failedAttempts */)
```

100 张的任务，这是唯一的进度来源。

### E. 单位与坐标系

- **存储一律 mm**（浮点），渲染时换算
- **UI 按 dot 步进**（203dpi 下 1 dot = 0.125mm，让用户敲 0.125 的倍数是反人类的）

```
dot = round(mm × dpi / 25.4)
```

三条必须遵守的规则：

1. **取整统一用 `round`，禁用 `floor`。** `50 × 203 / 25.4 = 399.6` → round 得 400，floor 得 399。
2. **画布尺寸先 round 成整数 dot，元素坐标全部基于这个 dot 网格计算**，不要每个元素独立从 mm 换算——否则误差累积，右边缘元素可能偏移 2–3 dot。
3. **幅宽上限从 Device 元数据读取，在编辑器里就限制画布宽度。** 超出会被静默裁掉，不报错。

**`printDirection` 会互换宽高语义**：`left` 是顺时针旋转 90°。B3S_P 元数据为 `top`，实测也用 `top`——保持一致，不要碰 `left`。

### F. 渲染与前端

| 项 | 决策 |
|---|---|
| 前端栈 | Vite + React + Tailwind + shadcn/ui |
| 编辑器渲染 | **SVG DOM**（放弃 canvas） |
| 后端渲染 | `@resvg/resvg-js`，`loadSystemFonts: false` + 打包字体文件 |
| IR→SVG | **前后端共享的同一个 TS 模块** |
| 条码 | `bwip-js` 生成 SVG 片段内嵌 |
| 字体 | 限定打包字体；前端子集版（约 2–3MB）、**后端全量版** |
| 精确预览 | 不做 |

**为什么不用 sharp 渲染 SVG**：`sharp → libvips → librsvg → fontconfig + pango + harfbuzz`。文字渲染完全依赖系统字体栈——`.otf` 经常不认、macOS 与 Linux 行为不同、容器里不跑 `fc-cache` 就是豆腐块、sharp 版本升级会改变渲染结果。对标签打印不可接受（同一模板在开发机和生产机打出来字体不同，排查要人命）。resvg-js 的 `fontFiles` + `loadSystemFonts: false` 能做到任何机器上逐像素一致。sharp 保留用于二值化和格式转换。

**为什么不用 canvas**：canvas 库（fabric/konva）会导致前端 Canvas2D 与后端 resvg 两套完全不同的渲染引擎，预览与实物的差异是系统性的、无法收敛。SVG 路线下每个图形是真实 DOM 节点，选中/拖拽/缩放的交互反而更好写。

**二值化约束（写进 IR schema）**

| 规则 | 原因 |
|---|---|
| 线宽以 **dot 为单位、取整数**，最小 1 dot | 小于 1 dot 的线经抗锯齿+threshold 后会**整条消失** |
| 水平/垂直线坐标 **snap 到整数 dot 网格** | 否则一条线被摊到两行像素，二值化后变两条淡线或消失 |
| **不提供半透明、渐变、阴影** | 二值化后行为不可预测，schema 层面直接砍掉 |
| 斜线锯齿**接受** | 热敏打印机本就是点阵，无解 |

**字体体积**：中文字体很大（Noto Sans SC Regular 的 ttf 约 10–16MB）。前端用 GB2312 子集版（6763 字，压到 2–3MB），后端用全量版。代价是用户打生僻字时**前端预览显示豆腐块，但实物是对的**。

建议最小集合 4 个文件：黑体 Regular / Bold、宋体 Regular、等宽一款（条码下方数字用等宽更整齐）。

### G. 多用户

**不做认证，谁都能取消任何任务。**

代价：**严禁暴露公网。** 无认证 + 公网 = 任何人都能提交任务、取消他人任务、打光标签纸。VPN 边界是唯一防线。

### H. 状态反馈与错误处理

| 项 | 决策 |
|---|---|
| 任务失败 | 标记失败，**人工重新提交**（不做自动续打） |
| 失败后队列 | **自动暂停这台打印机**，需人工恢复 |
| 打印前预检 | 有 RFID → 校验余量，超量**拒绝**；无 RFID（第三方纸）→ 跳过，照打 |
| 错误信息 | `PrintError.reasonId` 映射 53 个 `PrinterErrorCode` 到中文可读文案 |
| 前端感知 | 轮询 |
| 队列持久化 | **内存队列**（重启丢弃排队任务）+ **任务历史落 SQLite**（「我打了几张」的唯一凭证） |

**任务实体必须记录 `pagesPrinted`。** 打到 37/100 失败时，用户重新提交需要知道还差 63 张，列表要显示「已打印 37 / 共 100」——否则只能自己数实体标签。

**精臣能在开打前就知道纸够不够**（霍尼韦尔无此能力，`~HS` 只能查有无纸）：

```ts
interface RfidInfo   { allPaper: number; usedPaper: number; ... }
interface HeartbeatData { paperInserted?: boolean; lidClosed?: boolean; chargeLevel?; temp? }
```

预检流程：`heartbeat()` 检查纸/盖/电量 → `rfidInfo()` 检查 `allPaper - usedPaper >= N` → 不够则直接拒绝并告知「这卷纸只剩 42 张，你要打 100 张」。**这是把「中途没纸」从事后处理变成事前预防，比任何错误恢复机制都值钱。** UI 需能表达两侧预检能力的不对等。

常见错误码：`CoverOpen=1` `LackPaper=2` `Overheat=7` `PaperOutException=8` `NoRibbon=13` `WrongRibbon=14` `WrongPaper=16` `B3sAbnormalPaperOutput=27` `ReceiveDataTimeout=52`

### I. 运行时与部署

| 项 | 决策 |
|---|---|
| 访问边界 | **局域网 + VPN，不暴露公网**；认证后续再做 |
| 后端框架 | **Fastify**（内建 schema 校验，契合宪章「zod 边界校验」） |
| 部署形态 | **单进程**：Vite build 静态文件由后端托管，一个 systemd service |
| 数据 | SQLite（Device / Profile / Template / 任务历史） |
| PC310T 地址 | **静态 IP**，不需要发现机制 |

### J. 批量打印与外部数据源

**明确推迟到后续 spec。** 但架构已为它预留：后端具备独立渲染能力（这正是 F 分支选 resvg 而非「前端出图」的根本原因）。

典型量级：**一次 100 张以内**。该量级下「每张服务端渲染一次」的代价完全可以吞（秒级）。

---

## 5. 必须实测的假设

以下结论建立在假设上，尚未验证：

| # | 待验证 | 方法 | 影响 |
|---|---|---|---|
| 1 | **`setAutoShutDownTime(4)` 对 B3S_P 是 60 分钟还是永不** | 设置 → `getAutoShutDownTime()` 读回确认 → 放置 70 分钟观察 | **最关键**，见风险 1 |
| 2 | 精臣 serial 连接握手耗时 | CLI `-d` 打时间戳，测从命令到出纸 | 决定「按需连接」的感知延迟、是否需要「正在唤醒」提示 |
| 3 | PC310T 切到 ZSim 后 `^GF` 定位是否正确 | 打印机网页 / PrintSet 5 切换，送一张测试图 | 阻塞霍尼韦尔链路 |
| 4 | ZSim 是否支持 `:Z64:` 压缩 | 送压缩与非压缩两版对比 | 不支持则传输量约翻 4 倍 |
| 5 | PC310T 接收缓冲区能吃多大一张 `^GF` | 逐步加大单张体积 | 决定分批粒度 |
| 6 | 第三方纸（无 RFID）时 `rfidInfo()` 的行为 | 装非 RFID 纸调用 | 抛异常还是返回空，决定「跳过检查」怎么写 |
| 7 | 1 dot 线宽经 resvg + 二值化后是否可见 | 渲染测试图实打 | 决定最小线宽规则 |

`AutoShutdownTime` 枚举的官方注释（库自己也不确定）：

```ts
enum AutoShutdownTime {
  ShutdownTime1 = 1,  /** Usually 15 minutes. */
  ShutdownTime2 = 2,  /** Usually 30 minutes. */
  ShutdownTime3 = 3,  /** May be 45 or 60 minutes (depending on model). */
  ShutdownTime4 = 4,  /** May be 60 minutes or never (depending on model). */
}
```

CLI 未暴露此命令（只有 print/info/scan/server/flash），需写代码调 `abstraction.setAutoShutDownTime()`。

---

## 6. 已知风险

| 风险 | 影响与应对 | 实测结论（2026-08-21） |
|---|---|---|
| **B3S_P 1 小时自动关机 + 无法 USB 唤醒（必须手按电源）** | 闲置一小时后的第一个任务**必然失败，需要人到现场按电源键**。须给出明确 UI 提示而非裸的连接超时 | 🟡 `setAutoShutDownTime(4)` 写入成功，70 分钟观察中。另发现第二条路：`niimbluelib` 连接后自动每秒心跳，保持连接可能重置空闲计时器（`zenith keepalive` 可验证） |
| **ZSim ≠ ZPL** | 字体度量与图形行为与真 Zebra 有出入。首版走整张 `^GF` 可规避大部分 | ✅ **已验证**：`^GF` + `^LH0,0` 在 PC310T 上定位正确；`:Z64:` 压缩也被接受（15.8×）。首版方案成立，未踩任何 ZSim 差异 |
| **中文字体子集化** | 生僻字在前端预览显示豆腐块（后端全量版，实物正确） |
| **无认证** | 一旦暴露公网即失控。VPN 边界是唯一防线 |
| **内存队列** | 进程重启丢失排队任务（已完成/失败记录保留在 SQLite） |
| **二值化** | 细笔画消失、斜线锯齿。已在 IR schema 层面用规则约束 |

---

## 6.1 实测推翻的两处原假设（2026-08-21）

完整数据见 `specs/001-label-design-print/research.md` 的「硬件实测：结果」。

1. **第三方标签纸的 `rfidInfo()` 不抛异常**，而是正常返回
   `{ tagPresent: false, allPaper: -1, usedPaper: -1 }`。若按「读到值就当余量」实现，
   `-1` 会被算成负余量，于是**每一个任务都会被判定耗材不足而拒绝打印**。
   正确的判据是 `tagPresent && allPaper > 0`。

2. **`NiimbotNodeSerialClient.connect()` 在设备不存在时照样 resolve**，
   `isConnected()` 也返回 `true`，`getPrinterInfo()` 返回空对象而非 `undefined`——
   协议超时稍后以异步形式冒出，完全绕过 `try/catch`。判断链路是否真的活着，
   只能看握手字段（`connectResult` / `modelId` / `serial`）是否被填充。
   这条路径是产品最高频的错误（打印机闲置自动关机），报错必须准确。

顺带记录两个上游缺陷（不影响本项目）：`isHeartbeatStarted()` 返回值是反的；
心跳失败时库内直接 `console.error`，绕过任何结构化日志。

## 7. 参考资料

**精臣 / niimbluelib**

- [MultiMote/niimbluelib](https://github.com/MultiMote/niimbluelib) — 协议库（本项目唯一打印依赖）
- [NiimBlueLib API Docs](https://libdocs.niim.blue/)
- [NIIMBOT Community Wiki — Print tasks](https://printers.niim.blue/interfacing/print-tasks/)
- [MultiMote/niimblue-node](https://github.com/MultiMote/niimblue-node) — 已移除，仅作页循环与索引变换的参考

**霍尼韦尔 / ZSim**

- [ZSIM Command Reference (Honeywell)](https://prod-edam.honeywell.com/content/dam/honeywell-edam/sps/ppr/en-us/public/products/printers/common/documents/sps-ppr-zsim-en-cr.pdf)
- [ZSim2 font and graphics not the same as a Zebra Printer?](https://sps-support.honeywell.com/s/article/ZSIM-font-and-graphics-not-the-same-as-a-Zebra-Printer)
- [How to printout Chinese character in ZSim language](https://sps-support.honeywell.com/s/article/How-to-printout-Chinese-character-in-Zsim-language-of-intermec-Printer)
- [PC300T/PC310T User Guide](https://manuals.plus/honeywell/pc310t-desktop-printer-manual)

**渲染**

- [lovell/sharp#1549 — font-family on SVG text has no effect](https://github.com/lovell/sharp/issues/1549)
- [lovell/sharp#2936 — SVG font rendering differences since 0.29.0](https://github.com/lovell/sharp/issues/2936)
