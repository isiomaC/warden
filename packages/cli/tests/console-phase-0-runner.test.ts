import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runConsoleDemo } from "../src/console-phase-0-runner.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Console Phase 0 runner", () => {
  it("writes real SQLite and JSON audit evidence into its explicit demo directory", async () => {
    const directory = mkdtempSync(join(tmpdir(), "warden-console-phase-0-test-"));
    directories.push(directory);

    const result = await runConsoleDemo({ directory });

    expect(result.chain).toEqual({ valid: true });
    expect(existsSync(result.databasePath)).toBe(true);
    expect(existsSync(result.auditPath)).toBe(true);
    expect(JSON.parse(readFileSync(result.auditPath, "utf8"))).toMatchObject({
      formatVersion: 1,
      chain: { valid: true },
    });
  });
});
