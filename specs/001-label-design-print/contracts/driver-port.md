# 契约：驱动层端口

**Feature**: 001-label-design-print

**这是整个架构的测试支点。** 宪章原则 II 规定「所有依赖打印机硬件的代码 MUST 通过接口注入
传输层，使测试可用 fake/mock 替换；默认测试套件 MUST 在无物理设备的情况下完整通过」。
本契约是该条款的结构化落实——**它不是可选的抽象层，是宪章的硬性要求。**

---

## 分层

```
        PrintQueue（每机串行调度）
               │  只认识 PrinterDriver
               ▼
        ┌──────────────┐
        │ PrinterDriver│  connect / probe / preflight / printPages / disconnect
        └──────┬───────┘
     ┌─────────┴──────────┐
     ▼                    ▼
NiimbotDriver          ZplDriver
     │                    │
     └──── PrinterTransport ────┘     ← 唯一的 I/O 出口
              ▲
     ┌────────┼────────┐
     ▼        ▼        ▼
SerialTransport  TcpTransport  FakeTransport
                               （★ 默认测试套件全部走这里）
```

规则：**`drivers/` 之外的任何代码都不得直接进行 I/O。** 队列、领域层、API 只认识
`PrinterDriver` 接口。

## 协议帧日志（宪章原则 V，MUST）

宪章规定「与打印机之间的**每一次**协议收发 MUST 可在 `debug` 级别下记录为十六进制帧」。
该能力**在 `PrinterTransport` 层统一实现**，而非由各驱动分别处理——这样两种打印机自动获得
一致的排障能力，也保证「每一次」收发无遗漏。

```ts
/** 包装任意 transport，在 debug 级别记录收发帧 */
export function withFrameLogging(
  inner: PrinterTransport,
  logger: Logger,
  context: { printerId: string; jobId?: string },
): PrinterTransport
```

- `write()` 记为 `>> <hex>`，`onData()` 记为 `<< <hex>`
- 精臣为二进制帧（十六进制）；霍尼韦尔为 ZPL 文本（原样记录，超长截断并标注）
- **`info` 及以上级别不得输出帧内容**；序列号与 MAC 在 `info` 及以上脱敏，仅 `debug` 全量
- 每条日志携带 `printerId` 与 `jobId`，保证错误可追溯到具体操作（原则 V）

---

## `PrinterTransport`

字节流层抽象，不理解任何打印协议。

```ts
export interface PrinterTransport {
  open(): Promise<void>
  close(): Promise<void>
  write(data: Uint8Array): Promise<void>
  onData(handler: (chunk: Uint8Array) => void): () => void  // 返回取消订阅
  readonly isOpen: boolean
}
```

| 实现 | 用途 |
|---|---|
| `SerialTransport` | 精臣，`/dev/ttyACM0` |
| `TcpTransport` | 霍尼韦尔，raw TCP 9100 |
| `FakeTransport` | 测试。可预设响应帧、记录全部写入、可编程注入错误与延迟 |

## `PrinterDriver`

协议层抽象。两种打印机的差异**全部封闭在这一层之内**——上层看不到位图与 ZPL 的区别。

```ts
export interface PrinterDriver {
  readonly kind: 'niimbot' | 'zpl'

  connect(): Promise<void>
  disconnect(): Promise<void>

  /** 探测能力参数（FR-025） */
  probe(): Promise<PrinterCapabilities>

  /** 打印前预检（FR-014、FR-015） */
  preflight(requestedCopies: number): Promise<PreflightResult>

  /** 逐页打印。每页之间回调进度（FR-020、FR-035） */
  printPages(
    pages: BinaryBitmap[],
    options: PrintOptions,
    onProgress: (pagesPrinted: number) => void,
  ): Promise<void>
}

export interface PrinterCapabilities {
  dpi: number
  printheadPixels: number
  densityMin: number
  densityMax: number
  densityDefault: number
  paperTypes: number[]
  printDirection: 'top' | 'left'
  supportsConsumableLevel: boolean          // 决定 FR-015 / FR-016 的分支
  model?: string
  serial?: string
  firmwareVersion?: string
}

export interface PreflightResult {
  ok: boolean
  /** 具备上报能力时为剩余份数；否则 null（FR-016） */
  remainingLabels: number | null
  /** 不可打印的原因码，映射至 i18n（FR-034） */
  blockers: PrinterErrorCode[]
}

export interface PrintOptions {
  density: number
  labelType: number
  speed?: number
  printDirection: 'top' | 'left'
}

/** 已二值化的位图，1 = 打印（黑），0 = 留白 */
export interface BinaryBitmap {
  widthDots: number
  heightDots: number
  data: Uint8Array          // 每字节 8 像素，行优先
}
```

---

## 连接生命周期

**按需连接**：每个任务 `connect → preflight → printPages → disconnect`。
两条链路语义一致，且天然规避精臣的 1 小时自动关机问题（关机即连不上，直接报错，
无需维护重连状态机）。

**资源释放**（宪章「资源安全」）：`disconnect()` 必须在 `finally` 中调用，
成功与失败路径均需释放。同一设备的并发访问由队列的每机互斥保证。

**不重试**：`connect()` 失败即向上抛 `PrinterUnreachableError`，队列据此立即将任务标记失败
并暂停（FR-047）。驱动层**不得**内建重试逻辑。

---

## 两种驱动的实现差异

| 关注点 | `NiimbotDriver` | `ZplDriver` |
|---|---|---|
| 底层库 | `@mmote/niimbluelib` | 无，自行生成 ZPL 文本 |
| 输入 | `BinaryBitmap` → `ResvgImageSource` → `ImageEncoder.encode()` | `BinaryBitmap` → `^GF` + `:Z64:` |
| print task | 来自 `Printer.printTaskName`（B3S_P = `B1`） | 不适用 |
| 进度来源 | `client.on('printprogress')` 逐页事件 | 自行按已发送页数计数 |
| 余量上报 | `abstraction.rfidInfo()` → `allPaper - usedPaper` | **不支持**，`remainingLabels` 恒为 `null` |
| 发送粒度 | `printTask.printPage()` 逐页 | **分批发送**，非一次喷完（进度反馈 + 缓冲区安全） |
| 错误来源 | `PrintError.reasonId` → 53 个 `PrinterErrorCode` | `~HS` 主机状态查询 |

**`NiimbotDriver` 实现注意**

- 不使用 `niimblue-node` 的 `initClient`（它把事件全 `console.log` 掉了）。
  直接 `new NiimbotNodeSerialClient()` 自行挂载监听。
- `ResvgImageSource` 实现 `niimbluelib` 的 `ImageSource` 接口。
  ⚠️ **resvg 给出的是 RGBA 四通道，像素索引必须 `× 4`**——`niimblue-node` 的
  `SharpImageSource` 用的是单通道灰度索引（它先做了 `.toColorspace("b-w")`）。
  照抄会得到一张乱码图且不报错。此处必须有单元测试。
- `printDirection === 'left'` 的旋转索引变换应从 `SharpImageSource` 移植，不要重新推导。

---

## 测试契约

**默认套件不得触碰真实硬件。** 以下断言全部通过 `FakeTransport` 完成：

| # | 断言 |
|---|---|
| 1 | `connect()` 失败时 `disconnect()` 仍被调用（`finally` 路径） |
| 2 | `printPages()` 中途抛错时连接被正确释放，不泄漏 |
| 3 | 给定固定 `BinaryBitmap`，`NiimbotDriver` 写出的字节序列与黄金样本逐字节一致 |
| 4 | 给定固定 `BinaryBitmap`，`ZplDriver` 生成的 ZPL 文本与黄金样本一致 |
| 5 | `onProgress` 的回调次数与页数相等，且单调递增 |
| 6 | `preflight()` 在 `supportsConsumableLevel` 为假时返回 `remainingLabels: null` |
| 7 | 传输层报错映射为具名错误类型，不泄漏原始数字码 |
| 8 | `ResvgImageSource` 对 RGBA 缓冲区的采样正确（防 `× 4` 索引错误） |
| 9 | `withFrameLogging` 在 `debug` 级别记录全部收发帧，`info` 级别一条不记 |
| 10 | 帧日志中序列号与 MAC 在 `info` 及以上被脱敏 |

**真机测试**命名为 `*.hardware.test.ts`，默认 `exclude`，单独脚本运行，
且必须在测试名中记录所用打印机型号（宪章原则 II）。

`docs/samples/label_15x30.png` 为已验证的样张，可作为黄金样本的基准输入。
