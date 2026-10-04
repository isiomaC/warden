import { FileLedgerStore } from "@stlw/warden";
import type { LedgerStore } from "@stlw/warden";
import { resolve } from "node:path";

export function createPluginLedger(projectDir: string): LedgerStore {
  return new FileLedgerStore(resolve(projectDir, ".warden/opencode-ledger.jsonl"));
}
