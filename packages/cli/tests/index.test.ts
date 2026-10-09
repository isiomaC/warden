import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import main from "../src/index.js";

describe("warden CLI metadata", () => {
  it("exposes the package version for the --version flag", async () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "packages/cli/package.json"), "utf8")) as { version: string };
    const meta = typeof main.meta === "function" ? await main.meta() : await main.meta;
    expect(meta?.version).toBe(packageJson.version);
  });

  it("aligns all release packages and agent manifests to 0.2.8", () => {
    const version = "0.2.8";
    const packagePaths = [
      "packages/core/package.json",
      "packages/hook-server/package.json",
      "packages/mcp-gateway/package.json",
      "packages/cli/package.json",
      "packages/opencode-plugin/package.json",
    ];
    for (const path of packagePaths) {
      const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
      expect(packageJson.version, path).toBe(version);
      for (const [dependency, dependencyVersion] of Object.entries(packageJson.dependencies ?? {})) {
        if (dependency.startsWith("@stlw/warden")) expect(dependencyVersion, `${path}: ${dependency}`).toBe(`^${version}`);
      }
    }

    for (const path of [
      "plugins/warden-codex/plugin.json",
      "plugins/warden-codex/.codex-plugin/plugin.json",
      "plugins/warden-claude/.claude-plugin/plugin.json",
    ]) {
      expect(JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")).version, path).toBe(version);
    }

    for (const path of ["plugins/warden-codex/mcp.json", "plugins/warden-codex/.mcp.json"]) {
      const config = JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
      expect(config.mcpServers.warden.args).toContain(`@stlw/warden-cli@${version}`);
    }
  });
});
