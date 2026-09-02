import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configValidateCommand } from "../src/commands/config-validate";

async function withTmpCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "warden-config-validate-test-"));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runConfigValidate(args: Record<string, unknown> = {}) {
  return configValidateCommand.run!({
    args: { config: "warden.config.yml", _: [], ...args },
    rawArgs: [],
    cmd: configValidateCommand,
  } as never);
}

const VALID_YAML = `
version: "2"
meta:
  environment: "development"
  sessionApprovalRequired: false
policies:
  - id: "block-shell-injection"
    description: "Block dangerous shell patterns"
    match:
      tool: "Bash"
      inputPatterns: ["rm\\\\s+-rf"]
    action: DENY
`;

const DUPLICATE_RULE_YAML = `
version: "2"
meta:
  environment: "development"
  sessionApprovalRequired: false
policies:
  - id: "dup-rule"
    description: "First"
    match:
      tools: ["read_file"]
    action: ALLOW
  - id: "dup-rule"
    description: "Second"
    match:
      tools: ["write_file"]
    action: DENY
`;

describe("configValidateCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports VALID and exits 0 for a well-formed config with no duplicate rule ids", async () => {
    await withTmpCwd(async (dir) => {
      writeFileSync(join(dir, "warden.config.yml"), VALID_YAML);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await expect(runConfigValidate()).rejects.toThrow("EXIT");

      expect(exitSpy).toHaveBeenCalledWith(0);
      const output = stdoutSpy.mock.calls.join("");
      expect(output).toContain("Status:      VALID");
      expect(output).toContain("Rules:       1");
      expect(output).toContain("block-shell-injection");
      expect(output).not.toContain("Duplicate rule IDs");
    });
  });

  it("warns on duplicate rule ids but does not fail validation", async () => {
    await withTmpCwd(async (dir) => {
      writeFileSync(join(dir, "warden.config.yml"), DUPLICATE_RULE_YAML);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await expect(runConfigValidate()).rejects.toThrow("EXIT");

      expect(exitSpy).toHaveBeenCalledWith(0);
      const output = stdoutSpy.mock.calls.join("");
      expect(output).toContain("WARNING: Duplicate rule IDs: dup-rule");
      expect(output).toContain("Status:      VALID");
    });
  });

  it("exits 1 and reports failure when the config file does not exist", async () => {
    await withTmpCwd(async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await expect(runConfigValidate({ config: "does-not-exist.yml" })).rejects.toThrow("EXIT");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(stderrSpy.mock.calls.join("")).toContain("Config validation FAILED");
    });
  });

  it("exits 1 and reports failure for malformed YAML", async () => {
    await withTmpCwd(async (dir) => {
      writeFileSync(
        join(dir, "warden.config.yml"),
        `version: "2"\nmeta:\n  environment: "development"\n   sessionApprovalRequired: false\npolicies: []\n`,
      );
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await expect(runConfigValidate()).rejects.toThrow("EXIT");

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it("does not call ConfigSource.verify (regression guard for the dead hash-check branch)", async () => {
    await withTmpCwd(async (dir) => {
      writeFileSync(join(dir, "warden.config.yml"), VALID_YAML);
      const { FileConfigSource } = await import("@stlw/warden");
      const verifySpy = vi.spyOn(FileConfigSource.prototype, "verify");
      vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await expect(runConfigValidate()).rejects.toThrow("EXIT");

      expect(verifySpy).not.toHaveBeenCalled();
    });
  });
});
