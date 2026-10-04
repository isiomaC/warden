import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("published agent enforcement guidance", () => {
  it("maps agent use cases to verified and unsupported Warden paths", () => {
    const setup = read("docs/AGENT_SETUP.md");

    expect(setup).toContain("## Agent capability matrix");
    expect(setup).toContain("Codex CLI");
    expect(setup).toContain("plugin MCP process does not start");
    expect(setup).toContain("project-level MCP configuration");
    expect(setup).toContain("Claude Code");
    expect(setup).toContain("Native HTTP hooks are not outage-safe");
    expect(setup).toContain("OpenCode");
    expect(setup).toContain("Native tool enforcement");
    expect(setup).toContain("MCP tools");
  });

  it("states Claude Code proxy-only support and removes native hook fail-closed claims", () => {
    const readme = read("README.md");
    const manual = read("docs/MANUAL.md");
    const setup = read("docs/AGENT_SETUP.md");
    const testing = read("docs/TESTING.md");
    const claudeExample = read("examples/claude-code-basic/README.md");
    const hookServerReadme = read("packages/hook-server/README.md");
    const hookServerPackage = JSON.parse(read("packages/hook-server/package.json"));
    const startCommand = read("packages/cli/src/commands/start.ts");
    const codexSkill = read("plugins/warden-codex/skills/warden-policy/SKILL.md");
    const coreReadme = read("packages/core/README.md");
    const hookExample = read("examples/hook-server/index.ts");

    expect(readme).toContain("Native HTTP-hook enforcement is unsupported");
    expect(manual).toContain("native HTTP-hook integration is not a supported security path");
    expect(setup).toContain("hooks are not a supported security integration");
    expect(readme).not.toContain("Hook server is down | All tool calls blocked");
    expect(readme).not.toContain("If Warden is down, **all tool calls are blocked**");
    expect(readme).not.toContain("Using Claude Code → `warden start`");
    expect(manual).not.toContain("Add to `.claude/settings.local.json`");
    expect(readme).not.toContain("All six hooks normally");
    expect(readme).not.toContain("tui.prompt.append");
    expect(readme).not.toContain("permission.asked");
    expect(readme).toContain("`chat.message`");
    expect(readme).toContain("`permission.ask`");
    expect(testing).not.toContain("Claude Code hook contract");
    expect(testing).not.toContain("mimic Claude Code hook events");
    expect(testing).not.toContain("Real LLM making tool calls through Warden hooks");
    expect(testing).not.toContain("real `claude` CLI session");
    expect(claudeExample).toContain("Claude Code: MCP proxy");
    expect(claudeExample).not.toContain("Claude Code hook registrations");
    expect(hookServerReadme).not.toContain("For Claude Code, point its HTTP hooks");
    expect(hookServerReadme).toContain("Claude Code's native HTTP hooks are not supported for native-tool enforcement");
    expect(hookServerPackage.description).not.toContain("Claude Code");
    expect(startCommand).not.toContain("hook server for Claude Code integration");
    expect(coreReadme).not.toContain("for Claude Code, Codex CLI, or Copilot SDK HTTP hooks");
    expect(hookExample).not.toContain("full Claude Code hook server");
    expect(existsSync(resolve(process.cwd(), "examples/claude-code-basic/.claude/settings.json"))).toBe(false);
    expect(readme).toContain("Plugin MCP registration unverified");
    expect(readme).not.toContain("Bundled `warden-codex` plugin | MCP proxy verified");
    expect(readme).toContain("does not start its bundled MCP process");
    expect(readme).toContain("[mcp_servers.warden]");
    expect(codexSkill).not.toContain("It contributes Warden's stdio MCP proxy");
    expect(codexSkill).toContain("does not start the plugin-bundled MCP process");
  });
});
