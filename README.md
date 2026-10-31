# Minecraft Native MCP

[English](docs/README.en.md) · [架构与扩展](docs/architecture.md) · [直播集成](docs/streaming.md)

让 MCP 客户端控制真正的 Minecraft Java 玩家客户端。提供原生第一视角、血条、饱食度与物品栏，结合结构化空间观察和有边界的连续动作，面向自主生存、AI 实验和游戏直播。

## DSH 插件安装（推荐入口）

```powershell
dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/minecraft-native-mcp.tgz
```

重新打开 DSH，在输入框上方的 **标准模式右侧**点 **Minecraft**，即可打开浏览器控制台。默认是普通自主游玩，不显示鲸鱼、气泡或直播设置。安装启用时会自动检查基础依赖；首次下载可能需要几分钟，失败可在启动器重试。

你只需先准备：

1. 已安装 DSH，并配置**官方 DeepSeek API 密钥**，账户余额至少 ¥1。插件复用 DSH 私有凭据，不需要再次填写；仅登录 DSH、使用第三方转发模型或订阅套餐不等于已配置官方 API。自主控制台使用自己的模型设置，不继承当前聊天选中的模型。
2. 自行安装并启动一次 **Minecraft Java 1.21.4**。默认查找 `%APPDATA%/.minecraft`；第三方启动器或其他目录请在控制台填写已有游戏目录，可填 `.minecraft` 或含 `1.21.4.jar` 的版本目录。插件校验版本，不下载客户端本体，也不使用旧版本的模组目录。
3. 首次准备保持联网，需访问 Mojang、Fabric、GitHub、Maven 等下载源。

控制台点 **准备游戏**，会核验 API 与余额，复用现有游戏本体，补齐运行库、Fabric、Baritone、MCP 及辅助模组，建立独立世界，启动并连接真实玩家客户端。**只有连接成功并保存冻结，才显示“准备完成”并启用“开始冒险”**。此前错误会明确显示；可取消准备后重试。再次使用复用缓存，无需重装。

Node/Python 优先复用 DSH 运行时；缺少 Git/JDK21 时下载便携副本到工作目录，不要求手动安装整套开发环境，也不改系统 PATH。缺少 DSH 运行时会提示修复 DSH。当前针对 **Windows x64、Minecraft Java 1.21.4、Java21** 验证。

工作目录默认是 `$DSH_HOME/minecraft-native-mcp`（通常 `%USERPROFILE%/.dsh/minecraft-native-mcp`）。存档在 `data`，下载和便携工具在 `runtime`，日志在 `logs`。更新插件后，停掉旧控制台再重新打开：默认托管目录会备份旧源码到 `data/backups` 后更新源码，保留存档、设置与运行依赖；已运行的控制台不会被热替换。自行设置 `config.projectDirectory` 的项目不自动覆盖，请自行更新代码。插件 JS 无需编译。

卸载：`dsh plugin --profile desktop remove minecraft-native-mcp`，重新打开 DSH。禁用/退出插件会停止它自己拥有的准备任务及游戏控制台，不会关掉外部独立启动的控制台。需要清除下载和存档时，先备份世界，再手动移走工作目录。没有开机启动、系统服务或全局环境修改。也支持 `web` profile 和本地开发安装 `dsh plugin --profile desktop add link:<仓库绝对路径>`。

## 可选：直播扩展（单独安装）

```powershell
dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/dsh-minecraft-stream.tgz
```

先安装基础版。重开 DSH 后，**Minecraft**右侧多一个**直播扩展**按钮；暂停游戏后点击它，启用游戏内小鲸鱼、动态进度气泡、偶尔的余额提示，以及控制台直播预览。它沿用基础版同一个游戏与控制台，不额外启动一套服务。扩展不是自动开播工具。

抖音直播伴侣只需添加 **游戏进程 → Minecraft 的 java.exe**，按画布缩放，鲸鱼和气泡随游戏一起捕获。备用绿幕及具体绑定步骤见[直播说明](docs/streaming.md)。其他直播软件可自行选择窗口/游戏捕获，本项目不提供逐平台配置。

恢复普通版：暂停后点控制台“关闭直播扩展，返回普通游玩”；之后可卸载 `dsh-minecraft-stream`。当前没有弹幕接收或操控功能。

**实验性项目。** 已验证空工作目录首次准备和短时真实游戏操作；没有完成无人值守生存、末影龙全流程或所有电脑环境验收。

## 特点

- **原生客户端**：Fabric 插件控制真实生存角色，Baritone 辅助寻路，保留正常距离、遮挡、工具耐久和战斗冷却。
- **空间感知**：每轮可读水平16格、上下12格的八方向摘要；区分射线可见表面和候选地面连通。复杂地形可读五层 ASCII 切片，原始体素不会全部塞给模型。
- **连续动作**：开水平矿道或向下阶梯时，一次决定1–12格、最多90秒；遇流体、近敌、受伤、断崖、落沙或卡住提前交回决策。
- **实际反馈**：确认方块变化、角色位移、目标死亡与动作期间最低生命值；目标消失不等于击杀。
- **诊断截图**：只取游戏 framebuffer，最长边1280，成功截图间隔30秒，不设小时限额；不截桌面。
- **DSH 适配**：提供标准 stdio MCP 配置。可选 DeepSeek 自主控制台还能复用 DSH 的私有凭据位置；它不是 DSH 内部代理引擎的替代品。
- **DSH 插件入口**：通过 bundle 挂载界面按钮、首次准备和进程生命周期管理；独立MCP入口同时保留。
- **可选直播层**：游戏内鲸鱼、动态“事件反应＋行动打算”气泡、余额提示及定时暂停；支持抖音直播伴侣捕获，也可供其他平台研究适配。

## 不通过 DSH 插件安装

需要 Node.js22+，并自行安装 Minecraft Java1.21.4。克隆后可运行同一准备脚本；脚本复用 DSH 运行时或已安装工具，缺失 Git、Python、JDK21 时在项目内补齐便携依赖。

```powershell
git clone https://github.com/tianyingAquila/minecraft-native-mcp.git
cd minecraft-native-mcp
# 游戏在其他目录时先设置：$env:FISH_MINECRAFT_HOME = "D:/Games/.minecraft"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup_native.ps1
```

默认使用本机独立测试服与固定角色 `DeepSeekFish`，无需登录微软账户；不提供账户登录流程。客户端本体由用户提供，服务端及运行依赖从官方源补齐。不会安装系统服务或开机启动项。

## 作为独立 MCP 使用

将下面配置放进 DSH 或其他兼容客户端的 MCP 服务器设置，替换成实际绝对路径。具体配置文件位置取决于客户端版本。

```json
{
  "mcpServers": {
    "minecraft-native": {
      "command": "node",
      "args": ["C:/projects/minecraft-native-mcp/src/mcp-server.mjs", "--launch"]
    }
  }
}
```

`--launch` 启动本项目独立游戏并解冻，随后等待 MCP 客户端下指令，**不会启动 DeepSeek 自主循环或产生模型费用**。退出此 MCP 进程会保存停止它启动的游戏。独立模式不需要 DeepSeek API key。

已有原生客户端时，可省略 `--launch`，通过 `FISH_BRIDGE_CONFIG` 指向其本机认证配置 JSON（包含 host、port、requireAuth、token）。该模式只接管工具连接，退出时释放动作，不关闭外部游戏。角色名需为 `DeepSeekFish`；必须安装本仓库客户端辅助插件及固定版本依赖。不要同时让控制台自主循环和外部 MCP 客户端控制同一角色。

示例指令：

> 先读取游戏状态和空间概览，找一个合适方向开4格矿道。遇到危险先停止，依据实际结果决定下一步。

## 可选：DeepSeek 自主控制台

```powershell
$env:DEEPSEEK_API_KEY = "YOUR_PRIVATE_KEY"
npm start
```

打开 `http://127.0.0.1:21940`，选择世界、设置时长，准备后开始。也支持从 `DSH_HOME`（默认用户目录 `.dsh`）的 `.credentials.yaml` 读取 `refs.DEEPSEEK_API_KEY`。不要把真实密钥保存到仓库。只使用官方 DeepSeek API 和人民币余额检查，低于¥1或查询失败时停止新请求。

控制台默认每场120分钟。暂停会保存冻结游戏；停止会退出项目游戏进程。测试规则默认包含生命回复I、抗性提升I、夜视I及死亡不掉落，模型知道这些规则。需要普通规则可研究 `src/minecraft.mjs` 的数据包生成；当前没有一键规则切换界面。

## 工具概览

| 类别 | 主要工具 |
|---|---|
| 观察 | `get_game_state`, `get_inventory`, `inspect_blocks`, `inspect_entities`, `inspect_space`, `observe`, `map_view` |
| 行动 | `travel_to`, `explore`, `dig_tunnel`, `collect_blocks`, `mine_block` |
| 物品与容器 | `craft_item`, `get_recipes`, `open_container`, `container_transfer`, `equip_item`, `eat_food`, `drop_items` |
| 战斗与交互 | `attack_entity`, `use_block`, `use_item`, `place_block_at`, `wait_for_game` |
| 记忆与诊断 | `remember`, `recall`, `goal_add`, `goal_update`, `inspect_game_screen` |

确切参数以 MCP `tools/list` 为准。独立 MCP 的截图直接作为 image 内容返回，客户端及所用模型需要支持图像工具结果。标准工具不包含任意系统命令或一键通关脚本。

## 验证与边界

```powershell
npm test
```

测试需要先准备固定版本的上游 agent runtime。原生动作、连续矿道、空间几何、冻结及挂件有本地受控验证；独立 MCP 的初始化、列工具及只读真实游戏调用另行烟测。全新电脑安装、其他系统、其他游戏版本、第三方 MCP 客户端 UI、长局稳定性及完整通关仍需验证。空间连通是保守完整方块估计，半砖/楼梯、跳跃、游泳、攀爬与未加载区域不能当作已验证路径。

## 致谢与许可

本项目核心基于 [mcpfabric](https://github.com/denfry/mcpfabric) 和 [Baritone](https://github.com/cabaletta/baritone)，不是从零实现的完整 Minecraft 控制栈。鲸鱼素材来自 [DeepSeek Balance Whale Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。项目介绍结构参考了 [minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server)，本项目使用原生 Fabric 客户端路线。

新增代码采用 MIT，依赖和素材保留各自许可证，见 [THIRD_PARTY.md](THIRD_PARTY.md)。欢迎提交问题、平台适配和可复现的改进。
