/**
 * Warden Hook Server Example
 *
 * Demonstrates creating the full Claude Code hook server with all 6 endpoints.
 * Starts on localhost:7429. Hit with curl to test each hook.
 *
 * Start:  npx tsx examples/hook-server/index.ts
 * Then in another terminal:
 *   curl http://localhost:7429/health
 *   curl -s -X POST http://localhost:7429/hooks/session-start -H 'Content-Type: application/json' -d '{"session_id":"demo","allowedTools":["read_file","Bash"]}'
 */

import { createHookServer, startHookServer } from "@warden/hook-server";

const PORT = 7429;

// Define a minimal policy
const config = {
  version: "2",
  meta: { environment: "development", sessionApprovalRequired: false },
  policies: [
    {
      id: "allow-reads-dev",
      description: "Allow read operations in development",
      match: {
        tools: ["read_file", "list_directory", "query", "Bash"],
        trustSource: [0, 1, 2, 3],  // all trust levels
        environment: ["development"],
      },
      action: "ALLOW" as const,
    },
    {
      id: "block-shell-injection",
      description: "Block known shell injection patterns",
      match: {
        tool: "Bash",
        inputPatterns: [
          "rm\\s+-rf",
          "curl.*\\|.*sh",
          "eval\\s*\\(",
        ],
      },
      action: "DENY" as const,
    },
  ],
};

const server = startHookServer({ config, port: PORT });

console.log(`
╔══════════════════════════════════════════════════╗
║       Warden Hook Server — Demo Mode             ║
╠══════════════════════════════════════════════════╣
║  Listening on http://localhost:${PORT}               ║
║                                                  ║
║  Endpoints:                                      ║
║    GET  /health          — server health         ║
║    GET  /metrics         — operational stats     ║
║    POST /hooks/session-start  — mint token       ║
║    POST /hooks/pre-tool-use   — policy gate      ║
║    POST /hooks/post-tool-use  — trust tagging    ║
║    POST /hooks/prompt-submit  — injection scan   ║
║    POST /hooks/config-change  — always block     ║
║    POST /hooks/session-end    — revoke tokens    ║
║                                                  ║
║  Quick test:                                     ║
║    curl http://localhost:${PORT}/health              ║
╚══════════════════════════════════════════════════╝

Press Ctrl+C to stop.
`);
