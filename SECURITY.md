# Security policy

## Optional Discord chat

Chat is disabled by default. Its local setup/control tools must never be exposed to Discord
users. The bridge enforces user/role/channel allowlists, requester permissions, administrator-only
writes, and exact expiring human confirmations outside the model. Context reads stay in the
originating channel/thread. Preserve these boundaries when adding tools.

The agent uses a dedicated home and environment-less ephemeral threads with personal plugins,
apps, hooks, shell, browser, and computer tools disabled. Protect the external `.discord-mcp-chat`
directory, especially its isolated authentication. Never commit it. After changing the experimental
Codex interface, recheck protocol compatibility and isolation. See `docs/chat.md` for limitations.

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
