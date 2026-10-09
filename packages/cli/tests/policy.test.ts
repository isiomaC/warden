import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { policyCommand } from "../src/commands/policy";

async function runPolicy(args: Record<string, unknown>) {
  return policyCommand.run!({
    args: { trust: "TOOL", environment: "development", _: [], ...args },
    rawArgs: [],
    cmd: policyCommand,
  } as never);
}

describe("policyCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("DENYs a write in production", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runPolicy({ tool: "write_file", trust: "SYSTEM", environment: "production" });

    const output = stdoutSpy.mock.calls.join("");
    expect(output).toContain("Decision: DENY");
    expect(output).toContain("block-prod-writes");
  });

  it("ALLOWs a read in staging with SYSTEM trust", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runPolicy({ tool: "read_file", trust: "SYSTEM", environment: "staging" });

    const output = stdoutSpy.mock.calls.join("");
    expect(output).toContain("Decision: ALLOW");
    expect(output).toContain("allow-read-staging");
  });

  it("CONFIRMs a destructive operation", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runPolicy({ tool: "delete_file", trust: "AGENT", environment: "development" });

    const output = stdoutSpy.mock.calls.join("");
    expect(output).toContain("Decision: CONFIRM");
    expect(output).toContain("confirm-destructive");
  });

  it("QUARANTINEs external content flowing into a write", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runPolicy({ tool: "write_file", trust: "EXTERNAL", environment: "development" });

    const output = stdoutSpy.mock.calls.join("");
    expect(output).toContain("Decision: QUARANTINE");
    expect(output).toContain("quarantine-external-to-write");
  });

  it("default-DENYs a tool with no matching rule", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runPolicy({ tool: "some_unlisted_tool", trust: "SYSTEM", environment: "development" });

    const output = stdoutSpy.mock.calls.join("");
    expect(output).toContain("Decision: DENY");
    expect(output).toContain("No matching policy rule");
  });

  it("rejects an invalid --trust instead of silently falling back to TOOL", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runPolicy({ tool: "write_file", trust: "BOGUS", environment: "production" }),
    ).rejects.toThrow("EXIT");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy.mock.calls.join("")).toContain('invalid --trust "BOGUS"');
    // Must not have gone on to print a (misleadingly enforced-as-TOOL) decision.
    expect(stdoutSpy.mock.calls.join("")).not.toContain("Decision:");
  });

  it("accepts --trust case-insensitively", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runPolicy({ tool: "write_file", trust: "system", environment: "production" });

    const output = stdoutSpy.mock.calls.join("");
    expect(output).toContain("Decision: DENY");
  });

  describe("with a project config", () => {
    const dir = mkdtempSync(join(tmpdir(), "warden-cli-policy-"));
    const config = join(dir, "warden.config.yml");
    writeFileSync(config, `version: "2"
meta:
  environment: "development"
  sessionApprovalRequired: false
policies:
  - id: "block-shell-injection"
    description: "Block dangerous shell patterns"
    match:
      tool: "Bash"
      inputPatterns:
        - "rm\\s+-rf"
    action: DENY
  - id: "allow-reads"
    description: "Allow reads"
    match:
      tools: ["read_file"]
    action: ALLOW
`);

    it("evaluates the project's rules, not the built-in demo", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runPolicy({ tool: "read_file", config });

      const output = stdoutSpy.mock.calls.join("");
      expect(output).toContain("Decision: ALLOW");
      expect(output).toContain("allow-reads");
    });

    it("matches input patterns from --input", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runPolicy({ tool: "Bash", config, input: '{"command":"rm -rf /"}' });

      const output = stdoutSpy.mock.calls.join("");
      expect(output).toContain("Decision: DENY");
      expect(output).toContain("block-shell-injection");
    });

    it("rejects a non-object --input", async () => {
      vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await expect(runPolicy({ tool: "Bash", config, input: "[1]" })).rejects.toThrow("EXIT");
      expect(stderrSpy.mock.calls.join("")).toContain("invalid --input");
    });
  });
});
