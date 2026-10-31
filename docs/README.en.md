# Minecraft Native MCP

[中文](../README.md) · [Architecture](architecture.md) · [Streaming](streaming.md)

Control a real Minecraft Java survival player through standard MCP, with native first-person HUD, spatial summaries and bounded actions. Windows x64 / Minecraft Java 1.21.4 / Java21 are the tested targets.

## DSH plugin

```powershell
dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/minecraft-native-mcp.tgz
```

Reopen DSH and click **Minecraft**, beside the mode selector above the composer. Base dependencies are checked automatically on enable. The default dashboard is autonomous gameplay without streaming widgets.

You supply an existing Minecraft Java1.21.4 installation and an official DeepSeek API key configured in DSH, with at least CNY1 available. The plugin reuses DSH credentials; it does not inherit the active chat model or third-party subscription. Custom launcher users can specify their Minecraft directory in the dashboard. The client game JAR is reused and hash-checked, never downloaded by this plugin.

Click **Prepare game**. The plugin checks API availability and balance, supplements libraries/Fabric/Baritone/MCP, builds the helper mods, starts a separate world and connects the real player. Only a successful connection and saved frozen world enables **Start adventure**. Initial setup needs internet access to official artifact sources and GitHub; later launches reuse caches. Errors remain visible and preparation can be canceled.

Node/Python are preferably reused from DSH. Missing Git/JDK21 are installed as portable tools under the workspace, without administrator access or global PATH changes. Workspace: `$DSH_HOME/minecraft-native-mcp`. Worlds/settings are preserved on managed-source upgrades; old source is backed up under `data/backups`. Stop the old console before upgrading. A custom `config.projectDirectory` is never overwritten automatically.

Remove with `dsh plugin --profile desktop remove minecraft-native-mcp`, then reopen DSH. Unloading stops only owned processes. Back up worlds before manually removing workspace files. No system service or startup task is created.

## Optional streaming extension

Install the base first, then:

```powershell
dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/dsh-minecraft-stream.tgz
```

The separate **Streaming extension** button enables whale widgets, action/reaction bubbles, occasional balance display and streaming controls. Douyin companion can capture the Minecraft game process; a browser chroma-key overlay is available as fallback. Other streaming software is configured by the user. Disable the extension from the paused dashboard to return to normal gameplay. No chat ingestion, automatic broadcasting or platform login is implemented.

## Standard MCP

After setup, configure `node /absolute/path/src/mcp-server.mjs --launch` in any stdio MCP client. It launches the game and waits for tool calls, without any DeepSeek requests or key requirement. Without `--launch`, set `FISH_BRIDGE_CONFIG` to an existing local authenticated bridge configuration; exit releases actions without stopping that external game. Do not run competing controllers.

Spatial summaries cover 16 blocks horizontally and ±12 vertically. Visible surfaces and conservative connected-floor estimates are distinct; candidates are not navigation guarantees. `inspect_space` provides layered slices. `dig_tunnel` advances 1–12 steps with a 90-second limit and hazard interruption. Diagnostic game-frame screenshots have a 30-second cooldown.

The autonomous dashboard retains the CNY1 balance guard and timed saved pause. Default test-world rules include regeneration I, resistance I, night vision I and keepInventory. These are declared to the model. New code is MIT licensed; see [third-party notices](../THIRD_PARTY.md).

An empty-workspace preparation and short real gameplay were tested locally. This does not prove unattended dragon completion, every fresh-machine dependency fallback or long-duration stability.
