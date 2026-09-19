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
    expect(server.args).toContain("@stlw/warden-cli@0.2.2");
  });

  it("uses the fail-closed adapter for PreToolUse", () => {
    const hook = readJson("hooks/hooks.json").hooks.PreToolUse[0].hooks[0];
    expect(hook).toMatchObject({ type: "command", timeout: 30 });
    expect(hook.command).toContain("codex-hook-adapter.mjs");
  });
});
