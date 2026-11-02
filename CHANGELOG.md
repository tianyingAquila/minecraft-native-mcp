# Changelog

## 0.3.4

- Bundle official Fabric launch profiles and library checksums for all12 supported game versions, removing metadata-network requests from normal preparation.
- Cache fallback metadata by game and loader version, validate its integrity and contents, and publish it atomically only after all checksums have been obtained.
- Bound fallback requests to15seconds and at most3attempts, with cancellable retries and specific failure details retained in controller events.
- Keep binary downloads hash-checked and reuse complete local files; missing files still require network access.

## 0.3.3

- Add named worlds with version selection and optional seeds; create, select and delete through the dashboard after stopping the game.
- Preserve legacy saves and isolate each world's game state, AI memory, client identity and navigation cache without copying the game or libraries.
- Confirm deletions by world name and move the selected save, AI memory and dedicated cache to the Windows Recycle Bin with recovery instructions; retain existing backups.
- Prefer purposeful surface exploration and structure-based resource gathering in the autonomous prompt.
- Allow screenshots for exploration as well as diagnosis; reduce the successful-capture cooldown from30to15seconds with no hourly cap.

## 0.3.2

- Make pathfinding turn the visible first-person camera toward the path, including turns, with native smoothing.
- Add current client biome and evidence-based environment candidates from ray-visible blocks, with repeated sightings deduplicated.
- Interrupt long mining/travel/collection when newly observed important surroundings need a fresh decision; preserve the actual partial result.
- Permit a natural, optional discovery reaction and require reassessing exploration opportunities without forcing exploration or claiming a possible structure is confirmed.
- Show biome and environment clues in the dashboard spatial details.

## 0.3.1

- Read the actual container screen, empty slots, cursor-held items, inventory/menu slot mapping, native placement/pickup rules and synchronized UI properties. Group repeated rules to keep observations compact.
- Describe known crafting, cooking, brewing, anvil, smithing, storage and merchant layouts; expose trade offers and mark unknown layouts explicitly.
- Use version-matched default cooking recipes to diagnose incompatible/full output slots. Return current structured container state after opening or transferring.
- Verify screen closure and reject repeated no-op close requests instead of reporting success.
- Clarify that preparation confirms and reuses existing files, downloading only missing or damaged files.

## 0.3.0

- Support matching Minecraft Java1.21 through1.21.11 environments and isolate worlds/memory by game version.
- Add a visible environment checklist, version/folder selection, real preparation progress, cancellation and actionable error recovery.
- Ship prebuilt helper mods and the fixed upstream JavaScript runtime; reuse DSH package dependencies. End users no longer compile or install Git/Python/JDK.
- Add checksummed downloads, portable Java21 preparation, port diagnostics and release package validation.
- Add a reproducible real-game smoke covering identity, spatial scan, actual mining, screenshot, effects, saved pause and shutdown, without model requests.
- Add a12-version build matrix and automated release packaging. Base gameplay and optional streaming remain separate.

## 0.2.0

- Place the Minecraft entry beside the DSH mode selector.
- Add automated first-time preparation and split optional livestream controls from default gameplay.

## 0.1.1

- Run dashboard children in Node mode under the DSH Electron host.
