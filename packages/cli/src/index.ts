#!/usr/bin/env node
import { defineCommand } from "citty";
import { initCommand } from "./commands/init";
import { auditCommand } from "./commands/audit";
import { policyCommand } from "./commands/policy";
import { scanCommand } from "./commands/scan";
import { supplyChainCommand } from "./commands/supply-chain";
import { startCommand } from "./commands/start";
import { configValidateCommand } from "./commands/config-validate";
import { resetCommand } from "./commands/reset";

const main = defineCommand({
  meta: {
    name: "warden",
    description: "Warden — Security layer for MCP-connected AI agents",
  },
  subCommands: {
    init: initCommand,
    start: startCommand,
    audit: auditCommand,
    policy: policyCommand,
    scan: scanCommand,
    "supply-chain": supplyChainCommand,
    "config-validate": configValidateCommand,
    reset: resetCommand,
  },
});

export default main;
export { initCommand, auditCommand, policyCommand, scanCommand, supplyChainCommand };
