import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Warden OpenCode skill", () => {
  it("uses OpenCode's documented project skill path and preserves enforcement boundaries", () => {
    const skill = readFileSync(resolve(process.cwd(), ".opencode/skills/warden/SKILL.md"), "utf8");

    expect(skill).toContain("name: warden");
    expect(skill).toContain("description:");
    expect(skill).toContain("docs/AGENT_SETUP.md");
    expect(skill).toContain("native tools");
    expect(skill).not.toContain("opencode.json");
  });
});
