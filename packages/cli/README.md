# @stlw/warden-cli

The Warden command-line interface for protecting local AI-agent projects. It manages policy configuration, starts the hook server, runs dry-run checks, and exposes a policy-enforced MCP proxy.

## Install

```bash
npm install --global @stlw/warden-cli
warden --help
```

## Quick start

Run these commands from the project you want to protect:

```bash
warden init --environment development
warden config-validate
warden policy --tool read_file --trust SYSTEM --environment development
warden start
```

`init` creates `warden.config.yml`, `.warden/`, and a private `.env` containing a generated `WARDEN_AUTH_TOKEN`. `start` binds to `127.0.0.1` by default and loads that token from `.env`; requests to hook routes must include it in `X-Warden-Auth`. Binding to another interface requires a token. Edit the policy file before starting Warden. Use `development` while tuning rules, then validate the same policy in `staging` or `production` before rollout.

### Token and configuration locations

`warden start` first uses `WARDEN_AUTH_TOKEN` from the process environment. If
it is unset, it looks for `.env` in the **current working directory**. It does
not search parent directories or load `.env` beside a custom `--config` file.
The `--config` option selects the policy file only; it does not change token
lookup or the current-working-directory location used for runtime state.

- **Project setup:** run `warden init` from the project root, then run
  `warden start` from that directory. The generated `.env` is private and
  should not be committed. If you remove it, loopback startup still works,
  but shared-secret authentication for `/hooks/*` is disabled unless you set
  `WARDEN_AUTH_TOKEN` in the environment.
- **Environment or service manager:** set `WARDEN_AUTH_TOKEN` in the process
  environment. This takes precedence over `.env` and works from any directory.
- **Global policy file:** Warden has no `init --global` mode or automatic
  global config directory. You can initialize a config in a chosen location,
  then load that location's token into the environment before starting:

  ```bash
  mkdir -p "$HOME/.config/warden"
  (cd "$HOME/.config/warden" && warden init --environment development)

  set -a
  . "$HOME/.config/warden/.env"
  set +a
  warden start --config "$HOME/.config/warden/warden.config.yml"
  ```

  Source only a trusted `.env` file. When starting this way, the policy file
  is global, while relative state paths are still resolved from the directory
  where `warden start` runs.

When a token is configured, clients must send it as `X-Warden-Auth` on every
`/hooks/*` request. Binding to a non-loopback address, for example with
`warden start --host 0.0.0.0`, always requires a token. Keep the listener
loopback-only unless network access is needed, and restrict that access at the
network boundary.

For a manual local request, load the project token into your shell and send
the header (hook clients must also send a valid event body):

```bash
set -a
. ./.env
set +a
curl --request POST http://127.0.0.1:7429/hooks/session-start \
  --header "X-Warden-Auth: $WARDEN_AUTH_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"session_id":"example","allowedTools":["read_file"]}'
```

`allowedPaths` checks nested structured path fields and resolve symlinks. They do not inspect shell command strings, so a path embedded in a command is outside path scoping.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `warden config-validate` | Validate the YAML schema and detect rule conflicts. |
| `warden policy --tool <name> --trust <level> --environment <env>` | Dry-run one tool decision. |
| `warden scan --prompt "<text>"` | Check a prompt for injection patterns. |
| `warden start` | Start the HTTP hook server on `127.0.0.1:7429` by default (`--host` to choose another interface; external interfaces require `WARDEN_AUTH_TOKEN`). |
| `warden proxy` | Run a stdio MCP server for Cursor, Windsurf, and other MCP clients. |
| `warden audit` | View and verify the tamper-evident action ledger. |
| `warden supply-chain` | Check dependencies against pinned package hashes. |

## Export an audit ledger

By default, `warden audit` prints a human-readable integrity report. For
compliance tooling or archival pipelines, export the same ledger as structured
data:

```bash
# Versioned JSON containing chain status, ledger entries, and security events.
warden audit --db .warden/ledger.db --export json > warden-audit.json

# RFC 4180-compatible CSV records for spreadsheet or SIEM import.
warden audit --db .warden/ledger.db --export csv > warden-audit.csv
```

JSON output has `formatVersion: 1` and includes `chain`, `entries`, and
`securityEvents`. CSV emits a header followed by `ledger_entry` and
`security_event` records; nested values are JSON-encoded and CSV-escaped.
Exports contain Warden's stored, redacted tool input values. A valid chain is
evidence of continuity, not proof that an external tool executed successfully.

For MCP-only clients, register `warden proxy` as a stdio server and keep the target servers in `mcpServers.allowed` in `warden.config.yml`.

See the [public manual](https://github.com/isiomaC/warden/blob/main/docs/MANUAL.md) for the config schema and Claude Code, OpenCode, Cursor, and Windsurf setup.
