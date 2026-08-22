# 构建与打包

两件事：根目录的 `Makefile` 负责检查依赖、跑质量门禁、出构建产物；
`packaging/deb/build-deb.sh` 负责把产物装配成一个 `.deb`。

```bash
make            # 看有哪些目标
make doctor     # 看这台机器缺什么
make check      # CI 跑的那一套：typecheck + lint + test
make deb        # 出 dist/zenith-printer_<版本>_<架构>.deb
```

---

## 一、依赖检查

`make doctor` 一次性报告工具与产物的状态，不改动任何东西。各目标另有各自的前置检查，
在开工前失败而不是在中途——错误信息统一是三段：**缺什么 / 用来做什么 / 该敲什么**。

| 需要 | 用来 | 缺了怎么办 |
|---|---|---|
| Node.js ≥ 26 | 直接运行 `.ts` 源码，没有编译步骤 | NodeSource 源；Debian 自带的是 20/22，不够 |
| npm | 按 lockfile 装依赖 | 随 Node 一起 |
| `dpkg-deb` | 打包 | `sudo apt install dpkg-dev` |
| python3 + fontTools + brotli | **仅**重新生成 `fonts/subset` | `python3 -m venv .venv && .venv/bin/pip install fonttools brotli` |
| `objdump`（可选） | 从二进制里读出真实的 glibc 下限 | 缺了就按 2.17 保守填 |
| `lintian`（可选） | `make deb-check` 时顺带查一遍 | `sudo apt install lintian` |

字体不是可选项。渲染器按宪章要求关掉了系统字体加载，只读 `fonts/full`，所以那几个文件
的**字节**决定了打印出来是什么样。

`make fonts` 有两个来源，按顺序：**系统字体**（但仅当它的哈希已经和清单一致），否则
**钉死版本的 Debian 包**——URL 与 .deb 的 sha256 都写在 `scripts/fetch-fonts.sh` 里。

第二个来源是后加的，因为原来"照抄本机现有的字体"让清单变成了一个无解的绊线：Debian 的
`fonts-dejavu-mono` 2.37-6 / -8 / -9 装出来的 `DejaVuSansMono.ttf` 是三份不同的文件，
于是在一台机器上校验通过的检出，在另一台上无论如何都过不去。钉住包版本之后，清单才成了
一个能被满足的约束。

（trixie 上的实际表现：三个 20MB 的 Noto 走系统，只有 487KB 的 DejaVu 需要下载。）

> 顺带修了一处：CI 里那句 `sha256sum -c fonts/MANIFEST.sha256` 是从仓库根目录跑的，而清单
> 里记的是裸文件名，实际每个文件都报 `FAILED open or read`。现在统一走 `make fonts-verify`。

新克隆的仓库还缺一个东西：`packages/web/public/fonts/subset` 这个符号链接被 gitignore 了。
没有它 vite 会照样构建成功，只是产物里一个字体都没有。`make build` 会先建好这个链接，
构建完还会检查产物里确实有字体。

---

## 二、Debian 包

### 为什么是 `dpkg-deb` 而不是 debhelper

规范的 Debian 源码包要求**离线**构建、依赖全部来自 Debian 已打包的库。本项目运行时有
约 240 个 npm 包，Debian 一个都没有收，其中三个（sharp、resvg、serialport）还带预编译
的原生二进制。要走 debhelper 那条路，等于先把这 240 个包一个个打进 Debian。

所以走的是**装配**路线：`npm ci` 在打包时跑，装出来的树原样进包。两个后果写在这里，
不藏着：

- **包是分架构的**。原生 `.node` 是按构建机的架构预编译的，所以脚本**拒绝**交叉构建——
  与其产出一个装得上、一跑就崩的包，不如当场失败。
- **`apt` 看不见这棵树**。某个 npm 包出了 CVE，修法是重新构建这个包，而不是升级系统库。

### 装出来是什么样

| 路径 | 内容 |
|---|---|
| `/opt/zenith-printer` | 运行时全部：`.ts` 源码、`node_modules`、前端产物、字体 |
| `/usr/lib/systemd/system/zenith-printer.service` | 服务单元 |
| `/etc/zenith-printer/zenith-printer.env` | **配置文件（conffile）**，改动在升级时保留 |
| `/usr/bin/zenith` | 命令行入口，走 REST |
| `/var/lib/zenith-printer` | 数据库与上传的图片，属主是 `zenith` |

`/opt` 下的目录结构必须和仓库一致：服务端用 `import.meta.url` 往上数三层求出自己的根，
字体和前端产物都是相对它找的。

单元文件里保留了 `Environment=` 默认值，后面再跟一句
`EnvironmentFile=-/etc/zenith-printer/zenith-printer.env`——systemd 后读的赢，于是手工
`cp` 一份单元也能直接跑，而装成包之后改的是 `/etc`，`apt upgrade` 不会把端口号改回去。

### 装配过程里的两道检查

1. **字体校验**，理由同上。
2. **把装好的树启动一次**，请求 `/api/frontend-build`。vendored 依赖只有一种典型失败：
   某个包在构建机上解析得到、在包里却没有。除了真跑一次，没有别的办法覆盖它。
   （`SKIP_SMOKE=1` 可以跳过，但那就是自己认下这个风险。）

glibc 的下限是用 `objdump` 从随包的二进制里读出来的，不是猜的。少了这条，包会在一台
太旧的系统上装得好好的，然后在第一次渲染时崩掉，而现场看到的现象会指向完全无关的地方。

### 卸载

`apt remove` 停服务、留数据。`apt purge` 另外删掉 `/etc` 里的配置，但**不删**
`/var/lib/zenith-printer`：所有人画过的标签模板都在那个数据库里，包重装不回来。
purge 会把它的位置和删除命令打在屏幕上，由人来做这个决定。

同理，`/etc/zenith-printer` 是用 `rmdir` 删的而不是 `rm -rf`——那个目录里可能放着管理员
的 Google 服务账号私钥，卸载脚本没有资格替他删。

### 装之前先看看

```bash
make deb-check        # 控制信息、文件清单，装了 lintian 就顺便跑一遍
dpkg-deb -c dist/zenith-printer_0.1.0-1_amd64.deb | less
```

---

## 三、版本号

只有一处：根 `package.json` 的 `version`。`.deb` 的文件名和 control 都跟着它走。
Debian 修订号用 `DEB_REVISION` 覆盖（默认 `1`）：

```bash
make deb DEB_REVISION=2
```

维护者字段默认取 `git config user.name/user.email`，也可以用 `DEB_MAINTAINER` 指定。

---

## 四、发布流水线（GitLab CI）

`.gitlab-ci.yml`。**只有推送 `vX.Y.Z` 标签才会触发**，其他任何 push 和 MR 都不起流水线——
日常检查是 GitHub workflow 的活，这条线只负责把一个标签变成 `/opt/www/zenith-printer`
下一个能装的 `.deb`。

```
preflight  →  verify  →  package  →  publish
 (秒级)      (全量测试)   (deb +      (/opt/www)
                          容器实装)
```

运行器是 **docker executor**，tag `nkg-debian`，配置见 `packaging/ci/gitlab-runner.toml`。
每个 job 从干净的 `debian:trixie-slim` 起，自己装环境（`packaging/ci/setup.sh`）——
一分钟左右，换来一个没人需要手工维护的构建环境。真嫌慢，`packaging/ci/Dockerfile`
把同样的环境烤成镜像，改一行 `image:` 即可。

### 运行器配置里唯一不能少的一行

```toml
volumes = ["/cache", "/opt/www/zenith-printer:/opt/www/zenith-printer"]
```

docker executor 只看得见挂进来的东西。没有这行，包会完整地构建出来，然后无处可去。
`preflight` 第一件事就是查这个，缺了直接点名。

宿主机上先建好目录（job 在容器里是 root，写进去即可，不需要额外授权）：

```bash
sudo install -d -m 0755 /opt/www/zenith-printer
```

`privileged` 是 **false**，也不挂 docker socket。实装测试曾经需要 docker-in-docker，
现在不需要了：job 容器本身就是个一次性的 Debian，包直接装在里面。

### preflight 为什么不装工具链

它存在的意义是**几秒内失败**。所以版本号是用 sed 从 `package.json` 里读的，而不是先
装 Node 再 `node -p`。它查两件事：`/opt/www` 挂没挂上、可不可写；以及——

**标签必须和 `package.json` 对得上。** 版本号只有一处，标签只是这次发布的名字。对不上
意味着有人打标签时忘了改版本，那会让 `v0.2.0` 这个发布往磁盘上放一个 `0.1.0` 的包。

```bash
npm version 0.2.0 --no-git-tag-version
git commit -am "chore: 0.2.0"
git tag v0.2.0 && git push origin v0.2.0
```

### publish 做什么

| 文件 | 说明 |
|---|---|
| `zenith-printer_<版本>_<架构>.deb` | 本次发布，0644，供 HTTP 下载 |
| `zenith-printer_latest.deb` | 相对符号链接，永远指向最新一次 |
| `SHA256SUMS` | 每次重新生成，只收真实文件（`latest` 是链接，不重复计入） |

**同一个版本不会被悄悄覆盖。** 目标文件已存在就直接失败：一个版本号应当只对应一个二进制，
覆盖之后磁盘上没有任何东西能说明别人装的是哪一个。确实要重发，把 `FORCE_PUBLISH` 设成
`1` 跑一次。旧版本不会被自动清理——那是删除已发布产物，交给人做。

### 变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `PUBLISH_DIR` | `/opt/www/zenith-printer` | 产物落点，必须与 runner 的 volume 一致 |
| `DEB_MAINTAINER` | 触发者的名字与邮箱 | Debian control 的 Maintainer；设成项目变量可固定为团队别名 |
| `INSTALL_TEST` | `1` | 设 `0` 跳过容器实装测试。跳过的是这条线上最强的一道检查 |
| `FORCE_PUBLISH` | `0` | 设 `1` 允许覆盖已发布的同名文件 |

### 为什么 CI 里要显式装 npm 12

`package.json` 里有 `allowScripts`，那是 npm 12 的机制：npm 12 认得它，于是拒绝执行三个
BLE 包的安装脚本——那三个包本项目一行都不 import。而 NodeSource 的 nodejs 26 当前捆的是
**npm 11**，它不认得，照跑不误，node-gyp 随即因为没有 g++ 而失败。

装个编译器也能"修好"，但那是去编译一份服务永远不会加载的代码。对齐 lockfile 当初所用的
npm 才是真的修好。`make check-node` 现在会直接把这条讲出来，而不是让人从 npm 两百行输出
里自己看出来。
