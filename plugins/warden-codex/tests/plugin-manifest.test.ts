import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "plugins/warden-codex");
const readJson = (file: string) => JSON.parse(readFileSync(resolve(root, file), "utf8"));

describe("Warden Codex plugin bundle", () => {
  it("has portable and Codex compatibility manifests", () => {
    expect(readJson("plugin.json").name).toBe("warden-codex");
    expect(readJson(".codex-plugin/plugin.json").name).toBe("warden-codex");
  });

  it("declares a version-pinned Warden proxy", () => {
    const server = readJson("mcp.json").mcpServers.warden;
    expect(server).toMatchObject({ type: "stdio", command: "npx" });
    expect(server.args).toContain("@stlw/warden-cli@0.2.4");
  });

  it("does not claim unsupported native Codex hook enforcement", () => {
    expect(readJson("plugin.json").extensions).toBeUndefined();
    expect(readJson(".codex-plugin/plugin.json").hooks).toBeUndefined();
    expect(readJson(".codex-plugin/plugin.json").interface.longDescription).toContain("MCP tools");
    expect(readJson(".codex-plugin/plugin.json").interface.longDescription).not.toContain("Codex tools and MCP servers");
    expect(readFileSync(resolve(root, "skills/warden-policy/SKILL.md"), "utf8")).not.toContain("warden start");
  });
});
