import { defineCommand } from "citty";
import { evaluate, TrustLevel } from "@wardenlabs/core";
import type { PolicyConfig } from "@wardenlabs/core";

export const policyCommand = defineCommand({
  meta: {
    name: "policy",
    description: "Dry-run policy evaluation",
  },
  args: {
    tool: {
      type: "string",
      description: "Tool name to test",
      required: true,
    },
    trust: {
      type: "string",
      description: "Trust level (SYSTEM, AGENT, TOOL, EXTERNAL)",
      default: "TOOL",
    },
    environment: {
      type: "string",
      description: "Environment (development, staging, production)",
      default: "development",
    },
  },
  async run({ args }) {
    const config: PolicyConfig = {
      version: "2",
      meta: {
        environment: args.environment,
        sessionApprovalRequired: false,
      },
      policies: [
        {
          id: "block-prod-writes",
          description: "No writes to production environment",
          match: {
            tools: ["write_file", "db_write", "git_push"],
            environment: ["production"],
          },
          action: "DENY",
        },
        {
          id: "confirm-destructive",
          description: "Human approval required for destructive ops",
          match: {
            tools: ["delete_file", "drop_table", "git_push", "send_email"],
          },
          action: "CONFIRM",
          channel: "stdout",
          timeoutSeconds: 60,
        },
        {
          id: "quarantine-external-to-write",
          description: "External content cannot flow into write operations",
          match: {
            trustSource: [TrustLevel.EXTERNAL],
            nextTool: ["write_file", "send_email", "shell", "db_write"],
          },
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
    };

    const trustMap: Record<string, number> = {
      SYSTEM: TrustLevel.SYSTEM,
      AGENT: TrustLevel.AGENT,
      TOOL: TrustLevel.TOOL,
      EXTERNAL: TrustLevel.EXTERNAL,
    };

    const trust = trustMap[args.trust.toUpperCase()] ?? TrustLevel.TOOL;

    const result = evaluate(config, {
      toolName: args.tool,
      toolInput: {},
      environment: args.environment,
      trustSources: [{ source: "mcp__test", trust: trust as typeof TrustLevel.EXTERNAL }],
      serverInAllowlist: true,
    });

    process.stdout.write(`
=== Policy Dry Run ===

Tool:     ${args.tool}
Trust:    ${args.trust.toUpperCase()}
Env:      ${args.environment}
Decision: ${result.action}
Reason:   ${result.reason}
`);
  },
});
