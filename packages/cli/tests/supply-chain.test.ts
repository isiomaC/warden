import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supplyChainCommand } from "../src/commands/supply-chain";

async function withTmpCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "warden-supply-chain-test-"));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

const FAKE_LOCKFILE = {
  name: "fixture-project",
  lockfileVersion: 3,
  packages: {
    "": { name: "fixture-project", version: "1.0.0" },
    "node_modules/left-pad": {
      version: "1.3.0",
      integrity: "sha512-real-left-pad-hash",
    },
    "node_modules/local-workspace-pkg": {
      version: "0.0.0",
    },
  },
};

async function runSupplyChain(args: Record<string, unknown>) {
  return supplyChainCommand.run!({
    args: { lockfile: "package-lock.json", pins: ".warden/supply-chain-pins.json", baseline: false, _: [], ...args },
    rawArgs: [],
    cmd: supplyChainCommand,
  } as never);
}

describe("supplyChainCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the real package-lock.json instead of fabricated dependencies", async () => {
    await withTmpCwd(async (dir) => {
      writeFileSync(join(dir, "package-lock.json"), JSON.stringify(FAKE_LOCKFILE, null, 2));
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      // No pin file exists yet, so the real left-pad dependency is reported UNPINNED.
      await expect(runSupplyChain({})).rejects.toThrow("EXIT");
      expect(exitSpy).toHaveBeenCalledWith(1);

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("Packages checked: 1");
      expect(output).toContain("UNPINNED");
      expect(output).toContain("left-pad");
      expect(output).not.toContain("better-sqlite3");
    });
  });

  it("exits 1 when the lockfile is missing", async () => {
    await withTmpCwd(async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await expect(runSupplyChain({})).rejects.toThrow("EXIT");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it("--baseline writes a real pin file derived from the lockfile", async () => {
    await withTmpCwd(async (dir) => {
      writeFileSync(join(dir, "package-lock.json"), JSON.stringify(FAKE_LOCKFILE, null, 2));
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runSupplyChain({ baseline: true });

      const pinsPath = join(dir, ".warden/supply-chain-pins.json");
      expect(existsSync(pinsPath)).toBe(true);
      const pins = JSON.parse(readFileSync(pinsPath, "utf-8"));
      expect(pins["left-pad"].version).toBe("1.3.0");
      expect(pins["left-pad"].integrity).toBe("sha512-real-left-pad-hash");
    });
  });

  it("reports a violation when the lockfile diverges from the pinned baseline", async () => {
    await withTmpCwd(async (dir) => {
      writeFileSync(join(dir, "package-lock.json"), JSON.stringify(FAKE_LOCKFILE, null, 2));
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      await runSupplyChain({ baseline: true });

      const tampered = JSON.parse(JSON.stringify(FAKE_LOCKFILE));
      tampered.packages["node_modules/left-pad"].integrity = "sha512-tampered-hash";
      writeFileSync(join(dir, "package-lock.json"), JSON.stringify(tampered, null, 2));

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await expect(runSupplyChain({})).rejects.toThrow("EXIT");

      expect(exitSpy).toHaveBeenCalledWith(1);
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("VIOLATIONS FOUND");
    });
  });
});
