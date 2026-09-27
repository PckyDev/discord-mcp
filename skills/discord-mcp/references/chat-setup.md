# Optional chat setup

Call `discord_chat_status`, then `discord_chat_setup`. Ask exactly the single returned
question and wait for the user's answer before calling setup again with `answer`.
Never fill unanswered choices or infer the user's Discord identity from the bot identity.
Resolve server/channel/role names with existing tools when useful. For a focused settings change,
call setup with `field` (model, effort, userIds, roleIds, channelIds, writeMode, or autoStart), then
ask the returned question and pass subsequent answers without field. This skips unrelated setup.
Use `reset: true` only to restart the full setup. Active settings stay unchanged until final approval.

The auth step returns a local login command. Help the user run it in an interactive terminal.
Never ask for credentials in chat or copy authentication from their personal Codex home.
Explain that the separate agent login uses its account limits/billing, and the host must stay awake.
Node.js 22+ and a compatible Codex app-server are required. Before enabling, explain that
Message Content intent must be enabled in Discord Developer Portal, including for replies
without a mention. A refused intent produces an actionable status error.

The tool discovers models, validates IDs, stores the draft, and returns the next question.
Do not manually edit configuration, install startup tasks, or launch another listener around it.
Recommend only the configuring user, confirmation for writes, and no automatic startup.
Automatic startup currently supports Windows sign-in only.

After final enablement, check status and ask the user to send a test mention in a selected
channel. Do not claim success until a response is observed. Use `discord_chat_control` for
start, stop, or disable. Stop ends the current process; disable also removes automatic startup
and leaves ordinary MCP tools working. Read status first for troubleshooting, fix prerequisites,
and retry once rather than repeatedly restarting or generating model calls.

Current safety boundaries: mutations require the requester's Administrator permission; context
reads stay inside the triggering channel or forum thread; the configured model is locked.
Confirmations are exact, expire in five minutes, and require the same user/channel. Configuration
tools are local-only and are not available to Discord users. Conversation continuity is per
user/channel, in memory, and expires after 30 minutes or restart. Users can mention the bot with
`reset conversation` or `cancel <id>` to reset context or cancel a proposal.
