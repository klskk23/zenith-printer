# Implementation Plan: 标签设计与打印环境

**Branch**: `001-label-design-print` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-label-design-print/spec.md`

## Summary

在一台常开的本机设备上提供标签设计与打印服务：用户通过局域网 web 界面设计标签（文字、条码、
二维码、图片、线条、矩形），提交到目标打印机的串行队列，由服务端独立渲染并驱动两类工作原理
完全不同的打印机输出。

技术路径的核心是**一份统一的 Label IR 加两个渲染出口**：IR（毫米坐标的 JSON）经由前后端共享的
`ir-to-svg` 模块转为 SVG，前端塞进 DOM 做实时预览，后端交给 resvg 渲染为 RGBA 像素、二值化后
分别送往精臣（位图协议）与霍尼韦尔（ZPL `^GF`）。后端具备完全独立的渲染能力，这是为后续
批量打印与外部数据源预留的前提。

架构决策的完整推导见 [`docs/design-consensus.md`](../../docs/design-consensus.md)。

## Technical Context

**Language/Version**: TypeScript 5.9（strict 模式）/ Node.js 26（`node:sqlite` 已内建，无需外部驱动）

**Primary Dependencies**:

| 用途 | 包 | 版本 |
|---|---|---|
| HTTP 服务 | `fastify` | 5.12.1 |
| 请求校验 | `zod` + `fastify-type-provider-zod` | 4.4.3 / 7.0.0 |
| 矢量渲染 | `@resvg/resvg-js` | 2.6.2 |
| 条码生成 | `bwip-js` | 4.11.4 |
| 图像后处理 | `sharp` | 0.35.3 |
| 精臣协议 | `@mmote/niimbluelib` | 0.0.1-alpha.43-node |
| 前端 | `vite` + `react` + `tailwindcss` + `shadcn/ui` | 最新稳定 |
| 前端数据层 | `@tanstack/react-query` | 最新稳定（轮询任务状态） |

**Storage**: SQLite，经 Node 内建 `node:sqlite`。图片资源以文件存于磁盘，元数据入库。

**Testing**: `vitest` + `@vitest/coverage-v8`。前后端共用同一测试运行器（前端本就是 Vite）。

**Target Platform**: Linux（本机常开设备），单进程，systemd 托管

**Project Type**: Web 应用（前后端同仓、单进程部署，后端同时托管前端静态产物）

**Performance Goals**:
- 打印任务提交至受理确认 < 2 秒（SC-005）
- 单张标签渲染（IR → 二值位图）< 200ms
- 100 份任务端到端 < 5 分钟（SC-004）

**Constraints**:
- 打印机**按需连接**：每个任务开→打→关，两条链路生命周期语义一致
- 每台打印机**串行执行**，队列间互不阻塞
- 实物与设计稿位置偏差 ≤ 0.5mm（SC-003）
- 渲染**逐像素可复现**：禁用系统字体，字体文件随项目打包（宪章硬性要求）
- 精臣 B3S_P 闲置 1 小时自动关机且无法远程唤醒——不可规避的硬件限制

**Scale/Scope**: 个位数打印机、个位数并发用户、单任务 ≤ 100 份、53 条功能需求

## Constitution Check

*GATE: 依据 `.specify/memory/constitution.md` v1.2.0 逐条核对。*

### 原则 I — 代码质量优先

| 条款 | 落实方式 | 状态 |
|---|---|---|
| tsc + ESLint 零错误 | 根级 `tsconfig` 开启 `strict`；ESLint flat config 覆盖三个包；CI 阻断 | ✅ |
| 禁用 `any` | 外部输入一律经 zod 解析为具名类型；协议层未知数据用 `unknown` + 显式收窄 | ✅ |
| 公共 API 显式标注 | REST 端点由 zod schema 推导类型；`shared` 包导出全部标注 | ✅ |
| 显式错误处理 | 驱动层错误映射为具名错误类型；禁止空 catch | ✅ |

### 原则 II — 测试标准（不可协商）

这是对架构影响最大的一条。**「默认测试套件必须脱离物理打印机运行」直接决定了驱动层的形状**：

| 条款 | 落实方式 | 状态 |
|---|---|---|
| 测试先行（红-绿-重构） | 任务清单中测试任务排在对应实现任务之前 | ✅ |
| 传输层可注入 | 定义 `PrinterTransport` 接口，`SerialTransport` / `TcpTransport` / `FakeTransport` 三实现；驱动只依赖接口 | ✅ |
| 默认套件脱机通过 | 全部驱动测试走 `FakeTransport`；渲染管线是纯函数，走快照比对 | ✅ |
| 真机测试隔离 | 标记为 `*.hardware.test.ts`，默认 `exclude`，单独脚本运行并记录机型 | ✅ |
| 协议编解码集成测试 | 精臣：帧序列比对；霍尼韦尔：ZPL 文本比对 | ✅ |
| 覆盖率 ≥ 80% | 覆盖范围限定核心逻辑（`render/`、`drivers/`、`queue/`、`domain/`），CI 阻断 | ✅ |
| 测试确定性 | `Clock` 与 `IdGenerator` 经依赖注入；禁止真实时钟与随机数 | ✅ |

### 原则 III — 用户体验一致性

**III.0 共通**

| 条款 | 落实方式 | 对应 FR |
|---|---|---|
| 术语全局统一 | `shared` 包导出唯一术语表；`density` 等字段名跨 API/UI/日志一致 | — |
| 错误三要素 | 统一错误结构 `{ code, what, why, next }` | FR-033 |
| 设备错误码映射 | i18n 层将 53 个 `PrinterErrorCode` 译为中文，不透传数字 | FR-034 |
| >2s 操作有进度 | 任务进度经轮询暴露 `pagesPrinted / totalPages` | FR-035 |
| 耗材操作显式确认 | 打印端点要求幂等键 + 前端二次确认，防刷新重发 | FR-017 |

**III.A Web / REST（主形态）**

| 条款 | 落实方式 | 对应 FR |
|---|---|---|
| JSON 字段 camelCase | zod schema 统一定义 | — |
| 状态码语义稳定 | 400 校验失败 / 404 不存在 / 409 状态冲突（如队列暂停、设备有排队任务不可删）/ 422 业务规则拒绝（余量不足、序号越界）/ 503 设备不可达 | FR-015、FR-046、FR-052 |
| 错误响应统一结构 | 机器可读 `code` + 中文 `message`，绝不只返回自由文本 | FR-033 |
| 长任务非阻塞 | `POST /api/print-jobs` 立即返回 `jobId` | FR-012 |
| 暴露已完成份数 | 任务资源含 `pagesPrinted`（未知时为 `null`） | FR-020、FR-053 |

**III.B CLI（辅助形态）**

本期需要一个运维 CLI 承载共识文档的 7 项硬件实测（尤其 `setAutoShutDownTime`，该命令
niimblue CLI 未暴露）。它必须遵守：kebab-case 参数、`--json` 双格式、stdout/stderr 分流、
退出码稳定。

### 原则 IV — 语言与本地化规范

| 条款 | 落实方式 | 状态 |
|---|---|---|
| 中文用于文档与对话 | 本文件、spec、research、data-model 全中文 | ✅ |
| 英文用于代码产物 | 标识符、类型名、文件名、注释、日志、测试名 | ✅ |
| 用户文案经 I18N 层 | `server/src/i18n/zh-CN.ts`，键名英文、文案中文 | ✅ |
| 禁止硬编码非英文串 | ESLint 规则禁止源码中出现 CJK 字面量（i18n 资源目录除外） | ✅ |

### 原则 V — 可观测性与故障可诊断性

| 条款 | 落实方式 |
|---|---|
| 结构化分级日志 | Fastify 内建 pino，级别运行时可控 |
| 协议帧 debug 导出 | **`withFrameLogging()` 在 `PrinterTransport` 层统一实现**，两种驱动共享，保证「每一次」收发无遗漏（见 contracts/driver-port.md） |
| 标识信息脱敏 | 序列号 / MAC 在 info 及以上级别脱敏，仅 debug 全量 |
| 错误可追溯 | 每条错误携带设备型号、固件版本、连接方式、任务 ID |
| 依赖前置条件文档化 | `sharp` 与 `niimbluelib` 的串口权限（`dialout` 组）写入 quickstart |

### 技术约束核对

| 约束 | 状态 | 说明 |
|---|---|---|
| 技术栈锁定表 | ✅ | 全部采用，无偏离 |
| 边界 zod 校验 | ✅ | `fastify-type-provider-zod@7`（要求 fastify ≥5.5、zod ≥4.1.5，均满足） |
| 渲染确定性 | ✅ | resvg `loadSystemFonts: false` + `fontFiles`，已验证该选项存在 |
| 单位约定 | ✅ | `shared/units.ts` 单一实现：mm 存储、`round`、画布先转整数 dot |
| sharp 不得渲染文字 | ✅ | sharp 仅用于二值化与格式转换，SVG 一律走 resvg |
| 硬件参数不硬编码 | ✅ | 全部从探测所得的型号元数据读取 |
| 资源安全 | ✅ | 按需连接 + `try/finally` 释放 + 每机互斥锁 |
| CI 质量门槛 | ⚠️ | **当前仓库尚无 `package.json` 与 CI**，须在 Setup 阶段建立，否则宪章条款无执行力 |

**门禁结论：通过。** 无违背项，无需 Complexity Tracking 记录。唯一待办是 CI 门槛的落地，
已列为 Setup 阶段的阻塞性前置任务。

## Project Structure

### Documentation (this feature)

```text
specs/001-label-design-print/
├── plan.md              # 本文件
├── spec.md              # 功能规格（53 FR / 13 SC / 5 澄清）
├── research.md          # Phase 0：技术决策与待实测假设
├── data-model.md        # Phase 1：实体、schema、状态机
├── quickstart.md        # Phase 1：环境搭建与运行
├── contracts/
│   ├── rest-api.md      # REST 端点契约
│   ├── ir-schema.md     # Label IR 结构契约（前后端共享）
│   └── driver-port.md   # 驱动层接口契约（测试注入点）
├── checklists/
│   └── requirements.md  # 规格质量清单（16/16 通过）
└── tasks.md             # Phase 2 输出（由 /speckit.tasks 生成，本命令不创建）
```

### Source Code (repository root)

采用 npm workspaces 四包结构（三个运行时包 + 一个运维 CLI）。**`shared` 包的存在是宪章要求的直接结果**——`ir-to-svg` 必须
前后端共用同一份实现，否则预览与实物的一致性无从保证。

```text
packages/
├── shared/                      # @zenith/shared —— 前后端共享，零运行时依赖后端
│   ├── src/
│   │   ├── ir/                  # Label IR 的 zod schema 与类型
│   │   ├── ir-to-svg/           # IR → SVG（★ 一致性的唯一保证）
│   │   ├── barcode/             # bwip-js 封装，输出 SVG 片段
│   │   ├── units.ts             # mm ⟷ dot 换算（round、dot 网格对齐）
│   │   └── terms.ts             # 术语表（原则 III.0）
│   └── tests/
│
├── server/                      # @zenith/server
│   ├── src/
│   │   ├── api/                 # Fastify 路由 + zod schema
│   │   ├── domain/              # 实体、任务状态机、序号区间分配
│   │   ├── queue/               # 每机串行队列、调度、暂停/恢复、启动期清理
│   │   ├── render/              # SVG → resvg → RGBA → 二值化 → ImageSource
│   │   ├── drivers/
│   │   │   ├── port.ts          # PrinterTransport / PrinterDriver 接口（★ 注入点）
│   │   │   ├── frame-logger.ts  # 帧日志装饰器（宪章原则 V）
│   │   │   ├── niimbot/         # 精臣：niimbluelib + serial
│   │   │   ├── zpl/             # 霍尼韦尔：ZPL 生成 + TCP 9100
│   │   │   └── fake/            # FakeTransport（★ 脱机测试基石）
│   │   ├── db/                  # node:sqlite、迁移、仓储
│   │   ├── i18n/                # 错误码 → 中文文案
│   │   └── static.ts            # 托管前端产物（单进程）
│   └── tests/
│       ├── unit/
│       ├── integration/
│       └── hardware/            # *.hardware.test.ts，默认排除
│
├── web/                         # @zenith/web
│   ├── src/
│   │   ├── editor/              # SVG DOM 编辑器（非 canvas）
│   │   ├── components/ui/       # shadcn/ui 组件
│   │   ├── features/            # 打印机 / 参数 / 模板 / 任务队列
│   │   └── api/                 # TanStack Query 客户端
│   └── tests/
│
└── cli/                         # @zenith/cli —— 运维与硬件实测（原则 III.B）

fonts/
├── full/                        # 后端全量字体
└── subset/                      # 前端 GB2312 子集
```

**Structure Decision**: 选择 npm workspaces 而非单包 + 路径别名，理由是 `shared` 需要被
`server`（Node 运行时）与 `web`（浏览器打包）以不同方式消费，workspaces 能让两侧各自的构建
链正确处理同一份源码，且类型边界清晰。这是宪章「ir-to-svg 前后端共享」条款的最低成本实现，
不构成额外复杂度。

`drivers/port.ts` 是整个架构的测试支点：所有硬件交互经它抽象，`FakeTransport` 让默认测试
套件完全脱离物理设备——这是原则 II 的硬性要求，也是本设计中唯一不可妥协的结构约束。

## Complexity Tracking

> 无违背宪章的设计，本节留空。

四包结构与驱动端口抽象均为宪章条款的直接产物，而非自选复杂度：前者出自「ir-to-svg 前后端共享」，
后者出自「默认测试套件必须脱离物理打印机运行」。
