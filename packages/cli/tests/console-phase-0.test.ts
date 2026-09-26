import { describe, expect, it } from "vitest";
import { runDemoScenarios } from "../src/console-phase-0.js";
import { toSideshowPost } from "../src/console-phase-0-presentation.js";

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

  it("renders completed decisions, chain status, and audit evidence for Sideshow", async () => {
    const result = await runDemoScenarios({ databasePath: ":memory:" });
    const post = toSideshowPost(result);

    expect(post.title).toBe("Warden Console Phase 0");
    expect(post.surfaces.map((surface) => surface.kind)).toEqual(["markdown", "json", "json"]);
    expect(JSON.stringify(post)).toContain("Deny wins");
    expect(JSON.stringify(post)).toContain("native tools");
    expect(JSON.stringify(post)).toContain("audit");
  });
});
