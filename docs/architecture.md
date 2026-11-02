# 架构与开发

通用MCP路径：`MCP客户端 → src/mcp-server.mjs → ClientActions → 本机认证RPC → Fabric真实玩家`。标准MCP不要求DeepSeek或直播平台。

DSH基础入口在`dsh`，通过宿主webServer挂载模式栏按钮和启动路由，打开浏览器控制台。插件安装器已安装的SDK/yaml/zod在工作区通过目录链接复用，首次启动创建日志目录；失效链接或不完整依赖可修复。默认托管工作区升级先备份源码，保留data/runtime；外部指定项目不自动覆盖。退出只清理拥有的进程。

## 环境准备

- `versions.json`固定12个游戏版本的官方客户端/服务端元数据及模组校验值。
- `src/versions.mjs`检查默认或指定目录内原版JAR的SHA1，识别第三方启动器版本文件夹；不同版本分开世界、数据库和模型记忆，保留旧1.21.4位置。
- `src/game-setup.mjs`负责检查、便携Java21、运行库与资源、预构建模组及版本启动配置。最终用户无需Git、Python、JDK或Gradle。
- `src/downloads.mjs`流式下载、校验、重试、取消和有界子进程。资源别名按目标路径去重，避免并发争用临时文件。
- `src/setup-state.mjs`记录实际阶段/进度/可恢复错误；控制台使用同一状态展示。Java、游戏、网络、占用端口、连接等失败有具体提示。
- `src/runtime.mjs`在真实玩家连接、状态读取和保存冻结后才进入ready；准备可取消，窗口关闭会使ready失效。

运行组件写在工作区；不改系统PATH、证书校验、代理、安全设置、自启或系统服务。游戏资源从官方源获取，客户端本体由使用者已有安装提供。下载只复用通过校验的完整文件。

## 游戏与显示

`client-actions/spatial/tunnel/mining`提供有界动作和反馈；`FishSpatialScan`及其他客户端类负责真实观测。上游固定版本JS运行时随包提供，来源与许可证保存在bundled/mcpfabric。

可选`packages/dsh-minecraft-stream`只切换基础控制台的直播显示模式。默认普通界面不显示鲸鱼/气泡；直播模式通过游戏内HUD绘制，浏览器绿幕保留作备用。没有弹幕接收或自动推流。`FISH_OVERLAY_URL`可为开发测试指定独立的挂件数据地址，默认仍为本机控制台。

## 容器窗口观察

`FishContainerState`只读当前真实玩家菜单，保留原生格子编号、背包格映射、空格、光标物品、槽位取放条件、窗口同步属性及交易报价。`container-state.mjs`按已知原版布局标记用途，相同取放条件按格子组压缩；未知布局保持unknown，不伪装为箱子。工作台、酿造台、铁砧、锻造/切石/织布/制图、交易和存储类窗口复用同一层。原生允许放入某物品不等于存在配方。

默认烹饪配方索引由`cooking_index.py`从对应版本官方客户端生成，解析标签并校验摘要；不要求用户编译或执行Python。熔炉输出与当前配方产物不兼容、输出满或原生禁止取出时明确报告。燃烧/烹饪、酿造、铁砧费用来自实际菜单同步属性；未知状态不推测。自定义数据包覆盖默认配方的情形未专项验证，索引来源会标明。

打开/传输后的工具结果附带新的结构化容器状态；关闭后验证实际界面，已关闭的重复请求返回SCREEN_ALREADY_CLOSED并进入原有重规划保护。这是观察和反馈能力，不代表所有特殊窗口按钮的自动操作都已实现。

## 移动镜头与环境发现

寻路开始时关闭Baritone的freeLook和remainWithExistingLookDirection，启用smoothLook，由实际路径控制镜头；不固定盯住终点坐标，不影响停下后的普通观察/交互瞄准。控制台继续使用原生玩家第一视角。

空间扫描附带当前位置客户端群系注册表ID。`discovery.mjs`只从射线可见体素归纳矿井、遗迹、紫晶、洞穴植被等组合线索，结构统一标possible；不查种子、服务器结构坐标或隔墙特征。当前位置群系是实测事实，结构名称是推断，二者不混用。重复看到同一地点不会每轮作为新发现。

连续矿道在每次挖开/推进后检查新线索；移动/探索/采集任务每约2秒检查，重要新发现时取消本人机械任务并返回interrupted/new_environment及真实部分进展。模型自行决定探索、避险或记位置后继续主线，不由程序预设探索路线。新事件可在动作同次请求附带reaction，已交付的事件不会下一轮反复标新；危急状态仍优先脱险。控制台空间详情展示群系、线索及新事件。

## 构建与验证

源码开发需要Node22.16+、Python、Git和JDK21；这些是维护者工具，不是最终用户的安装要求。

```powershell
npm ci --ignore-scripts
git clone --depth 1 --branch v0.8.0 https://github.com/denfry/mcpfabric.git vendor/mcpfabric
# 确认上游revision与vendor-lock.json一致。
python -X utf8 scripts/build_helpers.py
npm test
node scripts/check_package.mjs
npm pack --pack-destination outputs
```

`scripts/build_helpers.py`按版本生成兼容源并编译，Java构建产物位于artifacts/helpers，受Git忽略、由发布包携带。`scripts/bundle_runtime.mjs`从固定上游已编译dist生成随包JS副本；更新该副本前在上游mcp-server中使用仓库锁文件完成npm ci/build，保留MIT声明。

Fabric启动清单和Maven SHA1锁定在fabric-lock.json，按完整游戏/加载器版本校验，与发布包一起提供；更新versions.json的加载器或版本集合时运行 `node scripts/update_fabric_lock.mjs` 从官方接口重新生成，check_package会检查全部12版本。准备优先读取内置清单，再读runtime/versions/<版本>/fabric-metadata-<加载器>.json缓存，最后才联网补取；补取单次15秒、最多3次、可取消，全部校验值取得后才原子写缓存。二进制仍由downloadVerified逐一校验，不因使用内置清单而跳过完整性检查。

```powershell
node scripts/smoke_game.mjs --version 1.21.4 --minecraft-home D:/Games/.minecraft/versions/1.21.4/1.21.4.jar
```

省略路径时，该开发脚本从本机Gradle构建缓存复用官方客户端。它使用独立smoke-v3测试世界，真实启动/连接/挖木/截图/辅助效果/冻结/关闭，且不调用模型。输出证据在outputs/smoke；`record_validation.mjs`根据真实报告更新兼容表。可以只在本次子进程设置`FISH_PORTABLE_JAVA_ONLY=1`验证缺少系统Java时的自动下载分支。

2026-11-01安装验收使用独立DSH profile安装两个tarball，创建空工作区，强制只用便携Java。实测缺游戏提示、选择已有游戏目录、下载Java、取消/重试、准备并冻结、关闭游戏后的失效提示、缓存重开及原生气泡。它复用了本机已有DSH和游戏安装/资源，不等于全新Windows电脑或所有网络环境的验收；原生文件夹选择对话框仍需人工点选。

GitHub Actions按12版本编译，合并产物后运行测试、包内完整性及排除规则检查；版本标签通过构建后自动生成两个Release安装包。CI编译和本机实机验收分别记录，不互相替代。发布前应以新profile安装tarball验证，不在同一profile直接把仍指向开发源码的link安装替换为tarball。

世界、凭据、日志、下载、游戏JAR和测试数据不进入公开提交或发布包。敏感凭据始终留在DSH原位置或受控子进程环境；公开挂件接口不包含控制错误或密钥。
