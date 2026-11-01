param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination,[switch]$NativeOnly)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Directory]::CreateDirectory($Destination) | Out-Null
$root=[IO.Path]::GetFullPath($Destination).TrimEnd('\')+'\'
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
 foreach($entry in $zip.Entries){
  if($NativeOnly -and !$entry.Name.EndsWith('.dll')){continue}
  if(!$entry.Name){continue}
  $relative=if($NativeOnly){$entry.Name}else{$entry.FullName.Replace('/','\')}
  $target=[IO.Path]::GetFullPath((Join-Path $Destination $relative))
  if(!$target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid archive path'}
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
 }
}finally{$zip.Dispose()}
