import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetCommand } from "../src/commands/reset";

async function withTmpCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "warden-reset-test-"));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runReset(args: Record<string, unknown> = {}) {
  return resetCommand.run!({
    args: { ledger: false, all: false, db: ".warden/ledger.db", _: [], ...args },
    rawArgs: [],
    cmd: resetCommand,
  } as never);
}

describe("resetCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints usage and touches nothing when neither --ledger nor --all is passed", async () => {
    await withTmpCwd(async (dir) => {
      mkdirSync(join(dir, ".warden"), { recursive: true });
      writeFileSync(join(dir, ".warden/ledger.db"), "fake-db");
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runReset();

      expect(stdoutSpy.mock.calls.join("")).toContain("Usage: warden reset");
      expect(existsSync(join(dir, ".warden/ledger.db"))).toBe(true);
    });
  });

  it("--ledger deletes the ledger db and reports it, without an extra usage line", async () => {
    await withTmpCwd(async (dir) => {
      mkdirSync(join(dir, ".warden"), { recursive: true });
      writeFileSync(join(dir, ".warden/ledger.db"), "fake-db");
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runReset({ ledger: true });

      expect(existsSync(join(dir, ".warden/ledger.db"))).toBe(false);
      const output = stdoutSpy.mock.calls.join("");
      expect(output).toContain("Ledger reset");
      expect(output).toContain("deleted");
      expect(output).not.toContain("Usage: warden reset");
    });
  });

  it("--ledger on a missing db reports nothing-to-reset, not a crash", async () => {
    await withTmpCwd(async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runReset({ ledger: true });

      expect(stdoutSpy.mock.calls.join("")).toContain("Ledger not found");
    });
  });

  it("--all resets the ledger and both pin files, but leaves warden.config.yml untouched", async () => {
    await withTmpCwd(async (dir) => {
      mkdirSync(join(dir, ".warden"), { recursive: true });
      writeFileSync(join(dir, ".warden/ledger.db"), "fake-db");
      writeFileSync(join(dir, ".warden/pins.json"), "{}");
      writeFileSync(join(dir, ".warden/supply-chain-pins.json"), "{}");
      writeFileSync(join(dir, "warden.config.yml"), "version: \"2\"\n");
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runReset({ all: true });

      expect(existsSync(join(dir, ".warden/ledger.db"))).toBe(false);
      expect(existsSync(join(dir, ".warden/pins.json"))).toBe(false);
      expect(existsSync(join(dir, ".warden/supply-chain-pins.json"))).toBe(false);
      expect(existsSync(join(dir, "warden.config.yml"))).toBe(true);

      const output = stdoutSpy.mock.calls.join("");
      expect(output).toContain("Ledger reset");
      expect(output).toContain("Tool pins reset");
      expect(output).toContain("Supply-chain pins reset");
    });
  });

  it("--db points reset at a custom ledger path", async () => {
    await withTmpCwd(async (dir) => {
      writeFileSync(join(dir, "custom-ledger.db"), "fake-db");
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runReset({ ledger: true, db: "custom-ledger.db" });

      expect(existsSync(join(dir, "custom-ledger.db"))).toBe(false);
    });
  });
});
