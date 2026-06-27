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
