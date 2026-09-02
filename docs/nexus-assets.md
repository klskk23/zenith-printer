# 把 nexus-assets 接到这台打印机

给两边的人各看一遍就够了。想知道某个决定为什么是这样，看
[`external-systems.md`](external-systems.md)——这里只讲怎么用。

两条方向相反的路，各自独立，可以只用一条：

| | 谁发起 | 什么时候用 |
|---|---|---|
| **拉** | Zenith | 有人站在打印机前面挑要打哪几台设备 |
| **推** | 台账 | 台账自己知道什么时候该出纸 |

---

## 一、部署方要做的（一次）

给 Zenith 配两个环境变量，指向台账：

```
NEXUS_ASSETS_SERVICE_URL=http://nexus-assets:8080
NEXUS_ASSETS_SERVICE_API_KEY=nxk_xxxxxxxxxxxx.yyyyyyyy
```

`.env.example` 里有同样的两行（注释掉的），容器部署见 `deploy/docker-compose.yml`。

三件要知道的事：

- **两个都配，或者都不配。** 只配一个的话集成保持关闭，并在启动日志里说明。它不会
  阻止服务启动——打印不依赖台账。
- **没配时界面上「从资产台账接入」这个入口整个不出现。** 和没配 Google 时一样。
- **密钥只从环境变量读，不落库、任何接口都不回显。** 换地址或轮换密钥，改这里重启即可，
  已经建好的数据源不用动。

Zenith 自己**没有认证**，所以它也从不通过网络接收凭证。把它放在局域网或 VPN 里。

## 二、台账要提供的两个接口

Zenith 只调这两个，都带 `Authorization: Bearer <key>` 和 `Accept-Language`：

```
GET /api/categories
→ [ { "id", "code", "name", "parent_id": null, "path": "/cat-net/", "display_key": "sn" }, … ]
```

`path` 形如 `/祖先id/…/自身id/`，Zenith 用它在下拉框里做缩进。`parent_id`、`path`、
`display_key` 可以不给，只是没有缩进。**多出来的字段会被忽略**——台账在类别上记着
`print_preset_ids` 这类自己的东西，Zenith 读不到也不需要。

```
GET /api/rows?category_id=<id>&include_descendants=true&offset=0&limit=1000
→ {
    "columns": ["sys_id", "sys_sn", "sys_category", "mac"],
    "rows": [ { "sys_id": "f3ee54e2", "sys_sn": "112394521950", … } ],
    "total": 30, "offset": 0, "limit": 1000
  }
```

四条硬要求：

1. **每行必须有 `sys_id`，非空且唯一。** 这是行的身份，重复或为空会拒绝整次刷新并列出
   是哪几个。
2. **所有值都是字符串。** 这边不做类型推断——`08` 猜成数字八，条码就少一个前导零。
3. **`columns` 权威且有序**，每行的键集合必须与它完全一致，不多不少。
4. `total` 大于已给行数时 Zenith 会按 `offset` 继续拉，每页 1000 行，**上限一万行**。

401 表示密钥不对，422 表示没带 `category_id`。两者 Zenith 会分开报，因为要修的是不同的人。

## 三、拉：使用者接入一个类别

在**数据源**页点「从资产台账接入」，**只选一个类别**——地址、密钥、用哪一列认行都不问。
选中后会先显示这个类别有哪些列，这样在建之前就知道设计里能写哪些 `${变量}`。

接好之后：

- 刷新按 `sys_id` 合并：同 id 更新、新 id 追加、台账那边删掉的删除，**存活的行留在原位**。
- 界面上的勾选也按 `sys_id` 走，**刷新之后选择不会被清空**；勾中的设备真的不在了，提交时
  会拒绝并说出是哪几个。
- 可以设**自动刷新间隔**（默认 0，只在点刷新时刷）和**打印前先刷新**（默认关）。
- 刷新失败不覆盖已有的行、也不挡住页面。台账宕了，这台机器照样能打印。

## 四、推：台账直接让它出纸

### 1. 在 Zenith 建一个打印预设

**打印预设**页，新建，选：哪个设计、哪台打印机、哪套打印参数、每行几份。把它的 **id**
抄给台账。

这四件事随时可以在 Zenith 这边改，台账不用动——这正是预设存在的理由。台账把这个 id 记在
类别上（`print_preset_ids`），一个类别可以挂多个。

台账侧填下拉框用这个：

```
GET /api/print-presets
→ { "presets": [ { "id": "b7b7b0be-…", "name": "路由器标签", "templateId": "…", … } ] }
```

`presets` 这个信封名是契约的一部分。

### 2A. 深链：把人带过去，参数摆好

```
{ZENITH_URL}/design/{templateId}?preset={presetId}
```

`templateId` 取自上面那个列表的 `presets[].templateId`。

打开后打印机、打印参数、份数**都已按预设摆好**，画布也跟着预设的纸型走。**不会自动出纸，
也不会自动弹出打印对话框**——按不按由人决定。`?preset=` 留在地址里，刷新和前进后退都不丢。

它只是初始值：人改了打印机之后，不会被改回去。

四种情况会在页面上出声，标签照常打开：

| 情况 | 会怎样 |
|---|---|
| 预设不存在 | 打印机**留空不选**，说明原因（不会静默用默认那台） |
| 预设指的打印机已删 | 同上 |
| 预设指的打印参数已删 | 其余照常生效，说明浓度与纸型没摆好 |
| 预设指向另一张标签 | **以地址里的为准**，不替人换掉他点开的那张 |

### 2B. 直接投递：台账自己出纸

```bash
curl -X POST {ZENITH_URL}/api/print-presets/{presetId}/print \
  -H 'Idempotency-Key: <这批活的唯一标识>' \
  -H 'Content-Type: application/json' \
  -d '{
        "columns": ["mac", "sys_sn"],
        "rows": [ { "mac": "001A2B3C4D5E", "sys_sn": "112394521950" } ],
        "copies": 2
      }'
```

```json
202 { "jobId": "40d56187-…", "status": "queued", "requestedCopies": 2, "seqClaims": [], "deduplicated": false }
```

拿 `jobId` 轮询 `GET /api/print-jobs/{jobId}`，和界面上提交的作业是同一套状态。

**请务必带 `Idempotency-Key`。** 同一个 key 重投拿回同一个 `jobId`、`deduplicated: true`，
不会多打一批。标签纸是实物，打出去收不回来。用工单号、批次号这类自然标识，不要用时间戳。

`copies` 可选，不给就用预设里的份数。行是一次性的，不会落库成数据源。

常见拒绝：

| code | 什么情况 |
|---|---|
| `VARIABLE_NOT_DEFINED` | 设计要的某个 `${名字}` 不在这批数据的列里，`details.references` 列出是哪些 |
| `BATCH_TOO_LARGE` | 行数 × 份数 > 1000。**不会自动拆**——怎么分该你决定 |
| `QUEUE_PAUSED` | 那台打印机的队列被人暂停了（409） |
| `VALIDATION_FAILED` | 打印机还没探测过，没人知道它的头有多宽 |
| `NOT_FOUND` | 预设、或它指向的设计/打印机不在了 |

## 五、接不通时先看哪里

| 现象 | 多半是 |
|---|---|
| 数据源页没有「从资产台账接入」 | 两个环境变量没配全，看启动日志 |
| 点了之后报「不认这台机器的密钥」 | 密钥被轮换或吊销了，改环境变量后重启 |
| 报「连不上」 | 地址不对，或台账超过 30 秒没答完 |
| 报「回来的不是行信封」 | `details.detail` 会指出是哪一行的哪个键不对 |
| 刷新报 `sys_id` 重复或为空 | 台账侧的数据问题，`details` 里列出了具体值 |
| 深链打开了但参数没摆好 | 页面底部有一条黄色提示说明原因 |

错误都是 `{code, what, why, next}` 四段，`what` 和 `next` 可以直接摆给人看。
