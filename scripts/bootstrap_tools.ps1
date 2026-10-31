$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$OutputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=$OutputEncoding
$projectRoot=Split-Path -Parent $PSScriptRoot
$toolsRoot=Join-Path $projectRoot 'runtime/tools'
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
$dshRoot=if($env:DSH_HOME){$env:DSH_HOME}else{Join-Path $env:USERPROFILE '.dsh'}
function Find-Tool($name,$patterns){
    foreach($pattern in $patterns){$found=Get-Item -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1;if($found){return $found.FullName}}
    $cmd=Get-Command $name -ErrorAction SilentlyContinue
    if($cmd -and $cmd.Source -and $cmd.Source -notmatch 'WindowsApps'){return $cmd.Source}
    return $null
}
function Get-Archive($url,$destination,$checksum){
    Invoke-WebRequest -Uri $url -OutFile $destination -TimeoutSec 300
    if($checksum -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum.ToLowerInvariant()){throw 'Dependency checksum mismatch'}
}
$node=Find-Tool 'node.exe' @("$dshRoot/dsh-runtimes/*/dependencies/node/bin/node.exe")
if(!$node){throw 'DSH Node runtime not found. Repair/reinstall DSH first.'}
$pnpm=Get-Item -Path "$dshRoot/dsh-runtimes/*/dependencies/pnpm/bin/pnpm.cjs" -ErrorAction SilentlyContinue | Select-Object -First 1
$npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
function Install-NodeDependencies {
    if($npm){& $npm.Source ci --ignore-scripts --no-fund}
    elseif($pnpm){& $node $pnpm.FullName import;if($LASTEXITCODE -ne 0){throw 'Lock import failed'};& $node $pnpm.FullName install --frozen-lockfile --ignore-scripts}
    else{throw 'DSH npm/pnpm runtime not found. Repair DSH first.'}
    if($LASTEXITCODE -ne 0){throw 'Node dependencies failed'}
}
function Build-NodeProject {
    if($npm){& $npm.Source run build}else{& $node $pnpm.FullName run build}
    if($LASTEXITCODE -ne 0){throw 'Node build failed'}
}
Push-Location $projectRoot
try{
    Write-Output 'PHASE:control-dependencies'
    if(!(Test-Path 'node_modules/@modelcontextprotocol/sdk/package.json')){Install-NodeDependencies}
    Write-Output 'PHASE:python-git'
    $python=Find-Tool 'python.exe' @("$dshRoot/dsh-runtimes/*/dependencies/python/python.exe","$toolsRoot/python/python.exe")
    if(!$python){
        # DSH desktop normally supplies Python. Standalone installations use an official portable distribution.
        $archive=Join-Path $toolsRoot 'python.zip'
        Get-Archive 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' $archive $null
        Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolsRoot 'python') -Force
        Remove-Item -LiteralPath $archive
        $python=Join-Path $toolsRoot 'python/python.exe'
    }
    $git=Find-Tool 'git.exe' @("$toolsRoot/git/cmd/git.exe")
    if(!$git){
        $release=Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest'
        $asset=$release.assets | Where-Object name -Match '^MinGit-.*-64-bit.zip$' | Select-Object -First 1
        if(!$asset -or !$asset.digest -or !$asset.digest.StartsWith('sha256:')){throw 'Verified Git archive not available'}
        $archive=Join-Path $toolsRoot 'git.zip';Get-Archive $asset.browser_download_url $archive $asset.digest.Substring(7)
        Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolsRoot 'git') -Force;Remove-Item -LiteralPath $archive
        $git=Join-Path $toolsRoot 'git/cmd/git.exe'
    }
    Write-Output 'PHASE:java21'
    $java=$null
    $candidates=@()
    if($env:FISH_JAVA){$candidates+=$env:FISH_JAVA}
    if($env:JAVA_HOME){$candidates+=(Join-Path $env:JAVA_HOME 'bin/java.exe')}
    $command=Get-Command java.exe -ErrorAction SilentlyContinue;if($command){$candidates+=$command.Source}
    $candidates+=@(Get-Item -Path "$env:ProgramFiles/Microsoft/jdk-21*/bin/java.exe","$env:ProgramFiles/Eclipse Adoptium/jdk-21*/bin/java.exe","$toolsRoot/jdk/*/bin/java.exe" -ErrorAction SilentlyContinue | ForEach-Object FullName)
    foreach($candidate in $candidates){if(!(Test-Path -LiteralPath $candidate)){continue};$info=& $candidate --version 2>$null | Out-String;if($info -match '(?:openjdk|java) 21[\.]' -and(Test-Path (Join-Path (Split-Path $candidate) 'javac.exe'))){$java=$candidate;break}}
    if(!$java){
        $assets=Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
        $package=$assets[0].binary.package;if(!$package.checksum){throw 'Verified JDK21 package not available'}
        $archive=Join-Path $toolsRoot 'jdk.zip';Get-Archive $package.link $archive $package.checksum
        Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolsRoot 'jdk') -Force;Remove-Item -LiteralPath $archive
        $java=(Get-Item -Path "$toolsRoot/jdk/*/bin/java.exe" | Select-Object -First 1).FullName
    }
    $env:JAVA_HOME=Split-Path (Split-Path $java);$env:FISH_JAVA=$java
    $env:PATH=((Split-Path $node),(Split-Path $python),(Split-Path $git),(Split-Path $java),$env:PATH)-join ';'
    $env:FISH_PYTHON=$python
    @{node=$node;python=$python;git=$git;java=$java;javaHome=$env:JAVA_HOME;pnpm=$pnpm.FullName}|ConvertTo-Json|Set-Content -Encoding utf8 (Join-Path $projectRoot 'runtime/tools.json')
    Write-Output 'PHASE:tools-ready'
}finally{Pop-Location}
