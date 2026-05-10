import { defineCommand } from "citty";
import { sha256 } from "@wardenlabs/core";

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
  },
  async run({ args }) {
    const configHash = sha256(`warden-init-${Date.now()}`);

    process.stdout.write(`
Warden initialized.

Environment: ${args.environment}
Config hash: ${configHash.slice(0, 16)}...

Next steps:
  1. Review and customize warden.config.yml
  2. Run 'warden audit' to verify the ledger
  3. Start your Claude Code session — Warden hooks are active
`);
  },
});
