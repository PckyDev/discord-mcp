param(
  [ValidateSet('Install', 'Remove')][string]$Action,
  [string]$NodePath,
  [string]$ListenerPath,
  [string]$StatePath
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$hasher = [Security.Cryptography.SHA256]::Create()
try {
  $stateHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($StatePath).ToLowerInvariant()))).Replace('-', '').Substring(0, 12)
} finally { $hasher.Dispose() }
$taskName = 'Discord MCP Chat ' + $stateHash
$startupFolder = [Environment]::GetFolderPath('Startup')
if ([string]::IsNullOrWhiteSpace($startupFolder)) { throw 'The current user Startup folder is unavailable.' }
$shortcutPath = Join-Path $startupFolder ($taskName + '.lnk')
# Older plugin versions used this exact scheduled-task name. Always reconcile it
# when switching to a per-user shortcut so an old task cannot survive unnoticed.
$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
$folder = $scheduler.GetFolder('\')
function Find-ChatTask {
  try { $folder.GetTask($taskName) }
  catch {
    # Only ERROR_FILE_NOT_FOUND means absent. Access denied, unavailable service,
    # and other failures must remain failures, never successful removal.
    if ($_.Exception.HResult -ne -2147024894) { throw }
    return $null
  }
}
if ($Action -eq 'Remove') {
  $hadShortcut = Test-Path -LiteralPath $shortcutPath
  if ($hadShortcut) { Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction Stop }
  $task = Find-ChatTask
  if ($null -ne $task) { $folder.DeleteTask($taskName, 0) }
  if ((Test-Path -LiteralPath $shortcutPath) -or $null -ne (Find-ChatTask)) { throw 'A startup entry still exists after removal.' }
  @{ present = $false; taskName = $taskName; entryPath = $shortcutPath; changed = ($hadShortcut -or $null -ne $task) } | ConvertTo-Json -Compress
  exit 0
}
foreach ($target in @($NodePath, $ListenerPath, $StatePath)) {
  if (-not [IO.Path]::IsPathRooted($target) -or $target.Contains('"')) { throw 'Startup paths must be absolute and cannot contain quotes.' }
}
# PowerShell's hidden window setting also keeps the child console out of the way.
$startupCommand = '& ' + "'" + $NodePath.Replace("'", "''") + "' '" + $ListenerPath.Replace("'", "''") + "' --state '" + $StatePath.Replace("'", "''") + "'"
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($startupCommand))
$oldTask = Find-ChatTask
if ($null -ne $oldTask) { $folder.DeleteTask($taskName, 0) }
if ($null -ne (Find-ChatTask)) { throw 'The legacy scheduled task could not be removed.' }
# A per-user Startup shortcut needs no task-registration privilege or elevation.
# Unlike a Run registry value, it also accommodates long installed-plugin paths.
$null = [IO.Directory]::CreateDirectory($startupFolder)
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $encodedCommand
$shortcut.WorkingDirectory = $StatePath
$shortcut.Description = 'Optional Discord MCP chat listener'
$shortcut.WindowStyle = 7
$shortcut.Save()
$installed = $shell.CreateShortcut($shortcutPath)
if (-not (Test-Path -LiteralPath $shortcutPath) -or $installed.TargetPath -ne $shortcut.TargetPath -or $installed.Arguments -ne $shortcut.Arguments) {
  throw 'Startup installation verification failed.'
}
@{ present = $true; taskName = $taskName; entryPath = $shortcutPath; mechanism = 'user-startup-shortcut'; changed = $true } | ConvertTo-Json -Compress
