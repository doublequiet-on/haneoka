# 独立日服榜单采集器

采集器从官方 Version 与官方 CDN 的 MasterEvent、MasterChallengeMusic、MasterParameter 生成活动目录，再读取官方单曲榜和总榜，保存 SQLite 历史。HTTP/2、TLS、进程锁和安装入口均由 Python 实现，支持 Windows、Linux 和 macOS，不依赖 PowerShell。工具与网站、生产 Worker 及 Taki 的现有数据源分别运行。

## 环境与配置

推荐使用与仓库管线一致的 Python 3.13，最低支持 Python 3.12；Python TLS 需要支持 ALPN。运行依赖固定在 `requirements.txt`，通过离线安装入口创建独立虚拟环境。

游戏凭据使用获授权的日服导出文件，包含 `region=jp`、`origin=https://api.bang-dream-on.jp`，以及 `credentials` 中的 `player_id`、`credential` 和可选 `device_id`。Master 私有配置包含：

- `masterRemoteRoot`：`https://static.bang-dream-on.jp/master`；
- `cdnUsername`：从获授权客户端取得的 CDN 用户名；
- `masterCrypto`：`salt`、`key`、`iv` 的十六进制值。

两个配置文件都放在工具及运行目录之外，不提交或打包。游戏账号凭据与 CDN 认证分别使用。可选代理为本机 HTTP 代理，例如 `--proxy http://127.0.0.1:7897`；也接受 `localhost` 和 `[::1]` 的有效端口。

## 离线安装

在可联网的准备环境下载固定依赖，构建器会核对每个分发包的摘要。protobuf 使用通用 Python wheel，运行依赖不需要平台专用原生扩展；候选包不携带 Python 运行时。

```sh
python -m pip download --no-deps --only-binary=:all: --platform any --dest wheelhouse protobuf==6.33.0 h2==4.4.1 hpack==4.2.0 hyperframe==6.1.0 setuptools==80.9.0 wheel==0.45.1
python -m pip download --no-deps --no-binary=:all: --dest wheelhouse py3rijndael==0.3.3
python build.py --wheelhouse wheelhouse --output <新的ZIP路径>
```

解压后进入包目录，用目标 Python 安装。`setup.py` 会重建工具内的 `.venv`，只从包内 wheelhouse 安装固定依赖，再运行不联网的 `doctor`；运行目录及外置配置不受影响。

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

匿名 Version 提供当前 Master 版本和动态 CDN 密码；来源固定为官方域名，密码只驻留内存，不写入请求文件、回执或配置。每次发现都获取版本匹配的 Manifest，并按大小及 SHA256 验证三张表后解码。表缓存按版本隔离并原子替换，损坏缓存重新获取。全部表成功后才提交目录，不回退第三方目录；窗口外写入 `event=null`。

JP 时间按 UTC+9 解析，挑战开始字段保留原生拼写 `_stratAt`。单曲和总榜开关来自官方 Master，聚合期来自 `event_ranking_aggregation_time`。多个活跃活动视为冲突；新活动优先于旧活动聚合期。最高已接受活动 ID 与目录同事务保存，状态文件落后、空档或重启都不会接受活动回退。挑战自己的窗口分别标记 `upcoming`、`nowOn`、`aggregation`、`finished`。

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

首次网络请求前持久化账号身份，发送时从一次凭据读取构造身份和认证头。HTTP401/gRPC16、HTTP403/gRPC7 暂停相同认证字段；修改无关元数据不会解除暂停，仅接受同账号凭据替换，不执行注册或登录。HTTP429/gRPC8 遵守 Retry-After，并将冷却时间写入状态。Master 版本漂移时不采样，下一轮重新发现。请求及重试也受各榜单的独立窗口限制。

每个成功或失败观测独立保存，空榜单与损坏数据分别处理。备份通过 SQLite 在线备份 API 获取一致快照，校验数据库、外键、观测关系和正文摘要，再通过硬链接原子创建新文件，不覆盖已有目标；备份目标文件系统需支持硬链接。

## 本地读取与验收范围

只读 API 绑定 `127.0.0.1`，接口及后续网站接入方案见 [INTERFACES.md](INTERFACES.md)。读取时按原观测时间计算年龄；GET 不访问游戏或改写历史。数据损坏返回错误，不作为空榜成功。

匿名 Version、目录投影、进程锁、离线安装、备份和接口检查分别记录；完整真实账号连续采样、凭据失效和实服跨活动切换仍需获授权账号验收。源码与离线包不会自动切换网站、生产 Worker 或 Taki。
