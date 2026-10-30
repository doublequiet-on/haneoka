# 独立四服榜单采集器

采集器支持 `jp`、`tw`、`en`、`kr`，从官方 Version 与官方 CDN 的 MasterEvent、MasterChallengeMusic、MasterParameter 生成活动目录，再读取官方单曲榜和总榜。本地模式使用固定分区运行目录与 SQLite 历史；云端模式由区域 Durable Object 调度独立 Cloudflare Container，并通过 Worker 保存云端历史。HTTP/2、TLS、进程锁和安装入口均由 Python 实现，支持 Windows、Linux 和 macOS，不依赖 PowerShell。Taki 数据源独立维护。

## Cloudflare 云端模式

云端入口是 `cloud.py`，镜像定义为本目录的 `Dockerfile`，构建上下文也为本目录。镜像只复制代码、协议描述和固定依赖，使用非 root 用户运行；运行时不需要 Linux 常驻主机或本机读取 API。仓库配置启用日服采集、保持官方读取关闭，生产切换由两个独立配置控制：

- `OFFICIAL_RANKING_ENABLED_REGIONS`：实际采集区服，逗号分隔，例如 `jp,tw`。
- `OFFICIAL_RANKING_READ_REGIONS`：网站读取官方自采的区服，逗号分隔。先完成采集验收，再逐服启用读取；移除区服可切回原网站来源，保留自采历史。

每服设置一个 Worker secret：`OFFICIAL_RANKING_JP_CONFIG`、`OFFICIAL_RANKING_TW_CONFIG`、`OFFICIAL_RANKING_EN_CONFIG`、`OFFICIAL_RANKING_KR_CONFIG`。secret 的 JSON 结构为：

```json
{
  "clientVersion": "1.1.0",
  "credentials": { "region": "jp", "origin": "https://api.bang-dream-on.jp", "credentials": {} },
  "masterConfig": {}
}
```

`credentials` 使用本地模式的完整凭据文档；`masterConfig` 使用下文的同服 Master 配置。两者的真实值仅通过 secret 管理入口提供，不写入 `vars`、镜像或仓库。繁中 `credentials.region` 使用 `hk`，网站及调度仍使用 `tw`。缺少配置的区服不发出游戏请求。

将实际榜单 RPC 和 Master 解码均已验证的完整配置存为同名 GitHub Actions secret，再手动运行 `official-ranking-config.yml` 并选择区服。工作流使用锁定的 Wrangler 版本，先确认生产 Worker 存在，通过权限为 0600 的临时文件更新 Worker secret，随后触发既有 Worker-only 发布；配置内容不进入命令参数、日志或构建附件。区服采集开关仍以 `wrangler.jsonc` 为准，只有成功观测验收后才开启网站读取。

单次任务最多约两分钟，每榜请求前先持久确认 `attempt` 检查点，响应后提交独立观测；Worker 确认落库后才请求下一榜。HTTP 401/403、gRPC 7/16，以及 gRPC 2 且解码后的消息精确为 `authentication failed` 时，持久暂停当前凭据代际；HTTP 429、gRPC 8 保存冷却期限。回调网络失败使用同一载荷最多重试三次，仍未确认则中止本轮，不重发游戏请求。容器在已确认请求检查点、尚未确认观测时中断，会保留 `auth_uncertain` 暂停状态，更新真实凭据代际后恢复；重启不能清除暂停。

容器通过区域 Durable Object 的随机服务令牌接收 `/collect`，每次任务使用另一个随机令牌回调 `/api/internal/official-rankings/{region}/{runId}`。`OFFICIAL_CALLBACK_ORIGIN` 由 Worker 配置，生产值为 `https://haneoka.org`；回调拒绝重定向、其他主机及路径。`/health` 只返回就绪状态，不返回配置。私有配置和协议回执写入本轮权限受限的临时目录，任务退出后删除。

读取接口为同域 `/api/v2/game/records/{region}`，目录、最新榜单、历史和状态路径见 [INTERFACES.md](INTERFACES.md)。GET 只读已保存的数据，不触发游戏请求，也不刷新观测时间。容器重启后的进度及历史来自 Durable Object、D1 和私有 R2，不依赖容器文件系统。

容器可在安装了 Docker 的环境构建：

```sh
docker build -t haneoka-official-ranking:local server/ranking-collector-official
```

该命令从仓库根目录运行，只构建镜像，不配置凭据或启用生产采集。

## 环境与配置

推荐使用与仓库管线一致的 Python 3.13，最低支持 Python 3.12；Python TLS 需要支持 ALPN。运行依赖固定在 `requirements.txt`，通过离线安装入口创建独立虚拟环境。

游戏凭据使用对应区服的获授权导出文件，包含 `region`、固定官方 API `origin`，以及 `credentials` 中的 `player_id`、`credential` 和可选 `device_id`。日服使用 `region=jp` 与 `origin=https://api.bang-dream-on.jp`。日服 Master 私有配置包含：

- `masterRemoteRoot`：`https://static.bang-dream-on.jp/master`；
- `cdnUsername`：从获授权客户端取得的 CDN 用户名；
- `masterCrypto`：`salt`、`key`、`iv` 的十六进制值。

两个配置文件都放在工具及运行目录之外，不提交或打包。游戏账号凭据与 CDN 认证分别使用。可选代理为本机 HTTP 代理，例如 `--proxy http://127.0.0.1:7897`；也接受 `localhost` 和 `[::1]` 的有效端口。

## 国际服三个分区

`init` 和 `catalog` 使用 `--region tw|en|kr`，缺省仍为 `jp`。繁中网站标识为 `tw`，已有游戏凭据文件中的标识为 `hk`；英文和韩文分别为 `en`、`kr`。三服沿用各自已有游戏身份，工具不执行 SDK 登录或创建账号。

国际服先调用所选分区的匿名 Version，再通过官方 GetServerList 的 areaID（繁中 2、英文 3、韩文 4）发现该区 CDN。发现结果必须匹配固定官方 API、CDN 主机和区域路径，随后匿名获取 Master 清单和三张表。国际服外置配置只需 `masterCrypto`，不使用日服 CDN 用户名或密码；Master 版本与资源版本分别保留，榜单请求同时发送。两者独立，任一版本在目录发现与采样之间改变都停止本轮采样，下轮重新发现。Master 时间沿用仓库现有投影的 UTC+9 基准，不按网页语言或操作者时区转换。

凭据 `origin` 只接受同分区的静态官方来源：繁中为 l12/l14 HK，英文为 l14/l17 VA，韩文为 l14/l17 KR，完整主机名见 [分区合同](core/regions.py)。运行时使用凭据选定的 API 来源查询 Version、GetServerList 及榜单，再从发现结果对应的 CDN 读取目录；不会把另一来源签发的凭据自动转送到默认来源。采样前再次核对来源与目录版本，回执和观测保存实际 `apiOrigin`。仅检查目录的命令使用分区默认来源，不读取游戏凭据。

每服使用独立运行目录、数据库和 API 端口。错误分区的凭据在创建运行目录前拒绝，新目录使用 `haneoka:official-ranking-collector/2` 并立即在数据库绑定分区；已有目录不能切服。原 `haneoka:official-jp-collector/1` 只接受日服，缺少 `region` 时仍按 `jp` 读取，不重写旧配置。旧数据库的日服身份由原目录及观测推导，只读检查不迁移，写入时才保存身份；混服历史拒绝读取或续写。活动最高 ID 和历史游标分别保存在各服数据库，API 只接受该运行目录所配置的分区路径。

```sh
python collector.py catalog --region tw --output <繁中目录检查> --master-config <外置解码配置> --client-version 1.1.0
python collector.py init --region tw --output <繁中运行目录> --credentials <繁中已有游戏凭据> --master-config <外置解码配置> --hours 0.2 --interval 300 --client-version 1.1.0
python collector.py start --output <繁中运行目录>
```

英文和韩文分别指定 `--region en`、`--region kr`，使用对应凭据及全新目录。Master 获取失败保持失败状态，不回退到 Moenotes 或其他分区；凭据拒绝和限流沿用日服的暂停及退避机制。

## 离线安装

在可联网的准备环境下载固定依赖，构建器会核对每个分发包的摘要。protobuf 使用通用 Python wheel，运行依赖不需要平台专用原生扩展；候选包不携带 Python 运行时。

```sh
python -m pip download --no-deps --only-binary=:all: --platform any --dest wheelhouse protobuf==6.33.0 h2==4.4.1 hpack==4.2.0 hyperframe==6.1.0 setuptools==80.9.0 wheel==0.45.1
python -m pip download --no-deps --no-binary=:all: --dest wheelhouse py3rijndael==0.3.3
python build.py --wheelhouse wheelhouse --output <新的ZIP路径>
```

解压后进入包目录，用工具虚拟环境之外的 Python 安装；升级前先停止采集。`setup.py` 会重建工具内的 `.venv`，只从包内 wheelhouse 安装固定依赖，再运行不联网的 `doctor`；运行目录及外置配置不受影响。

```sh
python setup.py --python <Python3.13解释器>
# Linux / macOS
.venv/bin/python collector.py doctor
# Windows
.venv\Scripts\python.exe collector.py doctor
```

以下命令的 `python` 均指上述虚拟环境解释器。候选包不包含账号、Master 配置、数据库、日志或玩家数据。

## 仅发现官方目录

这个入口不读取游戏凭据，也不请求榜单：

```sh
python collector.py catalog --output <独立目录> --master-config <外置Master配置> --client-version 1.1.0
```

日服匿名 Version 提供当前 Master 版本和动态 CDN 密码；来源固定为官方域名，密码只驻留内存，不写入请求文件、回执或配置。每次发现都获取版本匹配的 Manifest，并按大小及 SHA256 验证三张表后解码。表缓存按版本隔离并原子替换，损坏缓存重新获取。全部表成功后才提交目录，不回退第三方目录；窗口外写入 `event=null`。

Master 时间按 UTC+9 解析，挑战开始字段保留原生拼写 `_stratAt`。单曲和总榜开关来自官方 Master，聚合期来自 `event_ranking_aggregation_time`。多个活跃活动视为冲突；新活动优先于旧活动聚合期。最高已接受活动 ID 与目录同事务保存，状态文件落后、空档或重启都不会接受活动回退。挑战自己的窗口分别标记 `upcoming`、`nowOn`、`aggregation`、`finished`。

`catalog` 拒绝已有采集运行目录，实际采样与该入口不共享同一输出目录。

## 有界运行与恢复

```sh
python collector.py init --output <全新运行目录> --credentials <外置日服凭据> --master-config <外置Master配置> --hours 0.2 --interval 300 --client-version 1.1.0
python collector.py start --output <运行目录>
python collector.py status --output <运行目录> --verify
python collector.py stop --output <运行目录>
python collector.py resume --output <运行目录>
python collector.py serve --output <运行目录> --port 18779
python collector.py backup --output <运行目录> --destination <运行目录外的新备份路径>
```

`start` 返回实际 PID，Windows 隐藏窗口，POSIX 使用独立会话。`run` 在前台执行，可由现有 Python 服务管理器托管；工具不注册系统服务。`stop` 与截止时间在连接、读取、请求间隔和重试等待中检查；单次 RPC 总预算为 20 秒。`resume` 沿用原截止时间，已完成的运行、采样代码或协议及配置变化需要新目录。进程锁随进程退出释放，状态查询与采集共用相同的锁实现。

首次网络请求前持久化账号身份与分区，发送时从一次凭据读取构造身份和认证头。HTTP401/gRPC16、HTTP403/gRPC7，以及上述 gRPC 2 认证拒绝，暂停相同认证字段；国际服还按分区及实际 API 来源隔离认证代际，修改无关元数据不会解除暂停。外部凭据替换只接受同账号，不执行注册或登录。HTTP429/gRPC8 遵守 Retry-After，并将冷却时间写入状态。目录来源或版本在采样前发生变化时停止本轮，下轮重新发现。请求及重试也受各榜单的独立窗口限制。

每个成功或失败观测独立保存，空榜单与损坏数据分别处理。备份通过 SQLite 在线备份 API 获取一致快照，校验数据库、外键、观测关系和正文摘要，再通过硬链接原子创建新文件，不覆盖已有目标；备份目标文件系统需支持硬链接。

## 本地读取与验收范围

只读 API 绑定 `127.0.0.1`，接口及后续网站接入方案见 [INTERFACES.md](INTERFACES.md)。读取时按原观测时间计算年龄；GET 不访问游戏或改写历史。数据损坏返回错误，不作为空榜成功。

匿名 Version、目录投影、进程锁、离线安装、备份和接口检查分别记录；完整真实账号连续采样、凭据失效和实服跨活动切换仍需获授权账号验收。源码与离线包不会自动切换网站、生产 Worker 或 Taki。
