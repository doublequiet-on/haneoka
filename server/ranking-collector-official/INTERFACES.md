# 接口、来源与网站新鲜度

## 当前实现

| 层 | 输入 / 输出 | 网络、身份与时间 |
| --- | --- | --- |
| 官方主数据发现 | 官方 Version／国际服 GetServerList → 版本及分区 CDN；CDN → Manifest 与三张表 | 匿名发现；日服动态 CDN 密码只驻留内存，客户端用户名与解码参数外置，不经过 Moenotes |
| 活动投影 | MasterEvent + MasterChallengeMusic + MasterParameter → 当前活动、挑战、开关和窗口 | 沿用 Master 管线 UTC+9；保留 region、apiOrigin、独立 masterVersion／resourceVersion、表摘要和 catalogObservedAtMs |
| 榜单采集 | GetChallengeMusicRanking(challenge_music_id)、GetChallengeMusicTotalRanking(event_id) | 游戏专用身份；单曲与总榜分别保存，最多100条 |
| 本地历史 | 不可变正文摘要 + 独立观测 + 失败周期 | observedAtMs是接收时间；sourceFetchedAtMs保持null |
| HTTP读取 | localhost v2 | 只读数据库，GET不请求游戏、不中途登录、不写历史 |

采集端使用 Python 的 TLS 与 HTTP/2 实现，在 Windows、Linux 和 macOS 复用同一协议与数据库；没有 PowerShell 子进程或凭据请求文件。CLI、离线安装与进程锁的使用方式见 [README.md](README.md)。

接口前缀 `/api/v2/game/records/{region}`，region 为运行目录固定的 `jp`、`tw`、`en` 或 `kr`。其他分区路径返回 404：

| GET 路径 | 返回 |
| --- | --- |
| `/status` | `haneoka:ranking-status/1`；region、serverTimeMs、collectorStatus、samplingIntervalSeconds、lastSuccessfulObservationAtMs、ageMs、stale、pollAfterSeconds、catalogProvider |
| `/events/current` | 官方主数据投影；没有当前活动时event=null |
| `/events/{eventId}/challenges/{challengeId}/latest` | 指定单曲最后成功观测 |
| `/events/{eventId}/total/latest` | 四曲总榜最后成功观测 |
| 上述latest改为`history?after={cursor}` | observations与nextCursor，每页最多100条；失败也保留 |

榜单合同仍为 `haneoka:ranking-observation/2`，保留snapshotId、cursor、payloadHash、eventId、challengeId、players、provenance、stale。新增官方主数据来源不应冒充Moenotes采集时间。榜单原始玩家字段不是完整图片资源；名片图片下载未接入。

运行数据库以 `collector_identity` 持久绑定一个分区，观测和目录写入在同一事务内校验分区。读取旧日服库不添加元数据，写入时才采用其已存在的日服身份；混服数据及与配置或状态不符的区域拒绝读取。运行配置 `haneoka:official-ranking-collector/2` 要求显式 `region`，旧 `haneoka:official-jp-collector/1` 缺省仍为 `jp` 且只允许日服。

当前状态stale阈值为10分钟；状态接口的最后成功时间是全局最新值，**不能代替某一榜单自己的observedAtMs/stale**。collectorStatus是最后持久状态，不是操作系统存活证明；停止更新时仍须按age判断。全部接口Cache-Control:no-store；Host只接受当前端口的127.0.0.1或localhost，存在Origin时也只接受本机HTTP来源，其余返回403。404表示尚无该成功观测，400表示查询参数错误，存储损坏或读取失败返回500。数据损坏不能将空榜视为成功。

## 网站接入方案（尚未实施或部署）

1. 用户打开页面或切换活动立即读取当前活动及所选榜单。页面可见时每15秒轮询；隐藏时暂停，重新可见/网络恢复时立即刷新。请求串行，失败退避，避免重叠请求；切换活动取消旧请求并核对eventId/challengeId，旧响应不得覆盖新页面。
2. 用snapshotId判断是否有新观测，用observedAtMs显示数据时间，用serverTimeMs计算年龄而不是相信用户设备时钟。HTTP成功但snapshotId未变时，不能刷新“数据更新时间”。接口失败保留最后成功数据及其原时间，显示过期状态。
3. 当前多榜分别采集，并非同一时刻快照；页面不得把五榜拼接成“官方同时刻”。总榜必须读取官方total结果，不能自行相加四曲Top100。
4. 单次成功提交对读取可见后，15秒轮询会在下一次轮询拿到；300秒采样下的正常数据滞后目标约为300秒+本轮请求耗时+15秒。网络失败、游戏自身聚合延迟与浏览器暂停没有有限时延保证，必须标记陈旧。要更低延迟，需另行验证采样频率和限流，不能让每个访客直连游戏。
5. localhost接口只供本机验证。公网网站不能读取操作者电脑的127.0.0.1。未来需要独立常驻采集服务及HTTPS只读API，或将快照推送到获授权的数据入口。用户没有Haneoka服务器管理权限，不假设可修改其反代/数据库；先用独立API域名，需要网站维护者批准CORS/CSP和页面接入。游戏凭据与CDN配置永不进入浏览器。
6. 新版本上线时应保持v1与v2分开：原Haneoka网页v1仍使用Moenotes，新本地v2不是自动替代。Taki旧入口也未切换。迁移需明确客户端、数据来源、游标、历史保留、缓存及回滚，不能只改URL。

## 验收界限

独立目录转换/自动换期可用固定Master表及模拟时间验证；不能替代新活动真实发布、紧急关闭或当前客户端边界语义验证。当前官方获取已通过独立 catalog 入口实服验证；动态密码变化与换期使用隔离模拟验证。真实实服换期、新版连续榜单采样和公网网页及时刷新未验收。既有采集器实验与本版本证据分别记录，不将旧结果计入本版本。

目录包含 highestEventId 高水位（尚未接收活动时为0），活动空档仍保留；此字段用于重启后拒绝回退，不是当前活动ID。

挑战条目的status按自身窗口返回upcoming、nowOn、aggregation或finished；目录保留当前活动的全部挑战身份，实际采样再按窗口与开关选择目标。

`events/current` 的 `stale` / `ageMs` / `serverTimeMs` 在GET时计算；目录超过600秒、时间在未来或越过存储的活动阶段时为陈旧，`catalogObservedAtMs`保持原值。该读取不刷新目录、不改写SQLite。目录限流以`catalog_rate_limited`与持久`retryAfter`记录，其他HTTP错误以`catalog_failed`附安全阶段/HTTP/gRPC状态记录。
