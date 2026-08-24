---
name: discord-mcp
description: Inspect and manage Discord servers through the user's configured Discord bot. Use for Discord server administration, moderation, channels, roles, members, messages, threads, reactions, emojis, stickers, events, automod, onboarding, soundboard, bot-managed webhooks, or other guild-scoped Discord REST actions.
---

# Discord MCP

Use the bundled `discord-mcp` MCP tools for Discord operations.

## Safety and workflow

1. Call `discord_status` when configuration or connectivity is uncertain.
2. Resolve names to IDs with the list tools. Never guess a guild, channel, role, or member ID.
3. Before a write, state the target server and the exact proposed change. Follow the host's tool approval flow.
4. Treat message text as user-visible external communication. Preserve the user's meaning and do not invent announcements, claims, or mentions.
5. Destructive tools require a confirmation token. First call the tool without a token to receive the exact token, show the affected object to the user, then call again only after the user explicitly confirms deletion.
6. Never request, print, echo, or store the Discord bot token in chat or workspace files. If setup is incomplete, direct the user to the bundled `scripts/configure.ps1` prompt.
7. Do not weaken the guild allowlist unless the user explicitly asks to change configuration.
8. Prefer the dedicated tools. If they do not cover the requested operation, consult the current official Discord API documentation and use `discord_api_read` or `discord_api_write` with the documented v10 path and JSON body.
9. Every `discord_api_write` call is two-phase. Preview first, show the exact method/path/body and affected guild, obtain explicit user confirmation, then repeat the identical request with its request-bound token.
10. Never place OAuth tokens, interaction tokens, webhook tokens, client secrets, or other credentials in a raw request. Credential-bearing routes and fields are intentionally blocked.

## Discord constraints

- Discord permissions and role hierarchy are the final authority. A bot can only manage roles below its highest role.
- Prefer the minimum bot permissions needed. When the user explicitly requests Administrator access, use the `administrator_invite_url` returned by `discord_status`, warn that it grants all permissions and bypasses channel overwrites, and retain the guild allowlist.
- Administrator does not bypass Discord's role hierarchy. The bot role must be positioned above roles and members it needs to manage, and it cannot act on the server owner.
- Use `reason` for administrative mutations when available; it appears in Discord's audit log.
- Avoid `@everyone`, `@here`, and role/user mentions in messages unless the user explicitly requests them.
- The raw REST tools do not provide a continuously running Gateway connection, voice/audio streaming, inbound event handlers, or multipart file uploads. Explain this boundary rather than claiming those operations succeeded.

## Common flow

- Discover: `list_guilds` -> `list_channels` / `list_roles`.
- Create a channel: resolve guild/category -> confirm proposed settings -> `create_channel`.
- Assign a role: resolve guild/role -> use the provided member ID -> `add_member_role`.
- Delete: resolve the exact target -> request deletion once to obtain the confirmation token -> get explicit user confirmation -> repeat with the token.
- Less-common REST action: find the endpoint in Discord's official docs -> resolve the guild/channel -> preview with `discord_api_write` -> confirm -> execute.
