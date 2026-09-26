import { describe, expect, it } from "vitest";
import { runDemoScenarios } from "../src/console-phase-0.js";

describe("Console Phase 0 scenarios", () => {
  it("records allow, deny-wins, and approved confirmation in one valid ledger", async () => {
    const result = await runDemoScenarios({ databasePath: ":memory:" });

    expect(result.steps.map((step) => step.decision)).toEqual(["ALLOW", "DENY", "ALLOW"]);
    expect(result.steps[1]?.matchedRules).toEqual(["allow-write", "deny-untrusted-write"]);
    expect(result.steps[2]?.approval).toBe("approved");
    expect(result.chain).toEqual({ valid: true });
    expect(result.audit.entries).toHaveLength(3);
    expect(result.audit.entries.map((entry) => entry.decision)).toEqual(["ALLOW", "DENY", "ALLOW"]);
  });
});
