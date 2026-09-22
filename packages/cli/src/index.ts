#!/usr/bin/env node
import { defineCommand } from "citty";
import { initCommand } from "./commands/init.js";
import { auditCommand } from "./commands/audit.js";
import { policyCommand } from "./commands/policy.js";
import { scanCommand } from "./commands/scan.js";
import { supplyChainCommand } from "./commands/supply-chain.js";
import { startCommand } from "./commands/start.js";
import { configValidateCommand } from "./commands/config-validate.js";
import { resetCommand } from "./commands/reset.js";
import { proxyCommand } from "./commands/proxy.js";

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
    proxy: proxyCommand,
  },
});

export default main;
export { initCommand, auditCommand, policyCommand, scanCommand, supplyChainCommand };
