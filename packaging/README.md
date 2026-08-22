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
的**字节**决定了打印出来是什么样。`make fonts` 从系统字体目录取，随即对 `MANIFEST.sha256`
校验；校验不过就是构建失败，打包脚本开头也会再验一次。

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
