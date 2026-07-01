import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand } from "../src/commands/init";
import { FileConfigSource } from "@warden/core";

async function withTmpCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "warden-init-test-"));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("initCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates warden.config.yml and .warden/ in the current directory", async () => {
    await withTmpCwd(async (dir) => {
      await initCommand.run!({
        args: { environment: "development", force: false, _: [] },
        rawArgs: [],
        cmd: initCommand,
      } as never);

      expect(existsSync(join(dir, "warden.config.yml"))).toBe(true);
      expect(existsSync(join(dir, ".warden"))).toBe(true);
    });
  });

  it("writes a config that the real YAML parser loads with a populated policies array", async () => {
    await withTmpCwd(async (dir) => {
      await initCommand.run!({
        args: { environment: "production", force: false, _: [] },
        rawArgs: [],
        cmd: initCommand,
      } as never);

      const source = new FileConfigSource(join(dir, "warden.config.yml"));
      const config = await source.load();

      expect(config.version).toBe("2");
      expect(config.meta.environment).toBe("production");
      expect(Array.isArray(config.policies)).toBe(true);
      expect(config.policies.length).toBeGreaterThan(0);
      expect(config.policies.map((p) => p.id)).toContain("block-shell-injection");
    });
  });

  it("rejects an invalid --environment", async () => {
    await withTmpCwd(async (dir) => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await expect(
        initCommand.run!({
          args: { environment: "bogus", force: false, _: [] },
          rawArgs: [],
          cmd: initCommand,
        } as never),
      ).rejects.toThrow("EXIT");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(stderrSpy.mock.calls.join("")).toContain("Invalid environment");
      expect(existsSync(join(dir, "warden.config.yml"))).toBe(false);
    });
  });

  it("refuses to overwrite an existing warden.config.yml without --force", async () => {
    await withTmpCwd(async (dir) => {
      await initCommand.run!({
        args: { environment: "development", force: false, _: [] },
        rawArgs: [],
        cmd: initCommand,
      } as never);

      const original = readFileSync(join(dir, "warden.config.yml"), "utf-8");

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await expect(
        initCommand.run!({
          args: { environment: "staging", force: false, _: [] },
          rawArgs: [],
          cmd: initCommand,
        } as never),
      ).rejects.toThrow("EXIT");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(readFileSync(join(dir, "warden.config.yml"), "utf-8")).toBe(original);
    });
  });

  it("overwrites an existing config when --force is set", async () => {
    await withTmpCwd(async (dir) => {
      await initCommand.run!({
        args: { environment: "development", force: false, _: [] },
        rawArgs: [],
        cmd: initCommand,
      } as never);

      await initCommand.run!({
        args: { environment: "staging", force: true, _: [] },
        rawArgs: [],
        cmd: initCommand,
      } as never);

      const content = readFileSync(join(dir, "warden.config.yml"), "utf-8");
      expect(content).toContain('environment: "staging"');
    });
  });
});
