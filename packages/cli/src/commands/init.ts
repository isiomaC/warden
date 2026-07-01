import { defineCommand } from "citty";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "@warden/core";

const VALID_ENVIRONMENTS = ["development", "staging", "production"];

function defaultConfigYaml(environment: string): string {
  return `version: "2"

meta:
  environment: "${environment}"
  sessionApprovalRequired: false

mcpServers:
  allowed:
    - name: "filesystem"
      type: local
      transport: stdio
      allowedTools: ["read_file", "list_directory", "write_file"]
      authRequired: false

policies:
  - id: "block-shell-injection"
    description: "Block dangerous shell patterns"
    match:
      tool: "Bash"
      inputPatterns:
        - "rm\\\\s+-rf"
        - "curl.*\\\\|.*sh"
        - "eval\\\\s*\\\\("
    action: DENY

  - id: "confirm-destructive"
    description: "Human approval for destructive operations"
    match:
      tools: ["delete_file", "drop_table", "git_push"]
    action: CONFIRM
    channel: "stdout"
    timeoutSeconds: 60

  - id: "allow-reads"
    description: "Allow read operations in development"
    match:
      tools: ["read_file", "list_directory"]
      environment: ["development", "staging"]
    action: ALLOW
`;
}

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Initialize Warden in the current project",
  },
  args: {
    environment: {
      type: "string",
      description: "Environment (development, staging, production)",
      default: "development",
    },
    force: {
      type: "boolean",
      description: "Overwrite an existing warden.config.yml",
      default: false,
    },
  },
  async run({ args }) {
    if (!VALID_ENVIRONMENTS.includes(args.environment)) {
      process.stderr.write(
        `Invalid environment "${args.environment}". Must be one of: ${VALID_ENVIRONMENTS.join(", ")}\n`,
      );
      process.exit(1);
    }

    const configPath = resolve("warden.config.yml");
    const wardenDir = resolve(".warden");

    if (existsSync(configPath) && !args.force) {
      process.stderr.write(
        `warden.config.yml already exists at ${configPath}. Re-run with --force to overwrite.\n`,
      );
      process.exit(1);
    }

    writeFileSync(configPath, defaultConfigYaml(args.environment));
    mkdirSync(wardenDir, { recursive: true });

    const configHash = sha256(defaultConfigYaml(args.environment));

    process.stdout.write(`
Warden initialized.

Config written: ${configPath}
State directory: ${wardenDir}
Environment: ${args.environment}
Config hash: ${configHash.slice(0, 16)}...

Next steps:
  1. Review and customize warden.config.yml
  2. Run 'warden config-validate' to check the schema
  3. Run 'warden start' to launch the hook server
`);
  },
});
