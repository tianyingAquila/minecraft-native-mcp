$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$entryUrl = 'http://127.0.0.1:21940'
try { $state = Invoke-RestMethod -Uri "$entryUrl/api/ping" -TimeoutSec 2 } catch { $state = $null }
if ($state -and $state.app -ne 'deepseek-minecraft-live') { throw '控制台端口已被其他程序使用。' }
if (-not $state) {
    New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'logs') | Out-Null
    $nodePath = (Get-Command node.exe).Source
    Start-Process -FilePath $nodePath -ArgumentList @('src/server.mjs') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'logs/control.log') -RedirectStandardError (Join-Path $projectRoot 'logs/control-error.log') | Out-Null
    for ($attempt=0; $attempt -lt 30; $attempt++) { try { $state=Invoke-RestMethod -Uri "$entryUrl/api/ping" -TimeoutSec 1; if ($state.app -eq 'deepseek-minecraft-live') { break } } catch {}; Start-Sleep -Milliseconds 300 }
    if (-not $state) { throw '控制台未启动，请查看 logs/control-error.log。' }
}
Start-Process $entryUrl
