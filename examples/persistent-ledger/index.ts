/**
 * Warden Persistent Ledger Example
 *
 * Demonstrates SqliteLedgerStore — same hash-chained ledger interface
 * as MemoryLedgerStore, but survives process restarts.
 *
 * Run: npx tsx examples/persistent-ledger/index.ts
 * Run twice to see persistence across restarts.
 */

import { SqliteLedgerStore, MemoryLedgerStore, TrustLevel } from "@warden/core";
import { existsSync, unlinkSync } from "node:fs";

const DB_PATH = ".warden/example-ledger.db";

// Clean start for demo
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

console.log("=== Warden Persistent Ledger (SQLite) ===\n");

// ---- Compare Memory vs SQLite ----
console.log("1. Starting hash chain");

const memLedger = new MemoryLedgerStore();
console.log(`   Memory ledger initial hash: ${memLedger.lastHash().slice(0, 16)}...`);

const sqlLedger = new SqliteLedgerStore(DB_PATH);
console.log(`   SQLite ledger initial hash: ${sqlLedger.lastHash().slice(0, 16)}...`);

// ---- Write entries to both ----
console.log("\n2. Writing 3 tool calls to both ledgers\n");

const tools = ["read_file", "list_directory", "write_file"];
for (let i = 0; i < tools.length; i++) {
  const entry = (ledger: MemoryLedgerStore | SqliteLedgerStore, idx: number) => ({
    id: `entry_${idx}`,
    previousHash: ledger.lastHash(),
    timestamp: new Date().toISOString(),
    sessionId: "session-demo",
    taskId: "task-demo",
    tool: tools[idx],
    toolInput: { path: `/tmp/file-${idx}.txt` },
    trustLevel: TrustLevel.TOOL,
    trustSource: `mcp__filesystem__${tools[idx]}`,
    policyRulesMatched: ["allow-reads"],
    decision: "ALLOW" as const,
    decisionReason: "Policy: allow-reads matched",
    hash: "",
    previousEntryHash: ledger.lastHash(),
  });

  memLedger.write(entry(memLedger, i));
  sqlLedger.write(entry(sqlLedger, i));

  console.log(`   Entry ${i + 1}: ${tools[i]} → hash=${sqlLedger.lastHash().slice(0, 16)}...`);
}

// ---- Verify both chains ----
console.log("\n3. Chain verification\n");

const memChain = memLedger.verifyChain();
const sqlChain = sqlLedger.verifyChain();

console.log(`   Memory ledger: ${memChain.valid ? "✅ VALID" : "❌ BROKEN"}`);
console.log(`   SQLite ledger: ${sqlChain.valid ? "✅ VALID" : "❌ BROKEN"}`);

// ---- Demonstrate persistence ----
console.log("\n4. Close and reopen SQLite ledger\n");

const entriesBeforeClose = sqlLedger.getEntries().length;
console.log(`   Entries before close: ${entriesBeforeClose}`);
sqlLedger.close();

// Reopen from disk
const reopened = new SqliteLedgerStore(DB_PATH);
const entriesAfterOpen = reopened.getEntries().length;
console.log(`   Entries after reopen: ${entriesAfterOpen}`);

const reopenedChain = reopened.verifyChain();
console.log(`   Chain after reopen: ${reopenedChain.valid ? "✅ VALID" : "❌ BROKEN"} (${reopenedChain.valid ? "state preserved" : "chain corrupted"})`);

reopened.close();

// ---- Tamper detection demo ----
console.log("\n5. Tamper detection\n");

const freshLedger = new SqliteLedgerStore(DB_PATH + ".tamper");
freshLedger.write({
  id: "entry_0",
  previousHash: freshLedger.lastHash(),
  timestamp: new Date().toISOString(),
  sessionId: "tamper-session",
  taskId: "task-demo",
  tool: "read_file",
  toolInput: { path: "/tmp/secret.txt" },
  trustLevel: TrustLevel.TOOL,
  trustSource: "mcp__read_file",
  policyRulesMatched: ["allow-reads"],
  decision: "ALLOW",
  decisionReason: "test",
  hash: "",
  previousEntryHash: freshLedger.lastHash(),
});
const beforeTamper = freshLedger.verifyChain();
console.log(`   Before tamper: ${beforeTamper.valid ? "✅ VALID" : "❌ BROKEN"}`);

// Tamper: modify a hash directly in SQLite
const db = freshLedger["db" as keyof typeof freshLedger] as { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
try {
  db.prepare("UPDATE ledger_entries SET hash = ? WHERE id = ?").run("cafebabe".repeat(8), "entry_0");
  const afterTamper = freshLedger.verifyChain();
  console.log(`   After tamper:  ${afterTamper.brokenAt !== undefined ? "❌ BROKEN at entry " + afterTamper.brokenAt : "✅ VALID"}`);
} catch {
  console.log("   (Tamper test skipped — DB access unavailable)");
}

freshLedger.close();

// Cleanup
try { unlinkSync(DB_PATH); } catch { /* ok */ }
try { unlinkSync(DB_PATH + ".tamper"); } catch { /* ok */ }

console.log(`\n   Memory ledger loses data on restart. SQLite persists across restarts.`);
console.log(`   Same hash chain. Same interface. Swappable at startup.`);
