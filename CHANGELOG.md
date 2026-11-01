# Changelog

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
