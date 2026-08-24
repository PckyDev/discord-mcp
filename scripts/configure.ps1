param(
    [switch]$Clear
)

$ErrorActionPreference = 'Stop'

if ($Clear) {
    [Environment]::SetEnvironmentVariable('DISCORD_BOT_TOKEN', $null, 'User')
    [Environment]::SetEnvironmentVariable('DISCORD_ALLOWED_GUILD_IDS', $null, 'User')
    Write-Host 'Discord MCP credentials and allowlist were removed from the Windows user environment.'
    Write-Host 'Restart Codex before using the plugin again.'
    exit 0
}

$secureToken = Read-Host 'Discord bot token (input is hidden)' -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $botToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}

if ([string]::IsNullOrWhiteSpace($botToken)) {
    throw 'The bot token cannot be empty.'
}

$guildInput = Read-Host 'Allowed guild IDs, comma-separated (recommended; leave blank to allow every guild the bot joins)'
$guildIds = @()
if (-not [string]::IsNullOrWhiteSpace($guildInput)) {
    $guildIds = $guildInput.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    foreach ($guildId in $guildIds) {
        if ($guildId -notmatch '^\d{17,20}$') {
            throw "Invalid Discord guild ID: $guildId"
        }
    }
}

[Environment]::SetEnvironmentVariable('DISCORD_BOT_TOKEN', $botToken, 'User')
[Environment]::SetEnvironmentVariable('DISCORD_ALLOWED_GUILD_IDS', ($guildIds -join ','), 'User')
$botToken = $null

Write-Host 'Discord MCP configuration saved to the Windows user environment.'
if ($guildIds.Count -eq 0) {
    Write-Warning 'No guild allowlist was configured. Every guild the bot joins will be accessible.'
} else {
    Write-Host "Allowed guilds: $($guildIds -join ', ')"
}
Write-Host 'Restart Codex so the MCP server receives the updated environment.'
