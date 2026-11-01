# Minecraft 1.21系列与可视化准备 Implementation Plan

> Execution: current session, native implementation followed by an independent final review. User has authorized routine design choices and continuous implementation; no additional design approval is required.

**Goal:** Windows x64 DSH users with an existing Minecraft Java1.21 installation and official DeepSeek credentials can inspect, prepare, launch and diagnose the game through the dashboard. Support every released version 1.21 through1.21.11 with matching artifacts.

**Architecture:** A pinned version manifest selects client/server/Fabric/MCP/Baritone/helper artifacts. End users download prebuilt helpers and the bundled JS runtime instead of compiling source. A preparation job records steps, progress, errors and actionable recovery. Runtime accepts readiness only after real connection and freeze. Version-specific game data prevents cross-version world downgrade.

**Tech:** Node22.16+, Windows PowerShell for portable archive extraction, Java21 runtime, Fabric1.21 matrix; existing vanilla HTML/CSS dashboard.


**Status:** Implementation and independent review completed. All12 versions compile and pass the real-game and optional HUD smoke. Fresh-workspace package installation and cached relaunch passed. Final tagged delivery and the preserved personal session are being completed; release status is recorded in GitHub Releases.

## Constraints and review focus

- Preserve existing private 1.21.4 worlds and credentials; never ship client game JARs or private state.
- Install portable tools only inside the project, with no admin/global configuration or new permanent listener.
- API balance floor remains CNY1; routine build and cross-version smoke use no model requests.
- Base gameplay and optional streaming stay separate. No comment ingestion.
- Detect wrong platform, missing/moved client JAR, interrupted downloads, occupied ports, absent/invalid credentials and mismatched caches explicitly.
- Never label compiled-only versions as real-game tested. Version1.21 requires its own compatibility evidence because upstream starts at1.21.1.

## Task1: pinned artifacts and reproducible matrix

Files: versions.json, scripts/refresh_versions.mjs, scripts/build_helpers.py, client-addon/build.gradle, server-addon/build.gradle, scripts/bundle_runtime.mjs, bundled/mcpfabric, .github/workflows.

- [x] Resolve official Mojang release metadata, upstream MCP0.8.0 and matching Baritone/Fabric artifacts, including checksums.
- [x] Parameterize helper builds by game version and isolate generated compatibility sources/build outputs.
- [x] Compile client/server helpers for every listed version and package versioned JARs with deterministic manifest checksums.
- [x] Bundle fixed upstream JS runtime and preserve upstream license/source provenance. Consumers need no Git or Gradle.
- [x] Test actual mod loading before opening support; run compile/package CI and tagged release workflow.

## Task2: observable environment preparation

Files: src/versions.mjs, src/game-setup.mjs, src/downloads.mjs, src/environment.mjs, scripts/bootstrap_tools.ps1, scripts/extract_archive.ps1, src/runtime.mjs, src/state.mjs, src/server.mjs.

Interfaces: inspectEnvironment(settings) returns checks/installations; prepareEnvironment(settings,{signal,onProgress}) returns resolvedVersion/profile; SetupError has code,step,title,detail,hint and retryable. Public state includes setup snapshots, not credentials.

- [x] Scan default and selected launcher directories, validate exact client SHA1, expose supported versions and explicit version choice.
- [x] Detect Windows x64 and NodeSQLite support, locate/download Java21 runtime; remove Python/Git/JDK from the user install path.
- [x] Stream verified downloads with byte/file progress, idle timestamps, bounded retries, cancellation and resumable verified cache reuse.
- [x] Write per-version isolated launch profiles/token/options; allow preserved legacy1.21.4 paths and keep cross-version worlds separate.
- [x] Classify missing files, downloads, ports, launch and bridge errors with recovery actions; do not return ready before real game connection.
- [x] Exercise wrong-platform, missing-game, cancel, stale-cache and real-failure paths with focused long-term tests.

## Task3: visible dashboard

Files: web/index.html, web/control.mjs, web/styles.css, dsh/index.mjs, dsh/manager.mjs.

- [x] Add an environment checklist, detected game/version selector, a clear preparation action and timeline with file/byte progress.
- [x] Use persistent step errors with retry/choose-directory/copy-diagnostics actions; one accessible dialog for a new blocking failure.
- [x] Show stalled-progress context without marking slow work as success or falsely calling it frozen.
- [x] Keep gameplay actions simple; streaming controls load only when enabled. Preserve mode-selector button position.
- [x] Verify real rendered desktop/mobile UI, keyboard/error recovery and ordinary/streaming states.

Design: Minecraft field-work notebook: warm paper #F6F4EC, ink #20342A, forest #32634A, muted #788177, warning #AA6233, error #A43B37. Chinese system sans with a compact mono face only for numeric progress. Left-aligned working area; ordered preparation steps are the distinctive structural feature. No decorative hero or forced popup for every routine event.

## Task4: end-to-end and delivery

Files: scripts/smoke_game.mjs, tests, README.md, docs/architecture.md, docs/streaming.md, CHANGELOG.md, private project README/system ledger/knowledge index.

- [x] Run a minimal real game smoke per version: launch, identity/survival, bridge, spatial scan, actual movement/action, screenshot, pause/freeze, graceful stop; use disposable worlds.
- [x] Validate first install from release-shaped artifacts in a fresh workspace without compiling or requiring developer tools, force portableJava download, test error recovery and a subsequent cached launch. Existing DSH/game installation and assets are reused; this is not a clean-Windows test.
- [x] Package base and optional streaming extension; scan public artifacts for private files/secrets and verify contents.
- [ ] Update support evidence, user prerequisites, default workflow, troubleshooting and rollback. Publish only verified artifacts, install locally, restore original frozen session.
- [ ] Remove temporary profiles/worlds/download failures and one-off test scaffolding; retain reproducible smoke and narrowly useful regression tests.
