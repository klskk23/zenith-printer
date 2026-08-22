# Implementation Plan: 变量与表格数据源

**Branch**: `003-variables-data-sources` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-variables-data-sources/spec.md`

## Summary

废弃「可变字段」，改为三种变量（设计期常量 / 自增 / 数据源列）与内联 `${}` 引用；
新增本地表格数据源（CSV 上传、剪贴板粘贴、站内编辑）；打印任务的单位由「份数」改为
「所选行数 × 份数」；渲染改为流式以支撑单任务 1000 张。

技术路径上有三处是本功能的重心，其余都是它们的衍生：

1. **一个解析器，两处使用**。`${}` 的解析放在 `@zenith/shared`（单层命名空间，无路径、
   无引号段），编辑器画布与打印渲染共用同一次解析——这是既有的「一个渲染器」原则的延续（编辑器注入 `irToSvg` 产出的
   SVG，而不是自己再画一遍）。
2. **序号池的当前值仍由历史推导**，只是多一条 `floor` 使重置可行。今天没有计数器表，
   号码的唯一凭据是任务记录；引入第二份状态会带来「两个数字不一致时哪个是真的」，而
   猜错的后果是重号。
3. **驱动端口从数组改为「总数 + 按序取页」**。这是宪章约束的契约变更，四个驱动同步改。

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 26（`--experimental-strip-types`，
`erasableSyntaxOnly`）

**Primary Dependencies**: 既有 —— Fastify 5、zod 4、`node:sqlite`、Vite + React、
Tailwind + shadcn/ui、`@resvg/resvg-js`、`bwip-js`。
新增 —— `@tanstack/react-table`（与既有 `@tanstack/react-query` 同族）。
**不新增** CSV 解析库与编码库：类型推断与规格相悖，编码能力 Node 自带（见 research R2/R4）。

**Storage**: SQLite（`node:sqlite`）。新增 `data_sources`、`data_source_rows`、
`sequence_pools`、`job_sequence_claims` 四张表；`templates` 增加 `variables` 与
`data_source_id` 两列；`variable_fields` 表与 `print_jobs.seq_ranges` 列删除。

**Testing**: Vitest，沿用既有三个项目 —— `default`（纯 Node）、`web`（happy-dom）、
`hardware`（隔离）。不新增测试项目。

**Target Platform**: 局域网内单进程部署，浏览器为现代 Chromium/Firefox。

**Project Type**: Web（前后端同仓，单进程提供 API 与静态资源）

**Performance Goals**:
- 提交后第一张标签在 **1 秒内**开始输出，与批量总数无关（SC-003）
- 10,000 行 CSV 在 **30 秒内**完成导入并可用（SC-002-pre）
- 行选择界面每页 10 行，翻页与勾选无可感知延迟

**Constraints**:
- 单任务 ≤ 1000 张；单数据源 ≤ 10,000 行
- 渲染内存不随批量线性增长（流式的直接目的）
- 编辑器在任何中间输入状态下都不得中断（FR-016）
- 一切单元格皆文本，禁止类型推断（FR-024）

**Scale/Scope**: 个位数打印机、个位数并发用户；数据源数十个、单表万行级；
模板数十个。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 关卡 | 本功能的落点 | 状态 |
|---|---|---|---|
| I 代码质量 | `tsc` + ESLint 零错误零新增警告 | 既有门禁不变 | ✅ |
| I | 禁止 `any`，公共 API 显式标注 | 解析器、数据源仓储、端口均有显式签名 | ✅ |
| I | 重复第三次才抽取 | CSV 引号规则被 R4 与 R11 共用（第二处即抽取，因为两者必须一致） | ✅ |
| II 测试先行 | 红-绿-重构 | 解析器、CSV、行选择展开均为纯函数，先测后写 | ✅ |
| II | 图像转换与抖动 MUST 有集成测试 | 流式改造后需重跑既有渲染集成测试 | ✅ |
| II | 硬件依赖 MUST 注入传输层 | 端口签名改变但注入方式不变 | ✅ |
| II | 核心逻辑行覆盖 ≥ 80% | 解析器/CSV/选择展开/序号推导全部计入 | ✅ |
| II | 测试确定性，时间与随机可注入 | 序号推导依赖 `Clock`（既有注入） | ✅ |
| **II 界面渲染测试** | **每个可导航页面 MUST 有渲染断言** | **新增页面：数据源列表、数据源编辑。两者各需一条挂载断言** | ✅ 见下表 |
| II | 纯逻辑 MUST 抽离直接测试 | 解析、探测、展开、粘贴切分均不依赖组件 | ✅ |
| II | 组件测试断言行为而非样式类名 | 沿用既有做法（`data-inspector` 之类的锚点） | ✅ |
| III.0 术语统一 | 同一概念一个词 | 「变量 / 数据源 / 序号池 / 行选择」四个词贯穿 UI、API、日志、文档；变量与列共用「变量」一词，因为引用语法已不区分 | ✅ |
| III.0 错误三要素 | 什么/为什么/下一步 | 导入失败（编码、表头、重复列、超行数）各有三要素文案 | ✅ |
| III.0 超 2 秒有进度 | 万行导入、千张打印 | 导入与打印均需进度反馈 | ✅ |
| III.0 消耗耗材需确认 | 打印、序号池重置、替换数据源、删除数据源 | 四处均要求显式确认 | ✅ |
| III.0 破坏性变更需说明 | 可变字段整体移除 | 规格已声明；无生产数据 | ✅ |
| III.A camelCase / 状态码稳定 | REST 契约 | 见 `contracts/rest-api.md` | ✅ |
| III.A 长任务立即返回可轮询标识 | 打印任务 | 既有机制不变 | ✅ |
| IV 语言规范 | 文档中文、标识符英文 | 本计划与规格为中文，代码标识符英文 | ✅ |
| V 可观测性 | 结构化日志、协议帧可导出 | 流式渲染后仍按页上报进度；帧日志不变 | ✅ |

### 新增可导航页面的渲染断言（原则 II）

| 页面 | 断言 |
|---|---|
| 数据源列表 | 挂载后不抛异常；空状态可见；「新建」入口可达 |
| 数据源编辑 | 挂载后不抛异常；表格渲染出表头与首页数据；粘贴入口可达 |

打印对话框中的行选择区不是独立页面，但属于既有页面的新分区，同样需要一条挂载断言。

**结论**：无违规项，`Complexity Tracking` 留空。

## Project Structure

### Documentation (this feature)

```text
specs/003-variables-data-sources/
├── spec.md
├── plan.md              # 本文件
├── research.md          # Phase 0：技术决策与否决项
├── data-model.md        # Phase 1：实体、字段、迁移
├── quickstart.md        # Phase 1：本地跑通与实测命令
├── contracts/
│   ├── variable-grammar.md   # ${} 文法（冻结）
│   ├── rest-api.md           # 新增与变更的端点
│   └── driver-port.md        # 驱动端口的流式变更
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
packages/
├── shared/src/
│   ├── template/             # 新增：${} 解析与求值（编辑器与渲染共用）
│   ├── ir/                   # content 恒为字符串；移除 { $var }
│   └── ir-to-svg/            # 求值后再绘制
├── server/src/
│   ├── domain/
│   │   ├── data-source.ts    # 新增
│   │   ├── sequence-pool.ts  # 新增（取代 variable-field.ts）
│   │   └── print-job.ts      # 快照增加 rows
│   ├── db/
│   │   ├── migrations/       # 新增迁移：建四表、删可变字段
│   │   └── repositories/     # data-source-repo、sequence-pool-repo
│   ├── csv/                  # 新增：解析、编码探测、分隔符探测
│   ├── api/
│   │   ├── data-sources.ts   # 新增
│   │   ├── sequence-pools.ts # 新增
│   │   └── print-jobs.ts     # 行选择、上限、快照
│   ├── queue/                # 流式：total + at(index)
│   └── drivers/              # 四个驱动跟随端口变更
└── web/src/
    ├── features/data-sources/  # 新增：列表、编辑、粘贴
    ├── features/sequence-pools/# 新增：列表、重置
    ├── features/print/         # 行选择区
    └── editor/                 # 变量定义面板取代可变字段面板
```

**Structure Decision**: 沿用既有 npm workspaces 四包结构，不新增包。`${}` 的解析放在
`shared` 而非 `server`，因为编辑器与打印渲染必须共用同一次解析——这是既有「编辑器注入
`irToSvg` 产出的 SVG」原则的延续：两处各写一份解析，等于把「预览与实物一致」这条保证
交给两份实现去维持。

## Complexity Tracking

无违规项。
