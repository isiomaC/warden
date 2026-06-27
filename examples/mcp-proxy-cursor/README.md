# Warden + Cursor: MCP Proxy with Policy Enforcement

Run Warden as a transparent MCP proxy between Cursor and your tool servers.
Every tool call flows through Warden's deterministic policy engine — it evaluates,
logs to a hash-chained ledger, and returns ALLOW/DENY before the real server is
ever contacted.

```
Cursor Tool Call → Warden Proxy (warden-proxy.ts) → Real MCP Server
                       │
                       ├─ Policy evaluation (allow/deny/confirm)
                       ├─ Rate limiting
                       ├─ Ledger entry (hash-chained, tamper-evident)
                       └─ ALLOW/DENY decision
```

## Prerequisites

- **Node.js >= 22** (or Bun)
- **npm**
- **Cursor** installed (any edition)
- Git

## Setup

### 1. Install dependencies

```bash
cd examples/mcp-proxy-cursor
npm install
```

### 2. Review the policy config

Look at `warden.config.yml`. It defines two policies:

| Policy | Action | Description |
|---|---|---|
| `allow-reads` | ALLOW | Read operations allowed in development |
| `block-dangerous` | DENY | Block shell exec, file deletes, and destructive patterns |

The filesystem server is in the `mcpServers.allowed` list with `read_file` and `list_directory` tools.

### 3. Run the proxy

```bash
npx tsx warden-proxy.ts
```

You should see:

```
[INFO]  Warden proxy starting...
[INFO]  Gateway initialized — 1 server(s) in allowlist
[INFO]  Policy rules loaded: allow-reads, block-dangerous
[INFO]  Warden MCP proxy listening on stdio
```

### 4. Configure Cursor

Open Cursor → **Settings** (Cmd+, ) → **MCP** → **+ Add new MCP server**

Fill in the details:

| Field | Value |
|---|---|
| **Server name** | `warden-filesystem` |
| **Type** | stdio |
| **Command** | `npx` |
| **Args** | `tsx /absolute/path/to/warden-proxy.ts` |

Click **Add server**. Cursor will launch the proxy as a child process.

> **Important:** All tool calls now go through Warden. If the proxy is down, all
> MCP tool calls are blocked (fail-closed).

### 5. Test policy enforcement

1. In Cursor, ask the agent to **read a file** — this should succeed (policy: `allow-reads`)
2. Ask the agent to **delete a file** — this should be blocked (policy: `block-dangerous`)
3. Ask the agent to **execute a shell command containing `rm -rf`** — blocked (input pattern match)

You can also verify the ledger after a session:

```bash
npx tsx warden-proxy.ts --audit
```

### 6. Run the demo (no Cursor needed)

The proxy includes a built-in demo that simulates tool calls to show policy enforcement:

```bash
npx tsx warden-proxy.ts --demo
```

Output:

```
Demo: Simulating 3 tool calls through Warden policy engine

[1] read_file /tmp/test.txt
    → ALLOW   (Policy: allow-reads — Allow all read operations)

[2] delete_file /tmp/test.txt
    → DENY    (Policy: block-dangerous — Block destructive operations)

[3] Bash command: rm -rf /tmp/*
    → DENY    (Policy: block-dangerous — Block dangerous shell patterns)
```

## Files

| File | Purpose |
|---|---|
| `warden-proxy.ts` | Proxy script — wraps MCP servers, enforces policy, listens on stdio |
| `warden.config.yml` | Policy configuration — rules, server allowlist, environment |

## How It Works

```
1. Cursor launches warden-proxy.ts as a child process
2. Proxy receives JSON-RPC method calls on stdin
3. On tools/call, gateway.wrapMCP().onToolCall() evaluates policy
4. Policy engine runs deterministic rule matching (no LLM involved)
5. Decision returned: ALLOW → forward to real server, DENY → block
6. Every call logged to hash-chained ledger before execution
```

**Key invariants:**
- DENY is the default — any unmatched tool = blocked
- Fail-closed — proxy crash = all tool calls blocked
- No LLM in the security path — policy engine is pure pattern matching
- Ledger is append-only and hash-chained — tamper-evident audit trail

## Troubleshooting

| Symptom | Fix |
|---|---|
| Cursor can't connect | Check the path in Cursor MCP config is absolute and `npx tsx` is available |
| All tools blocked | Verify the tool is in `mcpServers.allowed[].allowedTools` in `warden.config.yml` |
| "Unknown tool" errors | Add the tool to the `allowedTools` list for the server |
| Rate limit errors | Check `maxCallsPerMinute` on the wrapped server in `warden-proxy.ts` |

## Next Steps

- Add more policies to `warden.config.yml` for your use case
- Add more servers to the MCP registry
- Configure approval channels (Telegram/Slack) for CONFIRM decisions
- Deploy as a daemon with systemd/launchd

## Docs

- [Warden README](../../README.md) — project overview, architecture, quick start
- [Plan V2](../../docs/internal/docs/internal/planV2.md) — authoritative implementation spec
- [Claude Code Example](../claude-code-basic/) — hook server integration
