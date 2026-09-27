# Changelog

## Unreleased

- Fix Windows chat setup under Restricted PowerShell execution policy using inline commands
  and a per-user Startup shortcut, with verified legacy-task cleanup and idempotent removal.
- Preserve unfinished setup drafts for focused edits and retry after startup failures.
- Verify current-instance listener health before reporting enablement; roll back failed starts,
  report installation/removal errors separately, and serialize setup/control requests.

- Add optional, disabled-by-default Discord mention/reply chat using an isolated Codex agent.
- Add one-question-at-a-time setup, model discovery and locking, status/start/stop/disable tools,
  and optional Windows sign-in startup.
- Enforce requester/channel allowlists, administrator-only mutations, exact expiring human
  confirmations, channel-local context, bounded sessions, rate limits, and bot-loop prevention.
- Add automated permission, configuration, runtime, Gateway, and app-server protocol tests.

All notable changes to Discord MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Automatic versioned GitHub Releases for successful pushes to `main`.
- Downloadable plugin ZIP archives and SHA-256 checksum files.

## [0.1.0] - 2026-08-24

### Added

- Local Codex MCP bridge for Discord API v10.
- Dedicated server, channel, role, member-role, and message tools.
- Guarded guild-scoped REST read and write fallback tools.
- Guild allowlisting, credential redaction, and request-bound confirmations.
- Administrator and least-privilege bot invite URLs.
- Discord MCP plugin branding and setup helper for Windows.
