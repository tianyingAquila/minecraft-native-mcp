# Third-party components

- [denfry/mcpfabric](https://github.com/denfry/mcpfabric), MIT, revision `75c9cb2eb4ff7865b4a9afe8930269ba67280c66`. Its agent runtime and game bridge are fundamental dependencies. The compiled JavaScript runtime is bundled under `bundled/mcpfabric` with its MIT notice; normal per-version bridge JARs are downloaded from the pinned upstream release. The1.21 release package includes a compatibility copy of the upstream1.21.1 JAR with only its Minecraft version declaration adjusted; `scripts/build_helpers.py` produces that copy reproducibly, preserving all other entries. License: `licenses/mcpfabric-MIT.txt`.
- [cabaletta/baritone](https://github.com/cabaletta/baritone), LGPL-3.0, matching API Fabric builds for each Minecraft version (see `versions.json`). Downloaded as an external dependency; original source and license are available upstream. No modified Baritone binary is distributed here.
- [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget), MIT. Whale artwork is reused with its notice in `assets/whale-LICENSE`; the same asset is packaged as a client resource.
- Fabric Loader / Fabric API, Minecraft and Node packages retain their respective upstream licenses. Minecraft downloads come from official endpoints and are not included in Git.
- [yuniko-software/minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server) is a documentation reference and a related Mineflayer-based implementation, not the basis of this native-client control layer.

Historical local chat-fetcher experiments and their AGPL dependency are not included in this publication.
