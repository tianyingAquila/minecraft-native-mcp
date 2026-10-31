# Minecraft Native MCP

[English](docs/README.en.md) · [架构与扩展](docs/architecture.md) · [直播集成](docs/streaming.md)

让 MCP 客户端控制真正的 Minecraft Java 玩家客户端。提供原生第一视角、血条、饱食度与物品栏，结合结构化空间观察和有边界的连续动作，面向自主生存、AI 实验和游戏直播。

## DSH 插件安装（推荐入口）

```powershell
dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/minecraft-native-mcp.tgz
```

重新打开对应 DSH 界面后，顶部会出现 **Minecraft 控制台** 按钮。准备好依赖时点一次即可在默认浏览器打开控制台；首次使用先在插件面板点“准备依赖”，完成后再打开。也支持 `web` profile，以及本地开发安装 `dsh plugin --profile desktop add link:<本仓库绝对路径>`。

首次准备仍需要 Git、Python、Node.js、JDK21、联网以及游戏使用资格。安装包内的插件JS无需编译，但游戏依赖需要下载、Java辅助模组需要构建；不能把首次下载称为零准备。工作副本与存档保存在 `$DSH_HOME/minecraft-native-mcp`，不写进插件安装目录，更新/卸载插件不会自动删除存档。当前工作副本不会自动覆盖升级，需要停止后备份并重新准备新副本。

插件只管理它自己启动的控制台，卸载/禁用时停止其拥有的进程；不会关掉独立启动的现有控制台。卸载使用 `dsh plugin --profile desktop remove minecraft-native-mcp`，再重新打开DSH；需要清理工作副本时请先备份世界并手动移走该目录。没有开机启动或系统服务。

已有完整项目时，可在DSH配置中给本插件设置 `config.projectDirectory` 为项目绝对路径，继续使用原存档和依赖；未设置时使用上面的独立工作目录。

**实验性项目，当前针对 Windows + Minecraft Java 1.21.4 + Java 21 验证。** 不承诺无人值守通关，也没有完成末影龙全流程验收。

## 特点

- **原生客户端**：Fabric 插件控制真实生存角色，Baritone 辅助寻路，保留正常距离、遮挡、工具耐久和战斗冷却。
- **空间感知**：每轮可读水平16格、上下12格的八方向摘要；区分射线可见表面和候选地面连通。复杂地形可读五层 ASCII 切片，原始体素不会全部塞给模型。
- **连续动作**：开水平矿道或向下阶梯时，一次决定1–12格、最多90秒；遇流体、近敌、受伤、断崖、落沙或卡住提前交回决策。
- **实际反馈**：确认方块变化、角色位移、目标死亡与动作期间最低生命值；目标消失不等于击杀。
- **诊断截图**：只取游戏 framebuffer，最长边1280，成功截图间隔30秒，不设小时限额；不截桌面。
- **DSH 适配**：提供标准 stdio MCP 配置。可选 DeepSeek 自主控制台还能复用 DSH 的私有凭据位置；它不是 DSH 内部代理引擎的替代品。
- **DSH 插件入口**：通过 bundle 挂载界面按钮、首次准备和进程生命周期管理；独立MCP入口同时保留。
- **可选直播层**：游戏内鲸鱼、动态“事件反应＋行动打算”气泡、余额提示及定时暂停；支持抖音直播伴侣捕获，也可供其他平台研究适配。

## 准备

需要 Windows、Git、Node.js 22+、Python 3.10+、JDK 21，以及合法的 Minecraft 使用资格。安装脚本从官方渠道下载游戏及依赖；游戏文件和账户凭据不随源码发布。下载量较大，首次准备需要联网。

```powershell
git clone https://github.com/tianyingAquila/minecraft-native-mcp.git
cd minecraft-native-mcp
# JAVA_HOME 指向 JDK 21；java、node、python、git 需要可用。
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup_native.ps1
```

脚本生成项目内独立的客户端、服务端、认证令牌和启动参数。默认使用本机离线测试服与固定角色 `DeepSeekFish`，不提供微软账户登录流程。不会安装系统服务或开机启动项。

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
