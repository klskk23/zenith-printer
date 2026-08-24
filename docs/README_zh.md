# Zenith Printer

在浏览器里设计标签，用桌上那台标签机打出来。局域网内一个容器跑完——不上云、不用注册、
不需要反向代理。

**[English →](../README.md)**

- **浏览器里的编辑器**：SVG 画布，文字、条码、二维码、图片，标尺、吸附、撤销。
- **可变字段与数据源**：手工填、从序号池取、上传 CSV，或者链接一张 Google 表格，想刷新
  的时候再刷新。
- **两类打印机**：精臣走 USB 串口，霍尼韦尔走 ZPL over TCP 9100。
- **渲染确定性**：字体随镜像走并且关掉了系统字体，同一个模板在任何机器上打出来一模一样。
- **amd64 与 arm64 通吃**：一个 tag 同时服务两者，树莓派和机架服务器拉的是同一个名字。

## 快速开始

```bash
curl -O https://raw.githubusercontent.com/klskk23/zenith-printer/main/deploy/docker-compose.yml
docker compose up -d
```

然后在同一网段的任意机器上打开 `http://<主机地址>:3000`。

数据（数据库和上传的图片）落在 compose 文件旁边的 `./data`。换机器就是 `rsync -a data/`，
没有第二步。

> 首次拉取如果提示未授权，是 GitHub Packages 默认私有：去仓库的 Packages 页面把
> `zenith-printer` 改成 public，或者先 `docker login ghcr.io`。

## 跑之前要知道的两件事

**容器是 privileged 的，并且把宿主机的 `/dev` 挂了进去。** 精臣打印机是随插随拔的 USB
CDC 设备，只给 privileged 不够：Docker 给特权容器的 `/dev` 是一份 **tmpfs**，即容器启动
那一刻的设备节点快照，之后插上的打印机永远不会出现。两条设置都在 compose 文件里，理由就
写在旁边。

**没有鉴权。** 能连到 3000 端口的人都能打标签，也能取消别人的任务。这是「桌边工具」这个
定位下有意的取舍——请把它留在局域网或 VPN 里，别放到能通外网的地方。

## 日常用法

### 打印一张标签

1. 打印机页面添加设备（精臣填 `/dev/ttyACM0`，霍尼韦尔填 `IP:9100`），点**探测**读出
   型号和分辨率——没探测过的打印机不能打印，因为没人知道纸多宽。
2. 标签设计页画好，保存成模板。
3. 点打印，确认份数和行数。

### 让标签内容来自表格

数据源页可以上传 CSV，也可以**链接一张 Google 表格**（需要部署方配好服务账号，见
[`deploy/README.md`](../deploy/README.md)）。链接的表在本机只读，内容改动回 Google 那边做，
这边点刷新。

设计里用 `${列名}` 引用某一列。打印时选行、选正序倒序、翻页勾选。

### 清理没人用的图片

粘贴到设计里的图片会立刻上传，被丢弃的粘贴就留在了服务器上。设置页最下方「服务端维护」
里有一个按钮，或者：

```bash
docker compose exec zenith-printer \
  node --experimental-strip-types packages/cli/src/index.ts images-prune --delete
```

只会删掉**没有任何设计引用、且上传超过 24 小时**的图片；还在用的、以及刚粘上去还没保存
的，都不会动。

## 从源码构建

```bash
make            # 看有哪些目标
make doctor     # 看这台机器缺什么
make check      # typecheck + lint + 测试
make image      # 构建部署镜像
make up         # docker compose up -d
```

需要 Node 26（**不能是 26.4 及以后**——那些版本的串口读取会停摆，打印机会表现为「连不上」，
详见 [`deploy/README.md`](../deploy/README.md)）和 npm 12。

## 更多文档

| | |
|---|---|
| [`deploy/README.md`](../deploy/README.md) | 构建、部署、发布、排查（最厚的一份） |
| [`docs/design-consensus.md`](design-consensus.md) | 架构为什么是现在这样 |
| [`docs/google-sheets-data-source.md`](google-sheets-data-source.md) | Google 表格数据源的设计共识与否决项 |
| [`.specify/memory/constitution.md`](../.specify/memory/constitution.md) | 这份代码库受哪些规矩约束 |

## 许可

暂无。仓库里没有 LICENSE，也就意味着没有授予任何权利——它公开出来是为了被阅读、被参与它
的人部署，而不是被复用。等有人决定该写什么的时候再说。
