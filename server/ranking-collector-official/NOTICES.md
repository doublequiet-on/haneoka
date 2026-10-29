# 来源与边界

Haneoka 工具源码沿用随包 LICENSE（MPL-2.0）。游戏协议和第三方依赖保留各自权利归属。

- core/total-descriptors.pb 是已有 Sirius 1.0.3 协议子集与日服 1.1.0 实际总榜响应验证的描述子，SHA256 为 e8225c67eb066c1cdb2232a4c95f661a460d54dd88420f634ea2c8242de71adf。players 的 player_data、score、high_score_deck 已用于实测；my_rank / my_score 字段编号仍为暂定，采集输出不使用。协议描述不属于 Haneoka 的 MPL 授权。
- core/http2.py 与 core/transport.py 是 Python 的固定日服只读 HTTP/2 传输；允许的方法和官方 origin 固定，不提供注册或登录。官方 Master 获取参考本仓 scripts/ingest/master.py、scripts/ingest/apks.py 和 scripts/extract/master.py 的合同。
- protobuf 6.33.0：BSD-3-Clause，完整许可在固定通用 wheel 的 dist-info 目录内。
- h2 4.4.1、hpack 4.2.0、hyperframe 6.1.0：MIT，完整许可随各固定 wheel 保留。
- py3rijndael 0.3.3：MIT，固定 PyPI 源码包未包含许可文件，另随包保留上游 https://github.com/meyt/py3rijndael/blob/master/LICENSE 的完整文本于 LICENSE.py3rijndael.txt。
- setuptools 80.9.0 与 wheel 0.45.1 是离线安装 py3rijndael 所需的构建依赖；完整许可和其捆绑依赖许可随各 wheel 保留。版本及摘要见 build-requirements.txt。
- Python 由操作者安装，工具不携带运行时。

构建器只收录固定源码清单和校验过的七个依赖包，不收录客户端用户名、CDN 密码、解码参数、游戏账号凭据、数据库、运行日志、玩家正文或虚拟环境。MANIFEST.json 记录全部组成文件摘要。实服验收与候选包构建分别记录；此工具不加入网站部署。
