import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runDemoScenarios } from "./console-phase-0.js";
import { toSideshowPost } from "./console-phase-0-presentation.js";
import { publishSideshowPost } from "./console-phase-0-sideshow.js";

export interface ConsoleDemoRun {
  directory: string;
  databasePath: string;
  auditPath: string;
  chain: { valid: boolean; brokenAt?: number };
  postId?: string;
}

export async function runConsoleDemo(options: {
  directory: string;
  sideshowUrl?: string;
}): Promise<ConsoleDemoRun> {
  const directory = resolve(options.directory);
  mkdirSync(directory, { recursive: true });
  const databasePath = join(directory, "warden-ledger.db");
  const auditPath = join(directory, "warden-audit.json");
  const result = await runDemoScenarios({ databasePath });
  if (!result.chain.valid) {
    throw new Error("Console Phase 0 demo produced an invalid ledger chain");
  }
  writeFileSync(auditPath, `${JSON.stringify({
    formatVersion: 1,
    chain: result.chain,
    entries: result.audit.entries,
    securityEvents: result.audit.securityEvents,
  }, null, 2)}\n`, "utf8");

  const postId = options.sideshowUrl
    ? (await publishSideshowPost(options.sideshowUrl, toSideshowPost(result))).id
    : undefined;
  return { directory, databasePath, auditPath, chain: result.chain, ...(postId ? { postId } : {}) };
}
