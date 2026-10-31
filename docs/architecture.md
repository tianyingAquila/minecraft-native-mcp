# 架构与扩展

`MCP client → src/mcp-server.mjs → ClientActions → authenticated local RPC → Fabric player`

核心入口通过标准 stdio 暴露工具；无需 DeepSeek 或直播平台。客户端代理的寻路、配方、长期地点记忆复用固定版本 mcpfabric；新增的连续矿道、原生交互确认和空间感知在本项目工具层及 client-addon 中。

DSH基础插件位于 `dsh/index.mjs` 和 `dsh/manager.mjs`。Cordis bundle 在模式选择器右侧注入入口，使用宿主已有 webServer。启用时补齐基础依赖，点击后打开自主控制台；`src/environment.mjs` 在“准备游戏”时核对已有游戏并调用安装脚本，实际连接冻结后才进入 ready。默认托管副本升级先备份源码，保留 data/runtime/vendor；外部指定项目不自动改写。退出插件清理拥有的任务与控制台，不接管外部进程生命周期。

`packages/dsh-minecraft-stream` 是单独发布的可选扩展，只调用基础版的直播模式开关。普通模式不绘制挂件，直播模式才加载浏览器预览并启用游戏内 HUD。两者共用同一个控制台与游戏，不新增常驻中转服务。

- `src/client-actions.mjs`：工具目录、参数、任务互斥和取消。
- `src/spatial.mjs` / `FishSpatialScan.java`：局部体素采样、射线可见面、保守地面连通、方向摘要和切片。
- `src/tunnel.mjs` / `mining.mjs`：有限段落的实际挖掘、前进和中断。
- `src/runtime.mjs` / `server-addon`：独立世界、客户端及保存冻结。
- `src/agent.mjs` / `deepseek.mjs`：可选 DeepSeek 决策循环、余额保护与请求用量，不属于 MCP 客户端必需功能。
- `web` / `FishHud.java`：可选控制台及游戏内挂件。

其他平台可捕获同一 Minecraft 画面，也可读取 `/api/overlay` 构建显示；平台接收、推流和聊天逻辑应单独实现。当前没有生效的弹幕接收或操控集成，不将历史试验作为可用功能。

世界、记忆、日志、运行依赖、认证配置都在被忽略的 data/runtime/vendor/logs 等目录。公开提交只包括源码、锁文件和示例。升级上游依赖时一起验证客户端JAR与工具层，不能只回退其中一个。

开发安装验证请使用独立 profile 和 `npm pack` 产物。本轮从 `link:` 开发链接切换到 tarball 时观察到源码目录 Git 元数据受损，已从远端恢复，文件与测试核对通过；未将该切换路径作为支持承诺。不要在同一个 profile 直接替换仍指向开发源码的链接。
