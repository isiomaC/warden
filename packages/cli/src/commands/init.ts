import { defineCommand } from "citty";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "@stlw/warden";

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
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem@1.0.0", "."]
      allowedTools: ["read_file", "list_directory", "write_file"]
      authRequired: false

policies:
  - id: "block-shell-injection"
    description: "Block dangerous shell patterns"
    match:
      tool: "Bash"
      inputPatterns:
        - "rm\\s+-rf"
        - "curl.*\\|.*sh"
        - "eval\\s*\\("
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

    const envPath = resolve(".env");
    const generatedToken = randomBytes(32).toString("hex");
    if (existsSync(envPath)) {
      const envContents = readFileSync(envPath, "utf-8");
      if (!/^\s*WARDEN_AUTH_TOKEN\s*=\s*\S+/m.test(envContents)) {
        const assignment = /^\s*WARDEN_AUTH_TOKEN\s*=.*$/m;
        const updated = assignment.test(envContents)
          ? envContents.replace(assignment, `WARDEN_AUTH_TOKEN=${generatedToken}`)
          : `${envContents}${envContents.endsWith("\n") || envContents.length === 0 ? "" : "\n"}WARDEN_AUTH_TOKEN=${generatedToken}\n`;
        writeFileSync(envPath, updated);
      }
      chmodSync(envPath, 0o600);
    } else {
      writeFileSync(envPath, `WARDEN_AUTH_TOKEN=${generatedToken}\n`, { mode: 0o600 });
    }

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
     (the generated shared secret is stored in .env)
`);
  },
});
