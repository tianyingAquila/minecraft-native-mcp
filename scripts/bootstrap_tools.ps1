$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$projectRoot=Split-Path -Parent $PSScriptRoot
$dshRoot=if($env:DSH_HOME){$env:DSH_HOME}else{Join-Path $env:USERPROFILE '.dsh'}
$node=Get-Item -Path "$dshRoot/dsh-runtimes/*/dependencies/node/bin/node.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if(!$node){$command=Get-Command node.exe -ErrorAction SilentlyContinue;if($command){$node=Get-Item -LiteralPath $command.Source}}
if(!$node){throw 'DSH Node runtime not found. Update or repair DSH.'}
& $node.FullName -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<16))process.exit(1)"
if($LASTEXITCODE -ne 0){throw 'Node22.16+ required. Update DSH.'}
$env:PATH=$node.DirectoryName+';'+$env:PATH
Push-Location $projectRoot
try {
 Write-Output 'PHASE:control-dependencies'
 if(!(Test-Path node_modules/@modelcontextprotocol/sdk/package.json) -or !(Test-Path node_modules/yaml/package.json) -or !(Test-Path node_modules/zod/package.json)){
  $npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
  if($npm){& $npm.Source ci --ignore-scripts --no-audit --no-fund}
  else {
   $pnpm=Get-Item -Path "$dshRoot/dsh-runtimes/*/dependencies/pnpm/bin/pnpm.cjs" -ErrorAction SilentlyContinue | Select-Object -First 1
   if(!$pnpm){throw 'DSH package manager not found. Repair DSH.'}
   & $node.FullName $pnpm.FullName import
   if($LASTEXITCODE -ne 0){throw 'Dependency lock import failed'}
   & $node.FullName $pnpm.FullName install --frozen-lockfile --ignore-scripts
  }
  if($LASTEXITCODE -ne 0){throw 'Controller dependencies could not be installed. Check network and retry.'}
 }
 New-Item -ItemType Directory -Force runtime | Out-Null
 $tools=@{}
 if(Test-Path runtime/tools.json){$old=Get-Content runtime/tools.json -Raw | ConvertFrom-Json;foreach($p in $old.PSObject.Properties){$tools[$p.Name]=$p.Value}}
 $tools['node']=$node.FullName
 $tools | ConvertTo-Json | Set-Content -Encoding utf8 runtime/tools.json
 Write-Output 'PHASE:tools-ready'
} finally {Pop-Location}
