# 契约：`SheetsPort`

Google 与本系统之间唯一的接触面。**所有测试都注入假实现**——本功能不存在依赖网络的
测试（FR-040、宪章原则 II）。真实实现只在运行时使用，其行为中有两点必须手工核实，
见 `quickstart.md` 第五节。

先例：打印机驱动的 `fake-transport` 与 `dry-run-driver` 是同一形状。

---

## 形状

```ts
export interface SheetsPort {
  /** 表格名与其中的工作表清单。不读单元格。 */
  listWorksheets(spreadsheetId: string): Promise<SpreadsheetInfo>

  /** 一个工作表的全部取值，首行即表头。取值已是显示文本。 */
  readWorksheet(spreadsheetId: string, worksheetTitle: string): Promise<string[][]>
}

export interface SpreadsheetInfo {
  title: string
  worksheets: ReadonlyArray<{ id: number; title: string }>
}
```

**端口只有这两件事。** 不包装整个 Sheets API——窄端口的假实现才写得出可信的失败场景，
宽端口的假实现会变成第二个需要维护的 Google。

`readWorksheet` 取**标题**而非 id：Sheets 的读取接口用 A1 记法，只认标题。由调用方先
经 `listWorksheets` 把存下来的 `worksheetId` 换成当前标题——工作表改名后仍能读到，正是
这一步换来的（见 `data-model.md` §1）。

---

## 失败

所有失败以 `SheetsError` 抛出，`kind` 取自下列封闭集合。**这一组值是契约的一部分**：
规格 FR-028 的失败分类、REST 的 `outcome.reason`、CLI 的输出，全部由它派生。

| `kind` | 触发条件 | 界面文案要点 |
|---|---|---|
| `notShared` | HTTP 403 | 需要把表分享给 `<机器身份邮箱>` |
| `notFound` | HTTP 404 | 表格不存在或已被删除 |
| `worksheetMissing` | 按 id 在清单里找不到 | 工作表已被删除 |
| `credentialsInvalid` | HTTP 401，或密钥无法签发令牌 | 是凭据的问题，不是表格的问题 |
| `rateLimited` | HTTP 429 | Google 侧暂时拒绝，稍后再试 |
| `unreachable` | 网络层错误 | 连不上 Google |
| `timeout` | 超过 30 秒（研究 R6） | 超时 |

```ts
export class SheetsError extends Error {
  readonly kind: SheetsErrorKind
  /** 原始状态码，仅供 debug 日志；MUST NOT 直接展示给用户（宪章原则 III.0）。 */
  readonly status?: number
}
```

**`notShared` 与 `notFound` 的区分需要实测。** Google 对「存在但未分享」的表格返回 403
还是 404，决定了文案能否说准「需要分享给哪个邮箱」——这是本功能最常见的首次失败，说错
了人会去查表格是不是删了。研究 R7 已把它列为必须**手工核实**的两点之一
（`quickstart.md` 第五节）；在核实之前，实现应当把 404 也带上「或者尚未分享给
`<邮箱>`」的补充说明。

---

## 真实实现

- 认证：`google-auth-library` 用服务账号 JSON 签发 JWT，换取访问令牌并按过期时间缓存
  （研究 R5）
- 权限范围：`https://www.googleapis.com/auth/spreadsheets.readonly`（研究 R2）
- `listWorksheets` → `GET /v4/spreadsheets/{id}?fields=properties.title,sheets.properties`
  （研究 R4：不加 `fields` 会拉回整个表格结构）
- `readWorksheet` → `GET /v4/spreadsheets/{id}/values/{range}`，
  `valueRenderOption=FORMATTED_VALUE`（研究 R3；这也是 API 默认值，显式写出是为了让
  「为什么不是 UNFORMATTED」有个可读之处）
- 超时：30 秒，`AbortSignal.timeout`。**该时长 MUST 可注入**——否则测超时就得真等 30 秒，而宪章要求测试确定性

**私钥只在这里出现。** 从文件读入后直接交给认证库，不进任何其他数据结构，不进日志
（FR-004）。整个代码库中对私钥的引用只此一处——这让 FR-004 与 FR-004a 可以被静态审查。

---

## 假实现

```ts
export function fakeSheetsPort(script: {
  spreadsheets?: Record<string, SpreadsheetInfo>
  values?: Record<string, string[][]>      // 键为 `${spreadsheetId}/${worksheetTitle}`
  failWith?: SheetsErrorKind
}): SheetsPort
```

`failWith` 让每一种失败都能被无网络地测出来——包括 `timeout` 与 `rateLimited`，这两种
在真实环境里几乎无法按需复现。

### 值得被假实现覆盖的场景

- 参差不齐的行（后面的列缺失）→ 补空串，而不是让行的长度不一
- 表头有空单元格 → 与 CSV 导入同规则
- 表头有重复列名 → `CSV_DUPLICATE_COLUMN`
- 恰好 10,000 行 / 10,001 行 → 上限的两侧
- 只有表头没有数据行 → 合法，产生一个零行的数据源
- 一行都没有 → `GOOGLE_WORKSHEET_EMPTY`
