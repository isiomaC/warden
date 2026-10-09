import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, FileConfigSource, TrustLevel } from "@stlw/warden";
import type { PolicyConfig } from "@stlw/warden";

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
      description: "Environment (development, staging, production). Default: the config's environment",
    },
    config: {
      type: "string",
      description: "Path to warden.config.yml (default: ./warden.config.yml if present)",
      default: "warden.config.yml",
    },
    input: {
      type: "string",
      description: 'Tool input as JSON, e.g. \'{"command":"rm -rf /"}\' (default: {})',
      default: "{}",
    },
  },
  async run({ args }) {
    let toolInput: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(args.input ?? "{}");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      toolInput = parsed as Record<string, unknown>;
    } catch {
      process.stderr.write(`Warden: invalid --input. Expected a JSON object, got: ${args.input}\n`);
      process.exit(1);
    }

    const configPath = resolve(args.config ?? "warden.config.yml");
    const projectConfig = existsSync(configPath)
      ? await new FileConfigSource(configPath).load()
      : undefined;
    const environment = args.environment ?? projectConfig?.meta.environment ?? "development";
    const policySource = projectConfig ? (args.config ?? "warden.config.yml") : "built-in demo policy (no warden.config.yml found)";

    const config: PolicyConfig = projectConfig ?? {
      version: "2",
      meta: {
        environment,
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

    const normalizedTrust = args.trust.toUpperCase();
    if (!(normalizedTrust in trustMap)) {
      process.stderr.write(
        `Warden: invalid --trust "${args.trust}". Expected one of: ${Object.keys(trustMap).join(", ")}\n`,
      );
      process.exit(1);
    }
    const trust = trustMap[normalizedTrust];

    const result = evaluate(config, {
      toolName: args.tool,
      toolInput,
      environment,
      trustSources: [{ source: "mcp__test", trust: trust as typeof TrustLevel.EXTERNAL }],
      serverInAllowlist: true,
    });

    process.stdout.write(`
=== Policy Dry Run ===

Policy:   ${policySource}
Tool:     ${args.tool}
Trust:    ${args.trust.toUpperCase()}
Env:      ${environment}
Decision: ${result.action}
Reason:   ${result.reason}
`);
  },
});
