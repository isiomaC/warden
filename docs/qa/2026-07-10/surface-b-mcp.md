# Surface B — MCP Proxy Headless Harness

Date: 2026-07-10
Status: **PASS** — All proxy tests pass

## Tests (`packages/cli/tests/proxy.test.ts`)

| # | Test | Status | Notes |
|---|---|---|---|
| 1 | Exits 1 when config file missing | PASS | |
| 2 | Exits 1 when config has no mcpServers.allowed | PASS | |
| 3 | tools/list returns real per-tool JSON Schema | PASS | `filesystem__read_file`, `filesystem__write_file` |
| 3 | tools/call ALLOW (read_file matches policy) | PASS | |
| 3 | tools/call DENY (write_file, default deny) | PASS | |
| 3 | tools/call unknown tool (delete_file) | PASS | correctly denied |

## Gaps

- No CONFIRM scenario in proxy tests (proxy command doesn't support `--auto-approve`)
- No rate-limit scenario

## Raw logs

See `raw/surface-b-proxy-test-output.txt`.
