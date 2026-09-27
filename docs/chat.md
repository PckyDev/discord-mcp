# Chat with your Discord bot

Ask your local agent "Enable chatting with the Discord bot". The setup tools guide you one
question at a time and validate each answer. Then mention the bot or reply to it in Discord.
It uses existing tools to retrieve context and perform authorized server management.
This is a dedicated Codex agent, not a bridge into an existing ChatGPT desktop conversation.

## Requirements

- Node.js 22+ for the optional listener (ordinary MCP still supports Node.js 18+).
- Codex CLI with experimental app-server dynamic tools and environment-less threads, tested
  against 0.155.0-alpha.9.2. Set `DISCORD_CHAT_CODEX_EXECUTABLE` to its native executable if needed.
- Message Content intent enabled under Bot in Discord Developer Portal. Discord may require
  approval for this privileged intent. The listener requests it for reliable reply activation.
- Bot permissions: View Channel, Read Message History, Send Messages, Send Messages in Threads,
  and permissions needed for requested mutations. Discord role hierarchy still applies.
- An awake local computer, a running listener, and the bot token in its environment.

Setup discovers models from the isolated agent login. Model calls use that account's usage
limits or billing and send relevant Discord content to its model provider. Never paste bot
tokens or login credentials in chat. Use the supplied local login command instead.

## Defaults and security boundaries

- Disabled on installation. Only configured servers, users/roles, and channels activate it.
  Setup defaults to the configuring administrator only.
- Mutations require the requester to have Administrator permission, not just the bot.
  Granular delegated moderator writes are not supported yet; other allowed users can ask questions.
- All writes require exact-change confirmation by default. Reply/mention with `confirm <id>`
  within five minutes. The bridge, not the model, validates the same user/channel and executes
  the stored request. `cancel <id>` cancels. Owners can explicitly select direct administrator writes.
- Context reads stay inside the triggering channel or forum thread, including its opening post.
  Cross-channel history and server-wide search are not exposed, to avoid private-content leaks.
- Conversations are separated by server/channel/user, expire after 30 minutes of inactivity,
  and reset on restart or permission changes. Mention `reset conversation` to clear yours.
- Model selection is locked. Unavailable models fail without fallback. A reported service reroute
  stops the run and is surfaced; previously completed actions cannot be undone by this.
- One run at a time, a bounded queue, five-second per-user cooldown, 20 tool calls and three
  minutes per turn, bounded context/results, deduplication, and no bot/webhook activation.
- The agent has no execution environment. Personal plugins, apps, shell, browser, hooks, and
  other computer tools are disabled. Discord operations pass through the bridge permission layer.

## Operation and troubleshooting

Ask to change configuration, check status, stop, or disable chat. The local-only tools are
`discord_chat_setup`, `discord_chat_status`, and `discord_chat_control`. Reconfiguration is a draft
until final approval. Disabling removes Windows autostart without affecting ordinary MCP tools.
Startup is at Windows sign-in, not boot before login. On other platforms run `npm run chat:start`
under your preferred service manager. Stop before upgrading/removing the plugin installation used
by the startup task, then run setup again so startup uses the current paths.

Configuration and isolated authentication live outside the repository in `~/.discord-mcp-chat`;
override with `DISCORD_CHAT_HOME`. Protect this directory as sensitive. Listener status does not
store Discord message bodies. Codex can retain local diagnostic data in its isolated home according
to its own behavior. Conversation sessions and pending approvals are intentionally not persisted.

A Gateway 4014 failure usually means Message Content intent is missing or unapproved. Login/model
failures require the isolated login or a different available model. Setup ends with a manual test
mention, not an automatically posted message. On shutdown, queued messages are discarded. After
a failed request, inspect status before retrying: completed side effects are not automatically undone.

The app-server APIs used here are experimental. Run the tests and a controlled test-server mention
after changing Codex versions. Protocol tests do not replace a real authenticated end-to-end test.
