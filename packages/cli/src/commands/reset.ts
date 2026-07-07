import { defineCommand } from "citty";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

function resetFile(path: string, label: string): void {
  if (existsSync(path)) {
    unlinkSync(path);
    process.stdout.write(`${label} reset: ${path} deleted.\n`);
  } else {
    process.stdout.write(`${label} not found: ${path} (nothing to reset)\n`);
  }
}

export const resetCommand = defineCommand({
  meta: {
    name: "reset",
    description: "Reset Warden state — clear the ledger and/or supply-chain/tool pins",
  },
  args: {
    ledger: {
      type: "boolean",
      description: "Reset the SQLite ledger database",
      default: false,
    },
    all: {
      type: "boolean",
      description: "Reset all Warden state (ledger + pins). Does not touch warden.config.yml.",
      default: false,
    },
    db: {
      type: "string",
      description: "Path to ledger database",
      default: ".warden/ledger.db",
    },
  },
  async run({ args }) {
    const requested = args.ledger || args.all;

    if (!requested) {
      process.stdout.write(`Usage: warden reset --ledger [--db <path>] | warden reset --all\n`);
      return;
    }

    resetFile(resolve(args.db), "Ledger");

    if (args.all) {
      resetFile(resolve(".warden/pins.json"), "Tool pins");
      resetFile(resolve(".warden/supply-chain-pins.json"), "Supply-chain pins");
    }
  },
});
