# Quickstart：环境搭建与验证

**Feature**: 001-label-design-print

---

## 前置条件

| 项 | 要求 | 校验 |
|---|---|---|
| Node.js | ≥ 26（`node:sqlite` 内建） | `node -v` |
| 串口权限 | 当前用户属于 `dialout` 组（精臣走 `/dev/ttyACM0`） | `groups \| grep dialout` |
| 网络 | 与 PC310T 同网段，其 IP 为静态 | `ping <printer-ip>` |
| 字体文件 | `fonts/full/` 与 `fonts/subset/` 已就位 | 见下 |

**不需要**：node-gyp、编译工具链、CUPS、打印机厂商驱动、蓝牙栈。
精臣走 USB 串口而非 BLE，因此 `noble` 那一整套原生依赖完全不涉及。

若串口权限不足：

```bash
sudo usermod -aG dialout "$USER"   # 重新登录后生效
ls -l /dev/ttyACM0                 # 确认设备存在且属组为 dialout
```

## 安装与运行

```bash
npm install                # npm workspaces，一次装齐三个包
npm run build              # shared → server → web
npm run dev                # 开发模式：后端 watch + 前端 HMR
npm start                  # 生产模式：单进程，后端托管前端产物
```

默认监听 `0.0.0.0:3000`。**仅在局域网或 VPN 内访问——本期不做认证，
任何能访问到的人都可以提交与取消任务。**

## 质量门槛

```bash
npm run typecheck          # tsc --noEmit，零错误
npm run lint               # ESLint，零错误零新增警告
npm test                   # vitest，默认套件不触碰真实硬件
npm run test:coverage      # 核心逻辑行覆盖率 ≥ 80%
```

四项全绿是合并的前置条件（宪章「质量门槛（CI 强制）」）。

**默认测试套件完全脱机运行**——所有驱动测试走 `FakeTransport`，渲染管线是纯函数走快照比对。
不插打印机也应全绿；若不全绿，说明某处绕过了 `PrinterTransport` 抽象，这是宪章原则 II 的违背。

真机测试单独运行：

```bash
npm run test:hardware      # 仅 *.hardware.test.ts，需接好设备
```

## 字体准备

```bash
fonts/
├── full/          # 后端全量，保证实物正确
│   ├── NotoSansSC-Regular.ttf
│   ├── NotoSansSC-Bold.ttf
│   ├── NotoSerifSC-Regular.ttf
│   └── Inconsolata-Regular.ttf
└── subset/        # 前端 GB2312 子集，控制首屏体积
```

后端以 `loadSystemFonts: false` + `fontFiles` 加载 `full/`，**绝不读取系统字体**——
这是「同一模板在任意机器上逐像素一致」的前提，不是可调优项。

## 首次接入打印机

**精臣 B3S_P（USB 串口）**

1. 上电，USB 连接本机，确认 `/dev/ttyACM0` 出现
2. Web 界面 → 添加打印机 → `kind: niimbot`、`transport: serial`、
   `address: /dev/ttyACM0`、`printTaskName: B1`
3. 点「探测」回填能力参数。预期：`dpi 203`、`printheadPixels 576`（≈72.1mm 幅宽）、
   密度 1–5、`supportsConsumableLevel: true`

> `printTaskName` 必须是 **`B1`**。完整枚举为 `D11_V1 · D110 · B1 · B21_V1 · B21_L2B ·
> D110M_V4 · H1S`，**不存在 `P1`**。

**霍尼韦尔 PC310T（以太网）**

1. 经打印机内置网页或 PrintSet 5 将命令语言切换为 **ZSim**
2. 确认其为静态 IP
3. 添加打印机 → `kind: zpl`、`transport: tcp`、`address: <ip>:9100`
4. 点「探测」

## 硬件实测清单

以下 7 项在 Setup 阶段用 `@zenith/cli` 完成，结果回填至
[`research.md`](./research.md#待实测的硬件假设)。

```bash
# 探测能力 + 测量握手耗时（实测 124 ms）
npm run cli -- --json probe -a /dev/ttyACM0

# 自动关机：写入并读回确认，随后需闲置 70 分钟观察
npm run cli -- --json set-shutdown -a /dev/ttyACM0 --time 4

# 保活：另一条对付自动关机的路，心跳首次失败即停止并报告时刻
npm run cli -- keepalive -a /dev/ttyACM0 --minutes 75

# 耗材 RFID：原厂纸与第三方纸各跑一次
npm run cli -- --json rfid -a /dev/ttyACM0

# 只渲染不打印（安全）
npm run cli -- render-test -o /tmp/line.png --stroke-dots 1

# 真正打印测试标签 —— 消耗耗材，必须显式确认
npm run cli -- print-test -a /dev/ttyACM0 -p B1 --stroke-dots 1 --confirm --save /tmp/printed.png
```

> `render-test` **不接触打印机**，只写 PNG。硬件实测 #7 要看的是纸上的效果，
> 必须用 `print-test --confirm`。没有 `--confirm` 它会拒绝执行并说明原因。

CLI 遵循宪章 III.B：kebab-case 参数、`--json` 双格式、stdout/stderr 分流、退出码稳定。

**第 1 项最关键**：设置 `--time 4` 后读回确认，再放置 70 分钟以上观察是否关机。
`AutoShutdownTime` 的官方注释是「60 分钟**或永不**，取决于型号」——库自身也不确定。

若结果不是「永不」，则：**B3S_P 闲置一小时后的第一个打印任务必然失败，且必须有人到设备旁
按电源键**（无法 USB 唤醒）。这不是缺陷而是硬件限制，须在 UI 提示与产品说明中如实告知
（FR-036、FR-047）。

## 空跑模式（开发与演示）

```bash
ZENITH_DRY_RUN=1 npm start
```

驱动层被替换为 `DryRunDriver`：连接、预检、逐页进度全部照常走完，**只是不向打印机发送任何数据**。
适用于界面开发、演示，以及任何不该消耗耗材的端到端验证。

> 加这个开关的直接起因：一次开发测试指向了刚插上的真实打印机，打出了实体标签。
> 「记得别碰」不是防护，开关才是。**任何针对 `/dev/ttyACM0` 的自动化验证都应带上它。**

## 端到端验证（对应 SC-001）

一位新用户应能在 10 分钟内独立走完：

1. 添加打印机并探测
2. 新建 50×30mm 标签，放入条码、文字、LOGO
3. 保存为模板，将料号标为 `manual` 字段、序号标为 `sequence` 字段
4. 打印 2 份 → 界面 2 秒内返回「已排队」
5. 取实物：两张版式相同、序号分别为 001 / 002
6. 扫码枪验证条码可读；尺子验证位置偏差 ≤ 0.5mm

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 提交后立即 `503 PRINTER_UNREACHABLE` | 精臣闲置自动关机 | 到设备旁按电源键。无法远程唤醒 |
| 打印出乱码图 | `ResvgImageSource` 像素索引错误 | resvg 输出 RGBA 四通道，索引须 `× 4` |
| 编辑器中文显示豆腐块但打印正确 | 前端用的是 GB2312 子集字体 | 预期行为，非缺陷 |
| 细线打印后不可见 | 线宽小于 1 dot | schema 应已拦截；若未拦截即为缺陷 |
| 条码扫不出来 | 模块宽度未对齐整数 dot | 检查条码渲染的取整逻辑 |
| 任务显示「已打印：未知」 | 服务在打印中重启 | 人工核对实物后决定补打数量（FR-053） |
