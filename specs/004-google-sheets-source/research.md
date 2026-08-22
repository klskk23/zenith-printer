# Phase 0 研究：Google Sheets 数据源

本文记录**决定了什么**、**为什么**、以及**否决了什么**。规格里的每一处
NEEDS CLARIFICATION 在此收敛。

外部事实已对着 2026 年 8 月的官方文档核实，出处见文末。共识文档
`docs/google-sheets-data-source.md` 第 1 节写明其中的政策陈述来自访谈时的记忆，
本节是那次核实的结果。

---

## R1. 认证方式：服务账号

**Decision**：服务账号（service account）的 JSON 密钥，签发 JWT 换取访问令牌。

**Rationale**：规格 FR-001 要求「由部署方配置的机器身份，不依赖任何个人用户的登录或
授权」。服务账号是唯一同时满足以下四条的方式：

- 无需重定向 URI（本服务跑在局域网 IP 上，Google 只接受 HTTPS 或 localhost 作为
  Web 客户端的重定向目标）
- 无同意屏、无刷新令牌有效期问题
- 无需应用验证
- 只能读到被显式分享给它的表格，与「无鉴权的局域网服务」这一现状相配

**Alternatives considered**：

| 方案 | 否决理由 |
|---|---|
| OAuth2 授权码流程 | 重定向 URI 在局域网 HTTP 地址上无法注册；测试状态下刷新令牌 7 天失效；`spreadsheets.readonly` 授予整个 Drive 的读权限 |
| OAuth2 + Google Workspace「内部」用户类型 | 免去 7 天与验证问题，但重定向 URI 的限制不变，授权只能在服务器本机浏览器完成 |
| 公开链接 / API key | 表格须对互联网上任何拿到链接的人可读；业务表通常不能这样放 |
| 手工复制粘贴授权码（OOB） | Google 已于 2022 年下线 |

---

## R2. 权限范围：`spreadsheets.readonly`

**Decision**：只申请 `https://www.googleapis.com/auth/spreadsheets.readonly`。

**Rationale**：官方文档列出 `values.get` 可接受五种权限，其中
`spreadsheets.readonly` 是最小的一种。本功能只读、且明确不做写回（规格 Out of Scope），
申请更大的范围没有任何用处，只会扩大密钥泄露时的影响面。

---

## R3. 取值方式：`FORMATTED_VALUE`

**Decision**：读取时使用 `valueRenderOption=FORMATTED_VALUE`（也是 API 默认值）。

**Rationale**：规格 FR-010 要求「取值采用单元格显示出来的文本，不做类型推断」。官方
文档对三种取值方式的说明：

| 取值方式 | 行为 | 对本功能的后果 |
|---|---|---|
| `FORMATTED_VALUE` | 按单元格格式计算并格式化 | 货币单元格 1.23 返回 `"$1.23"` —— 屏幕上是什么，标签上就是什么 |
| `UNFORMATTED_VALUE` | 计算但不格式化 | 同一单元格返回数值 `1.23`，格式丢失 |
| `FORMULA` | 不计算，返回公式本身 | 标签上会印出 `=A1` |

`dateTimeRenderOption` 在 `FORMATTED_VALUE` 下**被忽略**，因此不需要设置——日期自然
保持其在表格中的显示形式，这正是 FR-010 要的。

**一处文档未覆盖、需在实现时验证的点**：官方文档没有专门说明前导零的行为。规格
FR-010 与 SC-002 明确要求 `007` 保持为 `007`。这取决于该单元格在表格中的类型：文本
单元格 `007` 在 `FORMATTED_VALUE` 下返回 `"007"`；而被存为数字 7、显示格式为「000」的
单元格同样返回 `"007"`。两种情况都符合要求，但**必须手工实测**，不能只靠推断（见 R7 与
`quickstart.md` 第五节）。

---

## R4. 列出工作表：`spreadsheets.get` + `fields` 裁剪

**Decision**：用 `GET /v4/spreadsheets/{id}?fields=properties.title,sheets.properties`
取表格名与工作表清单，不取单元格数据。

**Rationale**：规格 FR-007 要求列出工作表供选择。不加 `fields` 裁剪时该接口会返回整个
表格的结构（含全部工作表的属性、条件格式、保护范围等），对一个只需要「有哪些工作表」
的下拉框而言是巨大的浪费。表格名同时取回，用于 FR-008a 的默认名称与失败文案。

---

## R5. 依赖选择：`google-auth-library` + 原生 `fetch`

**Decision**：新增依赖 `google-auth-library`（当前 11.0.2，6 个直接传递依赖）用于
JWT 签发与访问令牌缓存；两个 Sheets REST 调用用 Node 内置 `fetch`。

**Rationale**：

- **不用 `googleapis`**：它是覆盖全部 Google API 的巨型包（当前主版本 176），而本功能
  只调用两个端点。
- **不手写 JWT**：服务账号的令牌流程是「构造 JWT → RS256 签名 → 换取访问令牌 →
  按过期时间缓存」。Node 的 `crypto` 足以实现，但签名、时钟偏移、过期与重试是安全相关
  且容易微妙出错的地方，用官方库比自己写正确。
- **只用它做认证**：拿到访问令牌之后，两个 REST 调用用 `fetch` 更直接，也让端口的假
  实现不必模拟一个库的对象图。

**Alternatives considered**：`googleapis`（过重）、手写 JWT（安全相关，不值得）、
`jose` 等通用 JWT 库（仍需自己实现令牌交换与缓存）。

---

## R6. 配额与超时

**事实**（官方文档，2026 年 8 月）：每个项目每分钟 300 次读请求；只要不超过每分钟配额，
每日请求数不设上限；超限返回 `429 Too many requests`。官方另注明超出配额的请求计划于
2026 年晚些时候开始计费。

**Decision**：

- 不做客户端限流。规格 FR-014 已排除自动刷新，人工刷新的频率距 300 次/分钟极远。
- `429` 归入 FR-028 的失败原因分类，与「读不到该表格」并列，文案区分为「Google 侧暂时
  拒绝，请稍后再试」。
- **超时上限定为 30 秒**（规格 FR-018c 只要求「有上限」，数值留给本阶段）。依据：一次
  10,000 行的读取在正常网络下是数百毫秒到数秒；30 秒足以覆盖慢速链路，又远短于人会
  一直盯着转圈的耐心上限。超时按刷新失败处理。

---

## R7. 脱网测试策略

**Decision**：定义一个 `SheetsPort`，**所有测试**都注入假实现。本功能不新增任何依赖
网络的测试。

**Rationale**：规格 FR-040 与宪章原则 II 都要求脱网可跑。项目已有同形状的先例：打印机
驱动的 `fake-transport`、`dry-run-driver`。

宪章的「测试 MUST 确定性：禁止依赖真实时钟、随机数或**网络**」是无条件的，而其隔离条款
只为「需要**真实硬件**的测试」开口，措辞未涵盖「需要外部网络服务」。因此下面两点改为
**手工核实**而非测试——它们核实的是关于 Google 的事实，不是本系统的行为。

端口的形状要窄——只暴露本功能需要的两件事（列出工作表、读取一个工作表的值），而不是
包装整个 Sheets API。窄端口的假实现才写得出可信的失败场景：403、404、429、超时、
超行数。

**须手工实测、不能靠推断的两点**（步骤见 `quickstart.md` 第五节）：

1. R3 里前导零与日期在 `FORMATTED_VALUE` 下的实际返回值
2. 未分享的表格返回的是 403 还是 404（这决定 FR-028 的分类文案能否说准「需要分享给
   哪个邮箱」）

---

## R8. 凭据的加载与暴露面

**Decision**：环境变量 `ZENITH_GOOGLE_CREDENTIALS` 指向服务账号 JSON 文件路径。进程
启动时读取一次，解析出机器身份邮箱（`client_email`）留作展示；私钥只进
`google-auth-library`，不进任何其他数据结构。

**Rationale**：规格 FR-002 禁止界面提供上传入口，FR-004/FR-004a 禁止凭据出现在日志或
任何接口返回中。把私钥的作用域限制在「文件 → 认证库」这一条路径上，是让这两条可被
静态审查的最简办法：只要没有第二处引用，就不可能从第三处泄漏。

未配置时，`GET /api/google/status` 返回 `{ configured: false }`，界面据此禁用入口
（FR-005）。

---

## R9. 列变化的判定

**Decision**：把「新增列」与「减列或改名」的判定做成纯函数
`classifyColumnChange(oldColumns, newColumns)`，返回 `unchanged | added | breaking`
以及具体的列名差集。

**Rationale**：规格 FR-031/FR-032 对两者的处理截然不同（直接应用 vs 要求确认），而
Google 那边**无法区分「改名」和「删一列加一列」**——两者在表头上是同一个结果。因此判定
只看差集：旧列有而新列无者，即为 breaking，不论它是被删了还是被改名了。这一点必须写进
实现注释，否则会有人试图去推断「改名」而永远推断不准。

受影响的设计清单沿用既有的 `bindingIssue` 计算逻辑（读取时计算，不存储），只是提前在
确认环节先算一次。

---

## Sources

- [spreadsheets.values.get — 查询参数与权限范围](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
- [ValueRenderOption — 三种取值方式的定义](https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueRenderOption)
- [Sheets API 使用限制](https://developers.google.com/workspace/sheets/api/limits)
