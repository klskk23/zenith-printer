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

数据（SQLite 与上传的图片）落在具名卷 `zenith-data`，**不进镜像**。`docker compose down`
带不走它；`docker volume rm zenith-data` 是唯一能弄丢它的命令，那得有人真心想。

镜像里有两处容易被绕过的坑，Dockerfile 里各有一道断言：

- **前端产物必须带字体**。`packages/web/public/fonts/subset` 是个符号链接，缺了它 vite
  照样构建成功，只是 bundle 里一个字体都没有。构建后 `test -d .../dist/fonts/subset`。
- **npm 必须是 12**。`package.json` 里的 `allowScripts` 是 npm 12 的机制，npm 11 不认得，
  会去真编译三个本项目根本不 import 的 BLE 原生模块，然后因为镜像里没有 g++ 而失败。

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

抓串口原始字节能看得更清楚——26.4 下应答其实到了，只是在超时**之后**、进程拆链路时才冒
出来：

```
node 26.3:  << 55 55 c2 ...   << 55 55 b5 ...   << 55 55 48 ...   （十个包，握手走完）
node 26.4:  Error: Timeout waiting response (waited for c2)
            readable-events=0  bytes-read=0
            << 55 55 c2 01 03 c0 aa aa    ← 迟到的应答
```

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

## 五、发布流水线（GitLab CI）

`.gitlab-ci.yml`。**只有推送 `vX.Y.Z` 标签才会触发**，其他任何 push 和 MR 都不起流水线
——日常检查是 GitHub workflow 的活，这条线只负责把一个标签变成 `/opt/www/zenith-printer`
下一个能 `docker load` 的镜像，以及旁边那份跑它的 compose 文件。

```
preflight  →  verify  →  build-image  →  publish
 (秒级)      (全量测试)   (构建 + 冒烟)    (/opt/www)
```

运行器是 **docker executor**，tag `nkg-debian`，配置见 `deploy/ci/gitlab-runner.toml`。
两条 volume 缺一不可：`/opt/www/zenith-printer`（否则产物无处可去）和
`/var/run/docker.sock`（否则根本构建不出镜像）。`preflight` 两条都查，缺了直接点名。

> **socket 挂载是一次实打实的授权**：能碰到它的 job 就能起特权容器，也就等于这台宿主机
> 的 root。这里可以接受，只因为这个 runner 只服务这一个项目，而这个项目的部署形态本来
> 就是同一台机器上的特权容器——没有多给任何东西。共享 runner 是另一回事，应当换 rootless
> daemon 或 dind。

### preflight 为什么不装工具链

它存在的意义是**几秒内失败**，所以版本号是用 sed 从 `package.json` 里读的，而不是先装
Node 再 `node -p`。它查三件事：`/opt/www` 挂没挂上且可写、docker socket 在不在，以及——

**标签必须和 `package.json` 对得上。** 版本号只有一处，标签只是这次发布的名字。对不上
意味着有人打标签时忘了改版本。

```bash
npm version 0.2.0 --no-git-tag-version
git commit -am "chore: 0.2.0"
git tag v0.2.0 && git push origin v0.2.0
```

### publish 放什么

| 文件 | 说明 |
|---|---|
| `zenith-printer_vX.Y.Z.tar.gz` | `docker save | gzip`，目标机 `docker load <` 即可 |
| `zenith-printer_latest.tar.gz` | 相对符号链接 |
| `docker-compose.yml` | 跑它的那份文件。镜像不配 compose 是半个答案，而人们错的正是这一半 |
| `SHA256SUMS` | 每次重新生成，只收真实文件 |

**同一个版本不会被悄悄覆盖。** 目标文件已存在就直接失败：一个版本号应当只对应一个镜像，
覆盖之后磁盘上没有任何东西能说明别人装的是哪一个。要重发就显式 `FORCE_PUBLISH=1`。

### 每个 job 都自己装环境

`deploy/ci/setup.sh`，约一分钟，换来一个没人需要手工维护的构建环境。真嫌慢，
`deploy/ci/Dockerfile` 把同样的环境烤成镜像，改一行 `image:` 即可。

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
