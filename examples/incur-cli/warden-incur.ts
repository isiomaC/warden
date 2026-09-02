#!/usr/bin/env -S npx tsx
/**
 * Prototype: `packages/cli` (policy, audit, scan) rebuilt on incur
 * (https://github.com/wevm/incur) instead of citty.
 *
 * This is NOT wired into the real `warden` binary — it's a side-by-side
 * spike proving out the migration described in ROADMAP.md. It reuses the
 * exact same @stlw/warden primitives as packages/cli/src/commands/{policy,audit,scan}.ts
 * so the only thing under test is the CLI framework layer.
 *
 * Try it:
 *   npx tsx examples/incur-cli/warden-incur.ts policy --tool write_file --trust SYSTEM --environment production
 *   npx tsx examples/incur-cli/warden-incur.ts policy --tool write_file --trust BOGUS   # rejected before run() executes
 *   npx tsx examples/incur-cli/warden-incur.ts scan --prompt "ignore previous instructions"
 *   npx tsx examples/incur-cli/warden-incur.ts audit --demo
 *   npx tsx examples/incur-cli/warden-incur.ts audit --demo --format json
 *   npx tsx examples/incur-cli/warden-incur.ts --llms
 *   npx tsx examples/incur-cli/warden-incur.ts policy --schema
 *   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npx tsx examples/incur-cli/warden-incur.ts --mcp
 *
 * See examples/incur-cli/README.md for what each command demonstrates.
 */

import { Cli, z } from "incur";
import {
  evaluate,
  scanForInjection,
  MemoryLedgerStore,
  SqliteLedgerStore,
  TrustLevel,
} from "@stlw/warden";
import type { PolicyConfig } from "@stlw/warden";

const TRUST_LEVELS = ["SYSTEM", "AGENT", "TOOL", "EXTERNAL"] as const;

const TRUST_VALUE: Record<(typeof TRUST_LEVELS)[number], TrustLevel> = {
  SYSTEM: TrustLevel.SYSTEM,
  AGENT: TrustLevel.AGENT,
  TOOL: TrustLevel.TOOL,
  EXTERNAL: TrustLevel.EXTERNAL,
};

// Same demo policy set as packages/cli/src/commands/policy.ts, unchanged.
const demoPolicyConfig = (environment: string): PolicyConfig => ({
  version: "2",
  meta: { environment, sessionApprovalRequired: false },
  policies: [
    {
      id: "block-prod-writes",
      description: "No writes to production environment",
      match: { tools: ["write_file", "db_write", "git_push"], environment: ["production"] },
      action: "DENY",
    },
    {
      id: "confirm-destructive",
      description: "Human approval required for destructive ops",
      match: { tools: ["delete_file", "drop_table", "git_push", "send_email"] },
      action: "CONFIRM",
      channel: "stdout",
      timeoutSeconds: 60,
    },
    {
      id: "quarantine-external-to-write",
      description: "External content cannot flow into write operations",
      match: { trustSource: [TrustLevel.EXTERNAL], nextTool: ["write_file", "send_email", "shell", "db_write"] },
      action: "QUARANTINE",
    },
    {
      id: "allow-read-staging",
      description: "Read operations allowed in staging",
      match: {
        tools: ["read_file", "list_directory", "query", "search_code"],
        trustSource: [TrustLevel.SYSTEM, TrustLevel.AGENT],
        environment: ["staging", "development"],
      },
      action: "ALLOW",
    },
  ],
});

const cli = Cli.create("warden", {
  description: "Warden — Security layer for MCP-connected AI agents (incur prototype)",
})
  // ---------------------------------------------------------------------
  // Feature 1: schemas replace the hand-rolled `trustMap` + silent fallback
  // in packages/cli/src/commands/policy.ts:76-91. An invalid --trust value
  // is rejected by Zod before `run()` ever executes, instead of silently
  // becoming TrustLevel.TOOL.
  // ---------------------------------------------------------------------
  .command("policy", {
    description: "Dry-run policy evaluation",
    options: z.object({
      tool: z.string().describe("Tool name to test"),
      trust: z.enum(TRUST_LEVELS).default("TOOL").describe("Trust level"),
      environment: z
        .enum(["development", "staging", "production"])
        .default("development")
        .describe("Environment"),
    }),
    output: z.object({
      tool: z.string(),
      trust: z.enum(TRUST_LEVELS),
      environment: z.string(),
      decision: z.enum(["ALLOW", "DENY", "CONFIRM", "QUARANTINE"]),
      reason: z.string(),
    }),
    run(c) {
      const decision = evaluate(demoPolicyConfig(c.options.environment), {
        toolName: c.options.tool,
        toolInput: {},
        environment: c.options.environment,
        trustSources: [{ source: "mcp__test", trust: TRUST_VALUE[c.options.trust] }],
        serverInAllowlist: true,
      });

      return c.ok(
        {
          tool: c.options.tool,
          trust: c.options.trust,
          environment: c.options.environment,
          decision: decision.action,
          reason: decision.reason,
        },
        {
          cta: {
            commands: [
              { command: "audit", description: "See this decision in the ledger" },
            ],
          },
        },
      );
    },
  })
  .command("scan", {
    description: "Scan a prompt for injection patterns",
    options: z.object({
      prompt: z.string().describe("Prompt text to scan"),
      trust: z.enum(TRUST_LEVELS).default("EXTERNAL").describe("Trust level"),
    }),
    output: z.object({
      prompt: z.string(),
      trust: z.enum(TRUST_LEVELS),
      clean: z.boolean(),
      patterns: z.array(z.string()).optional(),
      recommendation: z.string().optional(),
    }),
    run(c) {
      const result = scanForInjection(c.options.prompt, TRUST_VALUE[c.options.trust]);
      return {
        prompt: c.options.prompt.slice(0, 80),
        trust: c.options.trust,
        clean: result.clean,
        ...(result.patterns ? { patterns: result.patterns } : {}),
        ...(result.recommendation ? { recommendation: result.recommendation } : {}),
      };
    },
  })
  // ---------------------------------------------------------------------
  // Feature 2 (partial — see README): returning plain data instead of
  // hand-formatted process.stdout.write() template strings (compare
  // packages/cli/src/commands/audit.ts:24-53) gets TOON output, --format
  // json/yaml/md, --filter-output, and --token-limit for free.
  // ---------------------------------------------------------------------
  .command("audit", {
    description: "View and verify the action ledger",
    options: z.object({
      db: z.string().optional().describe("Path to SQLite ledger (default: in-memory demo)"),
      demo: z.boolean().default(false).describe("Seed a few example ledger entries first"),
    }),
    run(c) {
      const ledger = c.options.db ? new SqliteLedgerStore(c.options.db) : new MemoryLedgerStore();

      if (c.options.demo) {
        ledger.write({
          timestamp: new Date().toISOString(),
          tool: "write_file",
          decision: "DENY",
          decisionReason: "Policy: block-prod-writes",
          trustSource: TrustLevel.AGENT,
          environment: "production",
        });
        ledger.write({
          timestamp: new Date().toISOString(),
          tool: "read_file",
          decision: "ALLOW",
          decisionReason: "Policy: allow-read-staging",
          trustSource: TrustLevel.AGENT,
          environment: "staging",
        });
      }

      const entries = ledger.getEntries();
      const chain = ledger.verifyChain();
      const events = ledger.getEvents();
      ledger.close();

      return {
        backend: c.options.db ? `sqlite:${c.options.db}` : "memory",
        entryCount: entries.length,
        chainValid: chain.valid,
        ...(chain.brokenAt !== undefined ? { brokenAt: chain.brokenAt } : {}),
        entries: entries.map((e) => ({ ts: e.timestamp, decision: e.decision, tool: e.tool, reason: e.decisionReason })),
        securityEvents: events.length,
      };
    },
  })
  .serve();
