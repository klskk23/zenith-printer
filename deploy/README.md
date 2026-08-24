# 构建与部署

三件事：根目录 `Makefile` 负责检查依赖、跑质量门禁、出构建产物；`deploy/Dockerfile`
把服务打成一个镜像；`deploy/docker-compose.yml` 把它跑起来。

```bash
make            # 看有哪些目标
make doctor     # 看这台机器缺什么
make check      # CI 跑的那一套：typecheck + lint + test
make image      # 出镜像
make image-smoke  # 起一个一次性实例，调接口、渲一张中文标签、重启再调
make up         # docker compose up -d
```

---

## 一、部署形态：单个 privileged 容器

宪章 v1.4.0 把这条钉住了，理由值得在这里重复一遍。

**为什么不是 .deb + systemd。** 那条路要求每台目标机器先配 NodeSource 源——Debian 自带
的 Node 是 20/22，`apt install nodejs` 装不到需要的 26。依赖不满足时 dpkg 会拒绝安装
（这一步是对的），但每多一台机器就多一次外部源配置，且那台机器上的 Node 版本此后不再
受本项目控制。

**为什么不是自包含单二进制。** 那消除了外部依赖，代价是 Node 的安全更新从 apt 的责任
变成本项目的责任：出一次 CVE 就得重新打包发布。

容器同时避开两者：镜像自带运行时，而运行时更新是换一次基础镜像。

### 两条必须一起给的配置

```yaml
privileged: true
volumes:
  - /dev:/dev
```

**只给 `privileged` 是不够的。** Docker 给特权容器的 `/dev` 是一份 **tmpfs**——容器启动
那一刻的设备节点快照。精臣打印机是随插随拔的 USB CDC 设备，之后插上的那台永远不会出现
在容器里。bind 挂宿主机 `/dev` 交出去的才是真正的 devtmpfs，热插拔在那里可见。

容器内一句话可辨：

```bash
grep ' /dev ' /proc/self/mountinfo   # tmpfs = 快照；devtmpfs = 真的
```

### 代价写在这里

`privileged` 实际等同于宿主机 root。本服务本来就没有鉴权，所以它和整台宿主机一样，
**只能待在局域网或 VPN 上**。

---

## 二、镜像里有什么

两段构建。builder 装全套工具链、取字体、编前端；runtime 一样都不带。

| 内容 | 说明 |
|---|---|
| Node 26 运行时 | 来自 `node:26-trixie-slim` 基础镜像 |
| 生产依赖 | `npm ci --omit=dev`，且**点名不要 web 工作区**——react 那一坨已经编进 bundle，留着白占 80MB |
| 四个字体文件 | 构建时对 `MANIFEST.sha256` 校验过 |
| 前端产物 | 含 GB2312 子集字体 |
| 服务端 `.ts` 源码 | Node 直接跑，后端没有编译步骤 |

数据（SQLite 与上传的图片）落在**宿主机上的一个普通目录**，默认 `deploy/data/`（已在
gitignore 里），**不进镜像**。见下一节。

镜像里有两处容易被绕过的坑，Dockerfile 里各有一道断言：

- **前端产物必须带字体**。`packages/web/public/fonts/subset` 是个符号链接，缺了它 vite
  照样构建成功，只是 bundle 里一个字体都没有。构建后 `test -d .../dist/fonts/subset`。
- **npm 必须是 12**。`package.json` 里的 `allowScripts` 是 npm 12 的机制，npm 11 不认得，
  会去真编译三个本项目根本不 import 的 BLE 原生模块，然后因为镜像里没有 g++ 而失败。

---

## 二之二、持久化：目录，不是具名卷

```yaml
volumes:
  - ${ZENITH_DATA:-./data}:/data
```

选目录而不是具名卷，理由只有一条但足够：**搬机器时是 `rsync -a data/`，没有第二步**。
从具名卷里把数据弄出来要起一个一次性容器加一段 tar 管道——那种步骤人们会一直往后拖，
拖到机器已经没了为止。

顺带的好处：`docker compose down -v` 会删具名卷，而一个目录根本不在那条命令能碰到的
范围内。

路径相对 compose 文件本身，所以刚 clone 下来不用做任何准备就能跑。长期部署指到实处：

```bash
ZENITH_DATA=/srv/zenith-printer/data docker compose up -d
```

**必须放在本地文件系统上。** SQLite 需要能用的文件锁，NFS 和 SMB 上它不会拒绝，而是把
库写坏。

### 里面是什么

| | |
|---|---|
| `zenith.db` | 打印机、模板、数据源、任务历史 |
| `zenith.db-wal` / `-shm` | WAL 模式的伴随文件。服务正常停止时会 checkpoint 进主库 |
| `uploads/` | 标签里用到的图片 |

容器以 root 跑（privileged 是为了串口），所以这些文件在宿主机上是 root 属主，看和拷都
要 `sudo`。这是 bind 挂载换来迁移便利的代价。

### 搬到另一台机器

```bash
docker compose down                      # 让 WAL checkpoint 进主库，且没有写入者
sudo rsync -a deploy/data/ newhost:/srv/zenith-printer/data/
# 新机器上：
ZENITH_DATA=/srv/zenith-printer/data docker compose up -d
```

**先停服务再拷。** 服务运行中 `zenith.db` 的一部分内容还在 `-wal` 里，只拷主库会得到一
个少了最近改动的库。

> **图片会跟着走**（迁移 14 起）。`images.storage_path` 存的是文件名，目录来自部署配置
> （`ZENITH_UPLOADS`）。它原先存的是上传那一刻的绝对路径，于是把 `data/` 拷到 uploads
> 位置不同的机器上——或者从主机拷进容器，那里永远是 `/data/uploads`——每一行都指向不存在的
> 路径：模板还在、id 也对得上，但一张图都不显示。**文件在哪是机器的属性，而机器不可能被
> 记在一个会被拷走的文件里。** 老库首次启动时自动改写，不需要手工处理。

### 从旧的具名卷迁过来

早先的版本用的是具名卷 `zenith-data`。一次性搬过来：

```bash
docker compose stop
mkdir -p deploy/data
docker run --rm -v zenith-data:/from -v "$PWD/deploy/data:/to" alpine cp -a /from/. /to/
docker compose up -d
```

确认新库里东西都在之后，再 `docker volume rm zenith-data`——**先确认，后删**。

---

## 三、跑起来

```bash
cd deploy
docker compose up -d
docker compose logs -f
```

打开 `http://<局域网 IP>:3000`。

| 变量 | 默认 | 说明 |
|---|---|---|
| `TZ` | `Asia/Shanghai` | **标签上会印日期，容器默认是 UTC**。设错了跨班次的标签会印成前一天 |
| `LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug` |
| `ZENITH_IMAGE` / `ZENITH_VERSION` | `zenith-printer` / `latest` | 换镜像来源与版本 |
| `ZENITH_DRY_RUN` | 未设 | 设 `1` 走完除落纸外的全部动作 |

Google Sheets 数据源要一份服务账号密钥：把 compose 里那两行注释一起放开（一行只读
bind，一行 `ZENITH_GOOGLE_CREDENTIALS`）。**密钥绝不进镜像**——镜像会被复制、被推送，
而早先层里删掉的文件仍然在镜像里。

`stop_grace_period: 30s`：打印途中重启会让已打份数无法核实，服务在重启回来时会把那种
任务标记为「失败，份数未知」。先给它把压在打印头下的那张走完。

---

## 三之零、接口调试

侧栏「接口调试」是一个 Swagger 控制台，服务端在 `/api/openapi.json` 暴露 OpenAPI 文档。

```bash
curl http://<主机>:3000/api/openapi.json | jq '.paths | keys'
```

文档由服务端**从校验请求用的那套 zod schema 直接生成**，不是另写一份。手写的说明是第二个
事实来源，第一个忙起来的星期就会和真实接口分家。

三件值得知道的事：

- **控制台是按需加载的。** Swagger UI 是 1.3MB JS 加 180KB CSS，而这里绝大多数人是来打标签
  的。走 `React.lazy` + 动态 `import()`，主包只涨了约 11KB，那 1.3MB 只有打开这个标签页的
  人才会下载。有一条静态检查盯着这点，改成静态 import 会红。
- **「Try it out」调用的是正在运行的这台服务。** 提交打印会真的出标签、真的耗纸。
- **它没有放开任何原本关着的东西。** 本服务无鉴权，这些接口本来就对局域网内任何人开放；
  文档只是让它们变得可见。真要收起来，把 `/api/openapi.json` 挡在反向代理后面，或者去掉
  侧栏那个条目——但那不解决根本问题，鉴权才解决。

---

## 三之一、清理没人用的图片

往设计里粘一张图，**粘的那一刻就上传了**。所以每一次丢弃的粘贴、每一个放弃的草稿、每一个
被删掉的模板，都会在 uploads 里留下一个文件——而界面上从来不会提到它们，这正是它们只增
不减的原因。

**界面上**：设置页最下方「服务端维护」里有一个按钮，点一下、确认一次就删完。那张卡片
单独框起来并写明作用域——设置页开头说的是「只影响本浏览器」，而这个按钮对所有人生效。

**命令行**（适合挂 cron）：

```bash
zenith images-prune                      # 只报告，什么都不删
zenith images-prune --delete             # 真删
zenith images-prune --json | jq .bytesFreed
```

界面上没有「先出报告再删」那一步，是有理由的：一张没有任何设计引用、且过了宽限期的图片，
在产品里已经再也够不着了——列一遍只是多一个要点掉的屏幕。留下的是确认弹窗本身，因为删文件
不可撤销（宪章 III.0 对此有 MUST）。命令行保留报告模式，是因为那里没有弹窗可以承载这个问题。

服务在容器里，所以是：

```bash
docker compose exec zenith-printer \
  node --experimental-strip-types packages/cli/src/index.ts images-prune --delete
```

想定期跑就挂 cron——命令走 REST，跟浏览器用的是同一套判定。

### 什么算「还在用」

从设计里读出来，而不是靠一个计数器：`templates.elements` 和 `print_jobs.snapshot` 是
`assetId` 唯一可能出现的两个地方，逐个 JSON 走一遍收集。

> 原来确实有一个 `ref_count` 列想做这件事，但**没有任何代码给它加过一**。于是它对每一行
> 都读作 0，`DELETE /api/images/:id` 每次都把文件真删掉——包括打印记录还指着的那些。
> 快照能复制文字和数字，复制不了二进制，所以那条路径一直在悄悄弄坏历史（FR-051）。
> 这一版把列删了（迁移 13），换成每次去读设计——那个答案不会和设计本身走散。

### 三条不删的理由

| 情况 | 处理 |
|---|---|
| 某个模板还在用 | 保留 |
| 某条打印记录的快照还在用（哪怕模板早删了） | 保留，文件也留着 |
| **没人用，但太新** | 保留 |

最后一条是重点：粘贴即上传，所以从粘贴到第一次保存之间，那张图在服务端**没有任何引用**。
只按引用扫，会把别人正开着的编辑器里的图片删掉。默认宽限 24 小时——够覆盖一顿午饭、一场
会、一个通宵；判断错的代价是别人的活，而等一等的代价是几 MB。

`--min-age-hours` 可以按次调整，但把它调到 0 等于关掉这层保护。

### 读不出来就整体放弃

某个模板或打印记录的 JSON 损坏时，命令**整体失败、一个文件都不删**（`422`）。读不出来
意味着引用集合未知，而猜错的方向是把还在用的图片报成垃圾。

### 顺带清掉没有数据库记录的文件

写完文件、还没来得及记账就崩了，会留下一个孤儿文件。同一次扫描会带走它们，同样要满足
宽限期，报告里单独计数（`strayFilesRemoved`）。

---

## 三之二、探测打印机失败时

### 先确认 Node 版本——**26.4 及以后串口是坏的**

`deploy/Dockerfile` 把基础镜像钉死在 `node:26.3-trixie-slim`，这不是随手写的版本号。
**Node 26.4.0 打断了本服务依赖的串口读取路径**：打印机答了，但那份数据在 niimbluelib 的
一秒包超时之内没有被交给流，于是每一次探测都以 `Timeout waiting response` 收场，一台好
端端的打印机看上去像是死了。

同一台主机、同一台 B3S_P、同一份 node_modules，只换解释器：

| Node | 结果 |
|---|---|
| 26.0.0 | 握手 118ms，识别 B3S_P |
| 26.1.0 / 26.2.0 / 26.3.1 | 同上，正常 |
| **26.4.0** | **超时，型号 unknown** |
| 26.7.0 | 超时 |

给收发打上时间戳，能看出坏在哪一侧（毫秒为进程启动后的偏移）：

```
node 26.3:    14.5 -> 发出  035555c10101c1aaaa
              15.6 <- 收到  5555c20103c0aaaa          ← 1.1ms
              26.4 -> 发出  5555a50101a5aaaa
              27.0 <- 收到  5555b50a0402dac0...       ← 0.6ms，握手一路走完

node 26.4:    14.1 -> 发出  035555c10101c1aaaa
            1017.2    Timeout waiting response (waited for c2)
                      应答直到超时把事件循环叫醒之后才出现
```

**打印机答了。** 坏的是那份数据交给流的时机——串口 fd 可读这件事本身没能唤醒事件循环，
要等一个定时器到期把循环叫醒，数据才浮上来。`data` 和 `readable` 两种消费方式都一样。

实测覆盖：26.0.0 七次全成、26.1.0 / 26.2.0 各两次全成、26.3.1 七次全成；26.4.0 七次全败、
26.7.0 三次全败。握手正常时稳定在 116–121ms。

**没查清的部分**：是 Node 自己的 fd 轮询变了，还是 `@serialport/bindings-cpp` 的 poller
与之交互出了问题——黑盒测不出来，也没有去读 26.4 的变更记录。上面这些是实测到的现象，
不是对某个提交的引用。

所以：**镜像不要改用浮动的 `node:26` 标签**，那等于把版本交给运气。有一条测试专门盯着这
个钉子（`packages/server/tests/unit/node-version-pin.test.ts`），改成浮动标签或升到 26.4
以上都会变红。要升版本，先插上打印机跑
`zenith probe --address /dev/ttyACM0` 实测——测试套件全绿说明不了任何事，里面没有一行会
打开串口。

主机上做开发同理：`make doctor` 会在 26.4+ 上给出告警（只是告警，不拦——不碰打印机的活
不受影响）。

### 其次看日志。**niimbluelib 会把握手阶段的真实原因打到 `console.error`，而它自己吞掉了那个
异常**——所以原因多半已经在容器日志里，只是没进结构化日志：

```bash
docker compose logs | grep -iE "Unable to fetch printer info|Dropping invalid buffer|Timeout waiting response"
```

| 日志里出现 | 含义 |
|---|---|
| `Unable to fetch printer info (is it turned on?)` 后面跟着 `Timeout waiting response` | 设备协商上了，但下一个包没回。链路问题，见下表 |
| `Feature not supported` / `Print error N` | 设备答了并且拒绝了。这才是「关机重启」适用的情况 |
| `Dropping invalid buffer` | 串口里混进了不属于本次会话的字节——**多半有第二个进程在读写同一个口** |

服务这边现在会在 connect 阶段就重取一次型号信息并把真实原因带出来（超时报「连不上」、
设备拒绝报「拒绝了本次操作」、型号不认识则直接报出 model id），不会再一律说成
「打印机拒绝了本次操作」。

### 链路问题按这个顺序查

**1. 有没有第二个进程握着这个口。** 这是最常见的一条，而且容器让它更容易发生：`/dev` 是
和宿主机共享的，宿主机上跑着的开发服务器、上一个没停干净的容器、或者 ModemManager，都
能同时打开同一个 tty，然后各自吃掉一半的字节。

```bash
sudo lsof /dev/ttyACM0        # 或 sudo fuser -v /dev/ttyACM0
docker ps -a | grep zenith    # 有没有第二个容器
systemctl status ModemManager
```

**ModemManager 尤其要留意**：CDC-ACM 设备插上时它会主动打开并发 AT 命令探测，持续若干秒。
让它别碰这台打印机：

```bash
lsusb                          # 记下打印机的 idVendor:idProduct
sudo tee /etc/udev/rules.d/99-zenith-printer.rules <<'RULE'
SUBSYSTEM=="tty", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="YYYY", ENV{ID_MM_DEVICE_IGNORE}="1"
RULE
sudo udevadm control --reload && sudo udevadm trigger
```

**2. 口里有上一次会话的残留。** 进程被杀在半句话中间时，内核缓冲区里的字节会留到下一次
打开——niimbluelib 读到后报 `Dropping invalid buffer`，运气不好会连正确的应答一起丢掉。
拔插一次打印机，或者：

```bash
docker compose restart && sleep 3   # 让设备安静几秒再探测
```

**3. 确认容器看得见的是真设备而不是快照。** `privileged` 单给一半的那个坑（见第一节）：

```bash
docker compose exec zenith-printer sh -c "grep ' /dev ' /proc/self/mountinfo; ls -l /dev/ttyACM0"
# devtmpfs = 对的；tmpfs = 少了 /dev:/dev 这条挂载
```

---

## 四、字体

渲染器按宪章要求关掉了系统字体加载，只读 `fonts/full`，所以那几个文件的**字节**决定了
打印出来是什么样。

`make fonts` 有两个来源，按顺序：**系统字体**（但仅当它的哈希已经和清单一致），否则
**钉死版本的 Debian 包**——URL 与 .deb 的 sha256 都写在 `scripts/fetch-fonts.sh` 里。

第二个来源是后加的，因为原来「照抄本机现有的字体」让清单变成了一个无解的绊线：Debian 的
`fonts-dejavu-mono` 2.37-6 / -8 / -9 装出来的 `DejaVuSansMono.ttf` 是三份不同的文件，
于是在一台机器上校验通过的检出，在另一台上无论如何都过不去。钉住包版本之后，清单才成了
一个能被满足的约束。

（trixie 上的实际表现：三个 20MB 的 Noto 走系统，只有 487KB 的 DejaVu 需要下载。）

---

## 五、发布流水线（GitHub Actions）

两条工作流，都在 `.github/workflows/`。

`ci.yml`——每次 push 到 main 和每个 PR：质量门禁（typecheck、lint、测试、覆盖率），随后
构建一次部署镜像并冒烟。Dockerfile 坏了在这里发现，而不是等到打标签。

`release.yml`——**只有推送 `vX.Y.Z` 标签才会跑**：

```
preflight  →  quality-gate  →  publish
 (秒级)        (全量测试)      (构建 → 冒烟 → 推 ghcr)
```

`preflight` 只做一件事：**标签必须和 `package.json` 对得上**。版本号只有一处，标签只是
这次发布的名字；对不上意味着有人打标签时忘了改版本，那会让 `v0.2.0` 这个发布推出一个
`0.1.0` 的镜像。它几秒内失败，不占用后面四分钟的构建。

```bash
npm version 0.2.0 --no-git-tag-version
git commit -am "chore: 0.2.0"
git tag v0.2.0 && git push origin v0.2.0 && git push github v0.2.0
```

### 镜像发到 ghcr

```
ghcr.io/klskk23/zenith-printer:v0.2.0
ghcr.io/klskk23/zenith-printer:latest
```

推送用的是 Actions 自带的 `GITHUB_TOKEN`（工作流里声明 `packages: write`），**没有需要
保管或轮换的密钥**。

`deploy/docker-compose.yml` 默认就指向这个地址，所以一台新机器只要有 compose 文件，
`docker compose up -d` 就能跑起来，不需要先构建。想跑本地构建的镜像就覆盖 `ZENITH_IMAGE`。

### 先构建、冒烟，最后才推

镜像先 `load` 进本地 daemon 而不是直接 push：起一个一次性实例、调接口、**用随镜像的字体
渲一张中文标签**、重启再调一次。构建得出来但服务不起来，这种失败要在它拿到一个别人能 pull
的公开标签之前发现。

### amd64 和 arm64 都出

两个架构各在**自己架构的托管 runner 上原生构建**（`ubuntu-latest` 和 `ubuntu-24.04-arm`），
不用 QEMU：镜像构建里有 `npm ci` 和一次 vite 构建，模拟下会把四分钟的发布拖成大半个小时。
GitHub 的 arm64 runner 对公开仓库免费。

每一条腿都在自己的硬件上构建 → 冒烟 → **按 digest 推送、不带任何 tag**，最后由 `manifest`
job 把两个 digest 拼成一个 manifest list。所以：

```bash
docker pull ghcr.io/klskk23/zenith-printer:v0.2.0   # 两种机器上都拉到对的那个
```

不给每条腿单独打 `:v0.2.0-arm64` 这类 tag，是为了不留下让人误拉的东西——只有 manifest list
是打算被人叫出名字的。

两处保险：矩阵 `fail-fast: true`（少一条腿拼出来的 manifest 会悄悄把 amd64 镜像发给所有
arm64 机器）；拼完之后断言两个架构都在里面。

> **arm64 那条腿的第一次运行值得盯一下。** 本地用 QEMU 模拟验证过两次，两次都是模拟器
> 自己段错误（`qemu: uncaught target signal 11`，一次在 dpkg 配置 sympy 时，一次在
> esbuild 里），所以这条路径**没有在本地被证实过**——这不是 arm64 的反证，只是说明它只能
> 在真机上验。已知的前提都对得上：基础镜像有 arm64v8，sharp / resvg / serialport 三个原生
> 模块在 lockfile 里都有 arm64 构建。

CI 里 `image` job 也是双架构。放在那里而不是只放发布时，是因为它要抓的那类失败——某个依赖
没有 arm64 构建、基础镜像挪了位置——应该在引入它的那次改动上暴露，而不是三周后打标签时。

---

## 六、依赖检查

`make doctor` 一次性报告工具与产物状态，不改动任何东西。各目标另有各自的前置检查，
在开工前失败而不是中途——错误信息统一三段：**缺什么 / 用来做什么 / 该敲什么**。

| 需要 | 用来 | 缺了怎么办 |
|---|---|---|
| Node.js ≥ 26 | 直接运行 `.ts` 源码 | NodeSource 源 |
| npm ≥ 12 | `allowScripts` 只有 npm 12 认得 | `npm install -g npm@^12` |
| docker + compose v2 | 构建与运行镜像 | `sudo apt install docker.io docker-compose-v2` |
| python3 + fontTools + brotli | **仅**重新生成 `fonts/subset` | `python3 -m venv .venv && .venv/bin/pip install fonttools brotli` |

新克隆的仓库还缺一个东西：`packages/web/public/fonts/subset` 这个符号链接被 gitignore
了。`make build` 会先建好它，构建完还会检查产物里确实有字体。
