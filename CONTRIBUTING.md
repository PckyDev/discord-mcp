# Contributing

Contributions are welcome through focused issues and pull requests.

## Development setup

1. Install Node.js 18 or newer.
2. Fork and clone the repository.
3. Run `npm test` from the repository root.
4. Keep Discord credentials outside the repository. Tests use a placeholder
   token and must not call the live Discord API.

## Pull requests

- Keep changes scoped and explain the user-visible behavior.
- Add or update smoke-test coverage when MCP tools or safety rules change.
- Run `npm test` before submitting.
- Never commit bot tokens, guild data, exported messages, or other private
  Discord content.
- Preserve the guild allowlist and two-phase confirmation safeguards unless a
  change replaces them with an equally strong or stronger control.

By contributing, you agree that your contribution is licensed under the MIT
License included with this repository.
