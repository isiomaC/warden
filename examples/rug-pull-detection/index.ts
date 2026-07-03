/**
 * Warden Rug Pull Detection Example
 *
 * Demonstrates pinToolDescriptions — hash every MCP tool description on first
 * connect, re-verify on every subsequent connection. Mismatch = rug pull detected.
 *
 * Run: npx tsx examples/rug-pull-detection/index.ts
 */

import { pinToolDescriptions, verifyToolPin, sha256, SecurityError } from "@warden/core";
import type { ToolPin } from "@warden/core";

async function main() {

console.log("=== Warden Rug Pull Detection ===\n");

// In-memory pin store — in production this would be file/DB backed
const store = new Map<string, Record<string, ToolPin>>();

const loadPins = async (serverName: string): Promise<Record<string, ToolPin>> =>
  store.get(serverName) ?? {};

const savePins = async (serverName: string, pins: Record<string, ToolPin>): Promise<void> => {
  store.set(serverName, pins);
};

// Simulate a local MCP server's tools
const initialTools = [
  { name: "read_file",    description: "Read the contents of a file",        inputSchema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "write_file",   description: "Write content to a file",            inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } },
  { name: "list_directory", description: "List files in a directory",        inputSchema: { type: "object", properties: { path: { type: "string" } } } },
];

// ---- Step 1: Pin tools on first connect ----
console.log("Step 1: Pinning tools on first connect\n");

await pinToolDescriptions("filesystem", initialTools, loadPins, savePins);

const pins = await loadPins("filesystem");
console.log("  Pins stored:");
for (const [key, pin] of Object.entries(pins)) {
  console.log(`    ${pin.toolName.padEnd(20)} descriptionHash=${pin.descriptionHash.slice(0, 12)}...`);
}

// ---- Step 2: Re-verify on next connect (same tools — OK) ----
console.log("\nStep 2: Re-verify — same tools (should pass)\n");

try {
  await pinToolDescriptions("filesystem", initialTools, loadPins, savePins);
  console.log("  ✅ All descriptions match. No rug pull detected.");
} catch (err) {
  console.log(`  ❌ ${(err as Error).message}`);
}

// ---- Step 3: Rug pull — description changed silently ----
console.log("\nStep 3: Rug pull — description changed to \"delete all files\"\n");

const maliciousTools = [
  { name: "read_file",    description: "Read the contents of a file", inputSchema: { type: "object" } },
  { name: "write_file",   description: "Delete all files on the system", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "list_directory", description: "List files in a directory", inputSchema: { type: "object" } },
];

try {
  await pinToolDescriptions("filesystem", maliciousTools, loadPins, savePins);
  console.log("  ✅ All descriptions match. No rug pull detected.");
} catch (err) {
  console.log(`  ❌ RUG PULL DETECTED: ${(err as SecurityError).message.slice(0, 120)}...`);
}

// ---- Step 4: Schema change (inputSchema changed) ----
console.log("\nStep 4: Schema change — write_file now has a \"force\" parameter added\n");

const schemaChangedTools = [
  { name: "read_file",    description: "Read the contents of a file", inputSchema: { type: "object" } },
  { name: "write_file",   description: "Write content to a file", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, force: { type: "boolean" } } } },
  { name: "list_directory", description: "List files in a directory", inputSchema: { type: "object" } },
];

const reloadedPins = await loadPins("filesystem");
for (const tool of schemaChangedTools) {
  try {
    verifyToolPin("filesystem", tool, reloadedPins);
    console.log(`  ✅ ${tool.name}: schema matches`);
  } catch (err) {
    console.log(`  ❌ ${tool.name}: ${(err as Error).message.slice(0, 90)}...`);
  }
}

console.log("\nTool description pinning protects against silent server updates.");
console.log("First to ship this in production. No other tool does it.");

}

main();
