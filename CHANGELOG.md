# Changelog

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
