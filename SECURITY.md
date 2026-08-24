# Security policy

## Supported versions

Security fixes are applied to the latest version on the `main` branch.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or an exposed
Discord bot token. Report security concerns privately through the contact
method at [pcky.dev](https://pcky.dev).

Include a concise description, reproduction steps, affected version, and the
potential impact. Do not include live credentials or private server data.

## Credential exposure

If a Discord bot token is exposed, reset it immediately in the Discord
Developer Portal, remove it from any logs or repository history, and restart
Codex after updating the `DISCORD_BOT_TOKEN` environment variable.

The project intentionally reads credentials from the process environment and
does not require tokens to be stored in the repository.
