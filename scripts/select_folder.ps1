$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog=[Windows.Forms.FolderBrowserDialog]::new()
$dialog.Description='Select your Minecraft game folder'
$dialog.ShowNewFolderButton=$false
try{if($dialog.ShowDialog() -eq [Windows.Forms.DialogResult]::OK){Write-Output $dialog.SelectedPath}}finally{$dialog.Dispose()}
