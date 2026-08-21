# Phase 1 数据模型：前端工作区与标签编辑器重构

**Feature**: `002-web-workspace-editor`
**Date**: 2026-08-21

本文只描述**本功能引入的变更**。未提及的实体沿用 `001-label-design-print/data-model.md`。

---

## 1. 标签 IR（`@zenith/shared`）

### 1.1 新增：椭圆元素

```
EllipseElement
├── id              string      标签内唯一
├── type            'ellipse'   判别字段
├── xMm, yMm        number      包围盒左上角
├── widthMm         number      > 0
├── heightMm        number      > 0
├── rotation        0|90|180|270
├── strokeWidthDots integer ≥ 1
└── filled          boolean
```

**校验规则**

- `widthMm` / `heightMm` **MUST** > 0。
- `strokeWidthDots` **MUST** 为整数且 ≥ 1（与矩形一致）。
- 描边宽度 ≥ 短轴时**不报错**，渲染为填充（FR-085）；
  校验层不得拒绝，也不得改写该数值。

**与矩形的关系**：属性集合刻意与 `RectElement` 保持一致（除圆角外），
使属性面板、选择框、缩放手柄可以共用同一套逻辑。正圆是 `widthMm === heightMm` 的特例，
**不引入独立的圆形类型**（FR-046）。

### 1.2 变更：文本元素支持多行

```
TextElement.content: string    // 可包含 '\n'
```

- 分行规则：按 `\n` 拆分，**纯字符串操作**，不做任何度量相关的处理。
- 系统 **MUST NOT** 按框宽自动折行（FR-049）。
- 行距固定为 `1.2 × fontSizeMm`（FR-050），**不设为可配置字段**——
  一旦成为字段，就需要在两端各自解释它，而固定常量不会分叉。
- 第 `i` 行基线：`首行基线 + i × 1.2 × 字号`，换算到 dot 后取整。

**不新增字段。** 多行完全由既有的 `content` 承载。

### 1.3 变更：条码与二维码的模块宽度

```
BarcodeElement.moduleWidthDots: integer ≥ 2   // 新增
QrcodeElement.moduleWidthDots:  integer ≥ 2   // 新增
```

- **取代**既有的全局渲染选项 `IrToSvgOptions.barcodeModuleWidthDots`（R3）。
- 下限 2 来自扫描规范而非渲染能力（R4）；上限由标签尺寸隐式约束。
- 允许**任意整数**，含奇数——原先的偶数限制已被实测推翻（R4）。

**`widthMm` 的语义变更**

对条码而言，`widthMm` 由 `moduleWidthDots × moduleCount` **派生**，
不再是独立的输入。属性面板显示为只读值。

`moduleCount` 由内容与码制决定；内容绑定可变字段时，
**设计阶段的 `moduleCount` 只是基于示例值的估算**，
真实值到打印时才确定（FR-068、FR-069）。

对二维码而言，边长同样量化（R2）：
`边长 = moduleWidthDots × moduleCount`，其中 `moduleCount` 受内容与纠错等级共同影响。
缩放时向下取整到可达尺寸，保证不超出声明尺寸（FR-002）。

---

## 2. 打印机（Printer）

### 2.1 新增：物理偏移

```
Printer
└── offsetXDots  integer   新增，可正可负
└── offsetYDots  integer   新增，可正可负
```

**归属理由**：偏移描述「这台机器当前的走纸位置」，
是设备的物理状态，不是纸张的排版属性。每次更换纸卷——即使是同型号纸——
都可能需要重新校正（FR-052、FR-057）。

**单位为 dot 而非 mm**：偏移是对打印头输出的整体平移，
其自然粒度就是打印点；以 mm 存储会引入一次不必要的取整。
这是本项目中**唯一以 dot 存储的位置量**，需在代码中明确注释其理由。

**存储两个轴向值，界面呈现四个方向**（FR-092）

| 界面输入 | 映射 |
|---|---|
| 上移 N | `offsetYDots = -N` |
| 下移 N | `offsetYDots = +N` |
| 左移 N | `offsetXDots = -N` |
| 右移 N | `offsetXDots = +N` |

相对的两个方向**互斥**：填写「上移」时「下移」归零，反之亦然。
换纸后使用者感知到的是「内容偏上了」，让其填「下移 2」比要求换算成负数更直接；
而存储层保留有符号的两个值，避免出现「上=2 且 下=3」这类无法解释的状态。

**状态转移**：无。偏移是一个可随时修改的标量对，不参与生命周期。

---

## 3. 打印纸张 Profile

### 3.1 新增字段

```
Profile
├── labelWidthMm      number > 0     新增：纸张宽度
├── labelHeightMm     number > 0     新增：纸张高度
├── marginTopMm       number ≥ 0     新增，默认 0
├── marginRightMm     number ≥ 0     新增，默认 0
├── marginBottomMm    number ≥ 0     新增，默认 0
└── marginLeftMm      number ≥ 0     新增，默认 0
```

### 3.2 移除字段

```
Profile
├── offsetXMm    ← 移除，迁往 Printer
└── offsetYMm    ← 移除，迁往 Printer
```

**语义**：一个 Profile 代表「这台打印机 + 当前这卷纸」。
纸张尺寸属于它，因此选择 Profile 时画布尺寸自动跟随（FR-061）。

**边距不是硬约束**：边距区域以视觉方式标出，但**不阻止**在其中放置元素（FR-064）。
它表达的是「这里可能压边」，而非「这里不能放」。

**标签间距**本期不做（FR-066），不新增字段。

---

## 4. 模板（Template）

### 4.1 新增：版本字段

```
Template
└── version  integer ≥ 1   新增，单调递增
```

- 每次成功保存后 **+1**。
- 保存请求 **MUST** 携带载入时的 `version`；不匹配则拒绝（FR-080）。
- **使用整数计数器而非时间戳**：同一秒内的两次保存用时间戳无法区分（R9）。

**并发保存的状态转移**

```
载入 (version=N)
   │
   ├── 保存请求携带 version=N，且库中仍为 N
   │      └→ 成功，库中变为 N+1
   │
   └── 保存请求携带 version=N，但库中已是 N+1（他处已保存）
          └→ 拒绝；使用者的编辑内容保留在页面上（FR-082）
             使用者可选择重新加载后重做
```

---

## 5. 界面偏好（Client Preferences）

**不进数据库。** 仅存于浏览器本地（FR-074）。

```
Preferences
├── language                'zh-CN' | 'en-US'
├── defaultLabelWidthMm     number
├── defaultLabelHeightMm    number
├── defaultDpi              number
├── defaultFontFamily       string     打包字体之一
├── displayUnit             'mm' | 'dot'
├── theme                   'light' | 'dark' | 'system'
├── queuePollIntervalMs     number
└── alwaysConfirmTabClose   boolean
```

**设计约束**：此集合 **MUST NOT** 包含任何影响其他使用者的项（FR-070）。
系统无认证，界面上的全局配置等同于「任何能访问到的人都能改」。
空跑模式、日志级别等继续由部署层管理。

---

## 6. 工作区标签页（前端运行时状态）

**不持久化。** 仅存在于浏览器内存中。

```
WorkspaceTab
├── id            string
├── kind          'index'|'design'|'templates'|'printers'|'queue'|'history'|'settings'
├── title         string
├── isDirty       boolean          有未保存修改
└── viewState     对该 kind 私有的视图状态
```

设计标签页的 `viewState` 包含：

```
DesignViewState
├── ir              LabelIR         当前编辑中的标签
├── loadedVersion   integer|null    载入时的模板版本（null = 未保存的新设计）
├── templateId      string|null
├── selectedId      string|null
├── zoom            number
├── scrollX/Y       number
└── undoStack       LabelIR[]       快照栈，深度上限 50
    redoStack       LabelIR[]
```

**关键约束**：标签页集合是应用状态，**全部保持挂载**（FR-024）；
地址栏只投影「当前激活的是哪一个」，**不决定哪些标签页存在**（R7）。

**撤销栈为整体快照**而非逐操作补丁（R8）：标签 IR 很小，
整体快照的代价低于维护反向操作，且新增操作类型时不需要为它单独实现撤销。
连续拖拽 **MUST** 合并为一步（拖拽结束时入栈），否则一次拖动会填满整个栈。

---

## 7. 数据迁移

**触发**：应用启动时按 schema 版本号判定，一次性执行。

**步骤**

1. 备份数据库文件。
2. 为 Printer 增加 `offsetXDots` / `offsetYDots`，默认 0。
3. 对每台打印机：取其**默认 Profile** 的 `offsetXMm` / `offsetYMm`，
   换算为 dot 后写入打印机。
4. 若该打印机的其他 Profile 携带**不同**的偏移值，
   将被丢弃的值写入结构化日志（FR-077），须含打印机名、Profile 名、被丢弃的数值。
5. 为 Profile 增加纸张尺寸与四边边距字段。
   纸张尺寸的初始值取自该 Profile 关联模板的画布尺寸；无关联时取机型默认。
6. 删除 Profile 的偏移字段。
7. 为 Template 增加 `version`，全部初始化为 1。
8. 为既有条码元素补 `moduleWidthDots = 2` —— 恰为现行全局默认值，
   因此渲染结果不变（FR-078）。

**验证**（FR-078）

迁移前后各渲染一遍全部既有模板，比对逐像素哈希。这一步完全离线，
**应作为迁移的自动化测试而非人工检查**。

**回滚**：恢复备份文件。偏移值可由人工重新校正，即便迁移出错也不造成不可恢复的损失。
