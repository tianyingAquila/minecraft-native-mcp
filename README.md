# Minecraft Native MCP

[English](docs/README.en.md) · [兼容与验证](docs/compatibility.md) · [架构与开发](docs/architecture.md) · [直播扩展](docs/streaming.md)

让 DeepSeek 或其他 MCP 客户端操作真正的 Minecraft Java 生存玩家。保留原生第一视角、血条、饱食度和物品栏，提供空间概览、采集合成、寻路战斗、连续矿道和异常截图诊断。容器观察统一提供真实槽位/用途、空格、光标持物、原生取放条件和可用进度；熔炉等窗口会给出明确阻塞原因。移动镜头跟随寻路方向，空间摘要包含真实群系和可见环境线索；遇到新线索时，长段机械任务会提前交回模型评估探索机会。

## DSH 安装与开始

```powershell
dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/minecraft-native-mcp.tgz
```

重新打开 DSH，在输入框上方 **标准模式右侧**点 **Minecraft**，浏览器会打开控制台。[插件市场收录申请 #11252](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11252)审核中；收录前可使用上面的一行安装命令，不需要自行编译源码。

需要你准备两项：

- 已在启动器安装 **Minecraft Java1.21系列正式版本**。插件识别1.21至1.21.11，自动选择或由你指定；第三方启动器可以点“选择文件夹”。它复用已安装的原版客户端文件，创建独立Fabric实例。
- DSH中已有可用的**官方DeepSeek API密钥**，账户至少保留¥1。插件自动复用私有凭据，不重复填写。自主控制台有自己的模型设置；仅有聊天订阅、第三方转发配置或DSH登录状态不能替代官方API凭据。

在控制台按顺序使用：

1. **环境检查**直接显示游戏、Java、账户配置和运行文件的情况，缺失项旁边给出处理方法。
2. 点 **准备游戏**，先确认已有Java21、运行库、服务器和对应版本模组，直接复用校验通过的文件；只有缺失或文件不完整时才下载补齐。同一版本继续使用原目录和缓存，不会每次另建一套环境。进度可见，也可取消重试。
3. 实际启动、连接玩家并保存冻结后，才显示 **准备完成**并允许 **开始冒险**。准备详情会收起，随时可以展开。

第一次需要联网访问Mojang、Fabric、GitHub和Maven等下载源，可能耗时数分钟。普通用户无需安装Git、Python或JDK，也不需要构建模组。失败时会显示发生在哪一步、具体原因和重试/选择目录等操作；“复制诊断信息”便于反馈问题。

支持版本的 Fabric 启动清单及运行库校验值随插件提供，正常准备不再向 Fabric 配置接口逐次请求；已有运行文件仍按校验值复用。仅内置清单和缓存都缺失或损坏时才联网补取，单次请求15秒超时、最多尝试3次，成功后缓存；缺少的运行库本身仍需下载。

默认是普通自主游玩。默认每场120分钟，到时保存暂停；可以调整。辅助规则包含生命回复I、抗性提升I、夜视I和死亡不掉落，模型已知。暂停保存冻结整局；保存停止关闭游戏；退出控制台释放其进程。

近战可由模型选择目标和背包中的武器，程序连续追击并按原生冷却挥击；仍可手动攻击。危险、目标丢失或武器将损坏时交回决策，弓箭和爆炸类目标需要其他战术。短等最多5秒、连续两次；反复无进展会诊断、重新规划或尝试已验证的局部脱困，不再仅因停滞结束整局。手动暂停、时长、余额和连接保护仍有效。

在“我的世界存档”点 **新建世界**，填写名称、游戏版本及可选种子，创建后再准备游戏。可选择旧存档并点 **切换世界**；每个世界独立保存地图、背包和AI记忆，新建世界另有独立客户端身份与寻路缓存，复用游戏本体和运行库。切换、新建或删除前先保存并停止。**删除…**会再次显示世界名称，确认后将存档、AI记忆及专属缓存打包移入Windows回收站，包内附恢复说明；已有备份保留。

## 可选直播扩展

先装基础版，需要直播显示时再装：

```powershell
dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/dsh-minecraft-stream.tgz
```

重开DSH，暂停后点 **Minecraft旁的直播扩展**，启用小鲸鱼、动态行动/事件气泡、偶尔的余额显示和直播预览。抖音直播伴侣添加 **游戏进程 → Minecraft的java.exe**，缩放到画布即可捕获游戏内挂件；备用绿幕绑定方法见[直播说明](docs/streaming.md)。其他直播软件由使用者自行配置捕获方式。当前没有弹幕接收、语音或自动推流。

暂停后点“关闭直播扩展，返回普通游玩”即可关闭显示。两种模式共用同一套游戏，不多开一套控制服务。

## 作为通用MCP使用

完成游戏准备后，在兼容stdio MCP的客户端配置实际路径：

```json
{"mcpServers":{"minecraft-native":{"command":"node","args":["C:/projects/minecraft-native-mcp/src/mcp-server.mjs","--launch"]}}}
```

`--launch`会启动游戏并等待工具指令，不启动DeepSeek自主循环，也不要求DeepSeek密钥。独立MCP需要Node22.16+。已有运行中的原生实例可以省略`--launch`，用`FISH_BRIDGE_CONFIG`指定其本机认证配置；退出时释放操作而不关闭外部游戏。避免多个控制器同时控制一个角色。

空间摘要覆盖周围16格、上下12格，区分可见表面与保守地面连通；复杂洞穴可查询多层切片。`dig_tunnel`一次推进1–12格、最多90秒，危险或卡住时提前交回决策。自主提示词优先地表探索与建筑资源机会。截图只取游戏画面，允许探索远处地形/建筑及异常诊断，成功间隔15秒，无每小时张数限制，不是定时自动截图。完整参数以MCP工具列表为准。

## 文件、升级与卸载

默认工作目录是`$DSH_HOME/minecraft-native-mcp`（通常在用户目录`.dsh`下）：`data`保存世界和记忆，`runtime`保存便携工具及下载缓存，`logs`保存运行日志。不同游戏版本使用独立世界和记忆，原1.21.4世界继续沿用原位置。

升级前保存停止并退出控制台，再更新插件并重开DSH。默认托管目录会备份旧源码后更新，保留世界和配置；自行配置`config.projectDirectory`的外部项目不会被自动覆盖。DSH已安装的依赖在项目内通过目录链接复用，避免再次下载。

卸载基础版：`dsh plugin --profile desktop remove minecraft-native-mcp`。可选扩展使用`... remove dsh-minecraft-stream`。重开DSH后生效；需要清理工作目录时先备份世界再移走目录。插件只停止自己启动的进程。没有系统服务、开机启动、管理员安装或全局PATH修改。

## 验证与边界

Windows x64为当前支持平台，DSH0.2.0-rc.2为本机验证版本。逐游戏版本的编译/真实启动/挖掘/截图证据见[兼容表](docs/compatibility.md)。自动测试、构建和打包通过后才生成发布产物；完整无人值守生存、连续长局与末影龙通关仍未验收。

核心基于[mcpfabric](https://github.com/denfry/mcpfabric)和[Baritone](https://github.com/cabaletta/baritone)，鲸鱼素材来自[DeepSeek Balance Whale Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。介绍结构参考[minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server)。新增代码MIT许可，依赖许可见[第三方说明](THIRD_PARTY.md)。
