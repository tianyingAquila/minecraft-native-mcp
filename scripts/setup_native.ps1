param([string]$MinecraftHome='', [string]$Version='auto')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
 & (Join-Path $PSScriptRoot 'bootstrap_tools.ps1')
 $tools=Get-Content runtime/tools.json -Raw | ConvertFrom-Json
 $arguments=@('scripts/prepare_game.mjs','--version',$Version)
 if($MinecraftHome){$arguments+=@('--minecraft-home',$MinecraftHome)}
 & $tools.node @arguments
 if($LASTEXITCODE -ne 0){throw 'Game preparation failed. See the diagnostic above.'}
}finally{Pop-Location}
