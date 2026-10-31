$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$ProgressPreference='SilentlyContinue'
$OutputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=$OutputEncoding
Push-Location $projectRoot
try {
    . (Join-Path $PSScriptRoot 'bootstrap_tools.ps1')
    $lock=Get-Content -Raw (Join-Path $projectRoot 'vendor-lock.json') | ConvertFrom-Json
    New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'runtime') | Out-Null
    $serverJar=Join-Path $projectRoot 'runtime/server-1.21.4.jar'
    Write-Output 'PHASE:game-server'
    if (-not(Test-Path $serverJar)) { Invoke-WebRequest -Uri $lock.minecraft.url -OutFile $serverJar -TimeoutSec 300 }
    if ((Get-FileHash $serverJar -Algorithm SHA1).Hash.ToLowerInvariant() -ne $lock.minecraft.serverSha1) { throw 'Server checksum mismatch' }
    Write-Output 'PHASE:game-client'
    & $env:FISH_PYTHON -X utf8 scripts/prepare_client.py
    if ($LASTEXITCODE -ne 0) { throw 'Vanilla client setup failed.' }
    $vendorRoot=Join-Path $projectRoot 'vendor\mcpfabric'
    Write-Output 'PHASE:mcp-source'
    if (-not (Test-Path -LiteralPath $vendorRoot)) {
        git clone --depth 1 --branch v0.8.0 https://github.com/denfry/mcpfabric.git $vendorRoot
        if ($LASTEXITCODE -ne 0) { throw 'MCP source download failed.' }
    }
    $revision=git -C $vendorRoot rev-parse HEAD
    if ($revision.Trim() -ne '75c9cb2eb4ff7865b4a9afe8930269ba67280c66') { throw 'Unexpected MCP source revision.' }
    Write-Output 'PHASE:fabric-mods'
    & $env:FISH_PYTHON -X utf8 scripts/prepare_native_client.py
    if ($LASTEXITCODE -ne 0) { throw 'Native client setup failed.' }
    $mcpRoot=& $env:FISH_PYTHON -c "from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve())" (Join-Path $vendorRoot 'mcp-server')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'mcpfabric-package-lock.json') -Destination (Join-Path $mcpRoot 'package-lock.json')
    Push-Location $mcpRoot
    Write-Output 'PHASE:mcp-runtime'
    try { Install-NodeDependencies; Build-NodeProject } finally { Pop-Location }
    $gradleArgs=@('-p',(Join-Path $projectRoot 'client-addon'),'build',':server-addon:build','--no-daemon')
    if ($env:HTTPS_PROXY) {
        $proxyUri=[Uri]$env:HTTPS_PROXY
        if ($proxyUri.Host -eq '127.0.0.1') { $gradleArgs+=@("-Dhttps.proxyHost=127.0.0.1","-Dhttps.proxyPort=$($proxyUri.Port)","-Dhttp.proxyHost=127.0.0.1","-Dhttp.proxyPort=$($proxyUri.Port)") }
    }
    Write-Output 'PHASE:java-build'
    & (Join-Path $vendorRoot 'gradlew.bat') @gradleArgs
    if ($LASTEXITCODE -ne 0) { throw 'Client helper build failed.' }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'client-addon\build\libs\fish-live-client-0.1.0.jar') -Destination (Join-Path $projectRoot 'data\native-client\mods\fish-live-client-0.1.0.jar')
    Copy-Item -LiteralPath (Join-Path $projectRoot 'server-addon\build\libs\fish-pause-server-0.1.0.jar') -Destination (Join-Path $projectRoot 'runtime\native-server\fish-pause-server.jar')
} finally { Pop-Location }
