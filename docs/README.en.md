# Minecraft Native MCP

A Windows-first experimental MCP server controlling a real Minecraft Java 1.21.4 Fabric player. It combines native first-person HUD, structured spatial perception, bounded continuous mining, verified action feedback and optional livestream presentation.

Install the DSH UI plugin with `dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/minecraft-native-mcp.tgz`, then reopen the DSH UI. The Minecraft button opens the browser dashboard when ready; first use offers dependency preparation. The plugin keeps its working copy and worlds under `$DSH_HOME/minecraft-native-mcp`. Git, Python, Node and JDK21 must already be available. Plugin JS is prebuilt; game dependencies still download and helper mods build during first preparation. Disabling removes owned processes, not saved worlds or independently started consoles. Remove with `dsh plugin --profile desktop remove minecraft-native-mcp`. Working-copy upgrades are currently manual, after backup.

Requirements: Windows, Node.js 22+, Python 3.10+, Git, JDK21 and legitimate Minecraft access. Run `scripts/setup_native.ps1` from PowerShell to download pinned dependencies and build the helper mods. Game binaries, credentials, worlds and logs are not distributed.

Configure your MCP client to run `node C:/projects/minecraft-native-mcp/src/mcp-server.mjs --launch`. This starts an isolated local game and waits for tool calls; it makes no model API requests. Without `--launch`, set `FISH_BRIDGE_CONFIG` to an existing authenticated local bridge configuration. The player must be named `DeepSeekFish`. Do not run multiple controllers on the same player.

Spatial summaries cover a 16-block horizontal radius and ±12 vertical blocks. Visible surfaces are distinguished from conservative connected-floor estimates; candidates are not navigation guarantees. `inspect_space` provides layered maps. `dig_tunnel` advances 1–12 steps with a 90-second limit and interrupts on danger or stalls. Diagnostic framebuffer screenshots have a 30-second cooldown.

Optional `npm start` runs the DeepSeek autonomous dashboard. Set `DEEPSEEK_API_KEY`, or reuse DSH's private credential reference. It checks the official CNY balance and retains ¥1. Standard MCP operation needs no DeepSeek key. Livestream widgets and Douyin companion integration are optional; other platforms can capture the game or build adapters. Chat ingestion is not implemented.

See the [Chinese guide](../README.md), [architecture](architecture.md), [streaming](streaming.md) and [third-party notices](../THIRD_PARTY.md). Controlled local tests do not prove unattended completion, endgame progression, fresh-machine installation or all MCP clients. New code is MIT licensed; dependencies retain their own licenses.
