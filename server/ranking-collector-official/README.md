# 官方目录隔离版本

本版本从官方 Version 与官方 CDN 的 MasterEvent、MasterChallengeMusic、MasterParameter 生成活动目录，无 Moenotes 请求或回退。该工具独立运行，不更改既有网站或机器人的数据源。

当前状态：动态 CDN 认证、当前官方 Master 获取和目录落库已通过独立实服入口验证。跨活动切换、空档和回退拒绝通过固定表/模拟时间验证；真实跨期与连续榜单采样尚未验收。本目录不作为可发布替代包。

## 本地准备

使用独立 Python 3.12 虚拟环境，安装 protobuf==6.33.0、py3rijndael==0.3.3。PowerShell 7 用于官方 Version/榜单传输。

`collector.py init --output <全新目录> --credentials <游戏凭据路径> --master-config <独立私有配置路径>`

然后沿用 `doctor`、`run/start`、`stop/resume`、`status`、`serve`、`backup`。缺配置时拒绝启动。
私有配置结构：masterRemoteRoot 为已核实的日服官方 master 根地址；cdnUsername 为从已授权日服客户端定位的 CDN 用户名；masterCrypto 包含 salt/key/iv 十六进制值。配置放在工具和运行目录之外，不提交、不打包、不写入回执。现有 Haneoka 私有管线配置不一定能直接使用，需要按以上字段转换。不得用游戏账号 credential 代替 CDN 认证。

每次目录发现独立匿名获取 Version，从 x-sirius-env 校验官方源，从 x-sirius-cred 取得当前密码，在内存构造认证头；密码只经子进程捕获管道传递，不写回执或配置。401/缺失密码/来源异常令该轮失败，下一轮重新发现，不回退第三方目录。每次获取版本匹配的清单，校验三张表大小/SHA256再解码。表缓存按版本隔离并原子替换；损坏的本地缓存按当前清单重新获取，远端大小或摘要不匹配则拒绝。全部表成功后才替换活动目录，部分下载不产生可用目录。失败保持历史库，当前轮不采集；没有猜测新活动或无限沿用过期目录。

JP时间显式按UTC+9转换，挑战表字段是原生拼写 `_stratAt`；空挑战窗口继承活动窗口。开关来自 `_isMusicRankingDisabled` / `_isTotalMusicRankingDisabled`；结算秒数来自 MasterParameter 的 event_ranking_aggregation_time。活跃活动优先于上一活动聚合期；存在多个活跃活动时拒绝猜测。窗口外 event=null。最高已接受活动编号 highestEventId 与目录在同一数据库提交中保存，状态文件落后或空档后重启仍拒绝回退。真实跨期与结束边界还需同版本客户端/实服验收。

接口及网站接入方案见 [INTERFACES.md](INTERFACES.md)。网站页面、生产 Worker 和 Taki 尚未切换。

仅验证目录（不读取游戏凭据、不请求榜单）：

```powershell
python collector.py catalog --output <独立目录> --master-config <外置静态配置> --client-version 1.1.0 --proxy http://127.0.0.1:7890
```

该入口与采样循环共用 refresh_catalog，写入目录数据库、discovered-event.json 和换期高水位；拒绝已有采集运行目录。进入空档时目标文件写入 event=null，失败保留上次目录但命令报错。实际榜单采样仍通过 init/start 启动，不要与其他采集实例并行使用同一账号。

## 离线候选包与安装

构建只写新ZIP，不启动服务或采样；实服验收结果单独记录。先将固定依赖放入独立wheelhouse：protobuf 6.33.0的Windows x64 wheel、py3rijndael 0.3.3源码包、setuptools 80.9.0与wheel 0.45.1的wheel。下载阶段可联网，build.py会核对四个摘要；setup.ps1仅从包内安装，不联网。

```powershell
python build.py --wheelhouse <依赖目录> --output <新的ZIP路径>
# 解压到独立目录后，在该目录运行：
pwsh -NoProfile -File ./setup.ps1 -Python <Python3.12解释器>
./.venv/Scripts/python.exe ./collector.py doctor
```

setup创建工具内的.venv，先离线安装固定构建依赖，再从已校验源码包构建解码库。账户和Master配置始终放在工具及运行目录之外。候选包中没有真实数据或私有配置，换机器后需另行配置获授权的账号与Master参数。

## 有界运行与恢复

```powershell
./.venv/Scripts/python.exe ./collector.py init --output <全新运行目录> --credentials <外置日服凭据> --master-config <外置Master配置> --hours 0.2 --interval 300 --client-version 1.1.0 --proxy http://127.0.0.1:7890
./.venv/Scripts/python.exe ./collector.py start --output <运行目录>
./.venv/Scripts/python.exe ./collector.py status --output <运行目录> --verify
./.venv/Scripts/python.exe ./collector.py stop --output <运行目录>
./.venv/Scripts/python.exe ./collector.py resume --output <运行目录>
./.venv/Scripts/python.exe ./collector.py serve --output <运行目录> --port 18779
./.venv/Scripts/python.exe ./collector.py backup --output <运行目录> --destination <运行目录外的新备份路径>
```

start返回实际PID，后台窗口隐藏。stop等待当前请求结束，并在后续请求、重试和等待期间检查停止文件与截止时间；resume沿用原截止时间，拒绝已complete的运行，代码/协议/运行配置变动须使用新目录。首次请求前持久化账号身份，发送榜单请求前再次核对实际读取凭据的账号摘要。HTTP401/gRPC16及HTTP403/gRPC7暂停相同认证字段；仅修改无关元数据不会解除暂停。外部凭据替换只接受同账号，不自动签发或登录。429/gRPC8遵守Retry-After；目录与榜单之间Master版本漂移时当轮拒绝采样，下一轮重新发现。不要让两个不同运行目录并行使用同一账号。

官方目录请求HTTP429或Version gRPC8同样遵守Retry-After，并把等待截止写入运行状态；等待期间不发现目录或采样。目录HTTP错误记录安全的阶段与状态码，不记录认证头。events/current返回读取时的ageMs、serverTimeMs和stale，超过10分钟或已越过所保存活动阶段时标为陈旧；保留原目录及其时间，不在GET中获取游戏数据或改写数据库。

状态查询短暂探测同一个进程锁；启动端最多等待1秒消化查询竞争，仍被占用则拒绝重复采集。安装时使用Windows扩展路径处理深目录；若运行环境限制系统临时目录改名权限，可仅在本次安装终端设置TEMP/TMP为自己可写的临时目录，无需修改全局设置。
