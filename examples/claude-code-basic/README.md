# Warden + Claude Code: Basic Setup

This example shows the minimum configuration to run Warden with Claude Code.

## Files
- `warden.config.yml` — Policy configuration
- `.claude/settings.json` — Claude Code hook registrations

## Usage

1. Start Warden: `npx @warden/cli start`
2. Start Claude Code: `claude`
3. Try a blocked operation: Ask Claude to `rm -rf /tmp/test`
4. Check the audit log: `npx @warden/cli audit`

This intentionally runs with no `WARDEN_AUTH_TOKEN` for the shortest possible
path to a working demo — any local process can reach the hook server. Do not
run it this way outside a throwaway local sandbox. For a real setup, see the
main [README](../../README.md#4-start-warden)'s `WARDEN_AUTH_TOKEN` /
`X-Warden-Auth` header configuration, or
[`docs/internal/DEPLOYMENT.md`](../../docs/internal/DEPLOYMENT.md).
