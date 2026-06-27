import { defineCommand } from "citty";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

export const resetCommand = defineCommand({
  meta: {
    name: "reset",
    description: "Reset Warden state — clear ledger and/or config",
  },
  args: {
    ledger: {
      type: "boolean",
      description: "Reset the SQLite ledger database",
      default: false,
    },
    all: {
      type: "boolean",
      description: "Reset all Warden state (ledger + config)",
      default: false,
    },
    db: {
      type: "string",
      description: "Path to ledger database",
      default: ".warden/ledger.db",
    },
  },
  async run({ args }) {
    const dbPath = resolve(args.db);
    let didSomething = false;

    if (args.ledger || args.all) {
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
        process.stdout.write(`Ledger reset: ${dbPath} deleted.\n`);
        didSomething = true;
      } else {
        process.stdout.write(`Ledger not found: ${dbPath} (nothing to reset)\n`);
      }
    }

    if (!didSomething) {
      process.stdout.write(`Usage: warden reset --ledger [--db <path>] | warden reset --all\n`);
    }
  },
});
