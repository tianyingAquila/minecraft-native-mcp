# 架构与扩展

`MCP client → src/mcp-server.mjs → ClientActions → authenticated local RPC → Fabric player`

核心入口通过标准 stdio 暴露工具；无需 DeepSeek 或直播平台。客户端代理的寻路、配方、长期地点记忆复用固定版本 mcpfabric；新增的连续矿道、原生交互确认和空间感知在本项目工具层及 client-addon 中。

DSH入口位于 `dsh/index.mjs` 和 `dsh/manager.mjs`。Cordis bundle 注册启动器路由及桌面/网页注入行，使用宿主已有webServer，不增加常驻代理。启动器在用户点击后准备独立工作副本或启动控制台，通过默认浏览器打开21940地址。首次准备输出到工作目录 logs/setup.log；工作副本默认不自动覆盖更新，避免改写存档及配置。退出DSH插件会清理拥有的准备任务和控制台，外部已有控制台保持其原有生命周期。

- `src/client-actions.mjs`：工具目录、参数、任务互斥和取消。
- `src/spatial.mjs` / `FishSpatialScan.java`：局部体素采样、射线可见面、保守地面连通、方向摘要和切片。
- `src/tunnel.mjs` / `mining.mjs`：有限段落的实际挖掘、前进和中断。
- `src/runtime.mjs` / `server-addon`：独立世界、客户端及保存冻结。
- `src/agent.mjs` / `deepseek.mjs`：可选 DeepSeek 决策循环、余额保护与请求用量，不属于 MCP 客户端必需功能。
- `web` / `FishHud.java`：可选控制台及游戏内挂件。

其他平台可捕获同一 Minecraft 画面，也可读取 `/api/overlay` 构建显示；平台接收、推流和聊天逻辑应单独实现。当前没有生效的弹幕接收或操控集成，不将历史试验作为可用功能。

世界、记忆、日志、运行依赖、认证配置都在被忽略的 data/runtime/vendor/logs 等目录。公开提交只包括源码、锁文件和示例。升级上游依赖时一起验证客户端JAR与工具层，不能只回退其中一个。
