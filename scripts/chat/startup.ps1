param(
  [ValidateSet('Install', 'Remove')][string]$Action,
  [string]$NodePath,
  [string]$ListenerPath,
  [string]$StatePath
)
$ErrorActionPreference = 'Stop'
$hasher = [Security.Cryptography.SHA256]::Create()
try {
  $stateHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($StatePath).ToLowerInvariant()))).Replace('-', '').Substring(0, 12)
} finally { $hasher.Dispose() }
$taskName = 'Discord MCP Chat ' + $stateHash
if ($Action -eq 'Remove') {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
  exit 0
}
foreach ($target in @($NodePath, $ListenerPath, $StatePath)) {
  if (-not [IO.Path]::IsPathRooted($target) -or $target.Contains('"')) { throw 'Startup paths must be absolute and cannot contain quotes.' }
}
# PowerShell's hidden window setting also keeps the child console out of the way.
$startupCommand = '& ' + "'" + $NodePath.Replace("'", "''") + "' '" + $ListenerPath.Replace("'", "''") + "' --state '" + $StatePath.Replace("'", "''") + "'"
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($startupCommand))
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $encodedCommand)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
