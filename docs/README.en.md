# Minecraft Native MCP

[中文](../README.md) · [Compatibility evidence](compatibility.md) · [Architecture](architecture.md) · [Streaming](streaming.md)

Control a real Minecraft Java survival player through standard MCP, retaining the native first-person HUD. The DSH plugin adds an autonomous DeepSeek dashboard; streaming widgets are a separate optional package.

## Install

```powershell
dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/minecraft-native-mcp.tgz
```

Reopen DSH and click **Minecraft** beside the mode selector. [Marketplace submission #11252](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11252) is awaiting review; the install command above is available now. Supply an existing Minecraft Java1.21-series installation and an official DeepSeek API credential in DSH, with at least CNY1 available. The dashboard detects versions1.21 through1.21.11; custom launcher users can select their game folder. Client game JARs are reused and hash-checked, never distributed or downloaded by the plugin.

The environment checklist shows what is ready, what will be installed automatically and what needs attention. **Prepare game** downloads a portable Java21 runtime when needed, libraries, a separate server and matching prebuilt mods. Real file/byte progress, cancellation, verified-cache reuse, actionable errors and diagnostic copying are provided. Only a real connected and saved frozen player enables **Start adventure**. End users do not need Git, Python, a JDK or source compilation.

Fabric launch metadata and library checksums for the supported versions are bundled, so normal preparation does not repeatedly contact the Fabric metadata API. Existing runtime files are still hash-checked. Missing/corrupt bundled metadata and cache fall back to a bounded download (15seconds per request, at most3attempts), which is cached after success. Missing runtime JARs still require a network download.

Default runtime120minutes; regeneration I, resistance I, night vision I and keepInventory are declared to the model. Pause freezes and saves; stop closes the game. The official API balance guard retains CNY1. The dashboard uses its own model configuration rather than inheriting the active DSH chat model.

Bounded continuous melee lets the model choose an observed target and an available weapon, while the executor pursues and respects native attack cooldowns. Manual attacks remain available; ranged and explosive targets need other tactics. Passive waits last at most5seconds, with no more than two consecutive requests. Stalled play triggers diagnosis, replanning or a locally verified escape rather than a no-progress session stop. Manual pause, duration, balance and connection protections remain active.

Use **New world** in the world manager to name a world, choose its Minecraft version and optionally supply a seed, then prepare the game. Stop the game before creating, switching or deleting worlds. Each world has separate game data and AI memory; new worlds also isolate client identity and navigation caches while reusing shared game files and libraries. Deletion requires confirmation and moves the selected world, AI memory and dedicated cache to the Windows Recycle Bin with restoration instructions. Existing backups are retained.

## Optional streaming

```powershell
dsh plugin --profile desktop add https://github.com/tianyingAquila/minecraft-native-mcp/releases/latest/download/dsh-minecraft-stream.tgz
```

Pause and click the separate **直播扩展** button. Whale/action/reaction/balance widgets render inside Minecraft. Douyin companion can capture the game process; a browser chroma-key fallback is documented in [streaming](streaming.md). Other software is configured by the user. No chat ingestion, voice generation or automatic broadcasting is implemented. Disable streaming from the paused dashboard to return to ordinary gameplay.

The upper-left stage-goal panel persists independently of action bubbles and wraps longer goals. The model reads the same goal every round and updates it with set_goal when the stage changes. dig_tunnel supports level, descending and ascending stairs; ascent clears takeoff headroom and uses ordinary jumps with the existing hazard checks.

## Standard MCP

After preparation, configure `node /absolute/path/src/mcp-server.mjs --launch` in any stdio MCP client. This launches the game without autonomous model requests or a DeepSeek key requirement. Requires Node22.16+. Without `--launch`, set `FISH_BRIDGE_CONFIG` to an existing local authenticated bridge configuration; exiting releases actions without stopping the external game. Do not run competing controllers.

Spatial summaries cover16 blocks horizontally and±12 vertically; candidates are conservative geometry estimates rather than navigation guarantees. `inspect_space` supplies layered slices. `dig_tunnel` advances1–12 steps, at most90seconds, with hazard interruption. The autonomous prompt favors surface exploration and structure-based resource opportunities. On-demand game screenshots support distant scenery/structure observation and diagnostics, with a15second cooldown and no hourly cap; they are not taken automatically on a timer.

Workspace: `$DSH_HOME/minecraft-native-mcp`. Worlds and memory are version-isolated; legacy1.21.4 paths are preserved. Managed-source upgrades back up code and retain data/runtime; custom projectDirectory locations require manual source updates. DSH dependencies are reused through workspace directory links. No system service, startup task, global PATH or administrator installation is added.

Remove using `dsh plugin --profile desktop remove minecraft-native-mcp` and optionally `... remove dsh-minecraft-stream`, then reopen DSH. Back up worlds before deleting workspace files.

Windows x64 and DSH0.2.0-rc.2 are the current local targets. Read the [version evidence](compatibility.md); short controlled tests do not prove unattended completion, long-duration stability or all machine environments. New code is MIT licensed; [third-party notices](../THIRD_PARTY.md) apply to dependencies.
