import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "plugins/warden-claude");

describe("Warden Claude Code skill bundle", () => {
  it("ships a Claude Code manifest and a canonical-bound skill", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, ".claude-plugin/plugin.json"), "utf8"));
    const skill = readFileSync(resolve(root, "skills/warden/SKILL.md"), "utf8");

    expect(manifest).toMatchObject({ name: "warden-claude", version: "0.2.5" });
    expect(skill).toContain("docs/AGENT_SETUP.md");
    expect(skill).toContain("Node-only");
    expect(skill).toContain("native tools");
    expect(skill).not.toContain("hooks.json");
  });

  it("is listed by the repository marketplace", () => {
    const marketplace = JSON.parse(readFileSync(resolve(process.cwd(), ".claude-plugin/marketplace.json"), "utf8"));
    expect(marketplace.name).toBe("stalewell");
    expect(marketplace.plugins).toContainEqual(expect.objectContaining({
      name: "warden-claude",
      source: "./plugins/warden-claude",
    }));
  });
});
