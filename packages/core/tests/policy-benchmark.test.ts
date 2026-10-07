import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { TrustLevel } from "../src/trust";
import { parsePolicyPackCases, runPolicyPackCases } from "../../../benchmarks/warden-policy/runner.js";
import type { PolicyPackCase, PolicyPackMetadata } from "../../../benchmarks/warden-policy/runner.js";

const metadata: PolicyPackMetadata = {
  packId: "warden-policy-pack",
  version: "0.1.0",
  splitId: "smoke",
  source: { repository: "https://github.com/isiomaC/warden", revision: "daa6cf530b68ccb99fdc521616795cb9fc2883ed" },
  license: { id: "MIT", attribution: "Warden contributors" },
  scorer: { id: "warden-policy-action-accuracy", version: "1.0.0" },
};

function testCase(id: string, expectedAction: PolicyPackCase["expectedAction"], action: string, policyAction: PolicyPackCase["expectedAction"] = expectedAction): PolicyPackCase {
  return {
    id,
    description: id,
    expectedAction,
    policy: { version: "2", meta: { environment: "development", sessionApprovalRequired: false }, policies: [{ id: "rule", description: id, match: { tools: ["read_file"] }, action: policyAction }] },
    input: { toolName: action, toolInput: {}, environment: "development", trustSources: [{ source: "system_prompt", trust: TrustLevel.SYSTEM }], serverInAllowlist: true },
  };
}

function configuredCase(id: string, expectedAction: PolicyPackCase["expectedAction"], policy: PolicyPackCase["policy"], input: PolicyPackCase["input"]): PolicyPackCase {
  return { id, description: id, expectedAction, policy, input };
}

describe("Warden policy benchmark runner", () => {
  it("reports deterministic action accuracy and preserves case order", () => {
    const cases = [testCase("allowed", "ALLOW", "read_file"), testCase("mismatch", "ALLOW", "write_file", "DENY")];
    const first = runPolicyPackCases(cases, metadata);
    expect(first).toEqual(runPolicyPackCases(cases, metadata));
    expect(first.summary).toEqual({ totalCases: 2, passedCases: 1, actionAccuracy: 0.5 });
    expect(first.results).toEqual([
      { id: "allowed", expectedAction: "ALLOW", actualAction: "ALLOW", passed: true },
      { id: "mismatch", expectedAction: "ALLOW", actualAction: "DENY", passed: false },
    ]);
  });

  it("parses strict JSONL cases and rejects duplicate IDs or unsupported actions", () => {
    const valid = testCase("one", "ALLOW", "read_file");
    expect(parsePolicyPackCases(`${JSON.stringify(valid)}\n`)).toEqual([valid]);
    expect(() => parsePolicyPackCases(`${JSON.stringify(valid)}\n${JSON.stringify(valid)}`)).toThrow(/duplicate.*id/i);
    expect(() => parsePolicyPackCases(JSON.stringify({ ...valid, expectedAction: "EXECUTE" }))).toThrow(/expectedAction/i);
    expect(() => parsePolicyPackCases(JSON.stringify({ ...valid, surprise: true }))).toThrow(/unknown|unexpected/i);
  });

  it("covers allow, deny precedence, confirmation, quarantine, match conditions, allowlist, and default deny", () => {
    const input = (toolName: string, environment = "development", trust: 0 | 1 | 2 | 3 = TrustLevel.SYSTEM, serverInAllowlist = true, toolInput: Record<string, unknown> = {}) => ({ toolName, toolInput, environment, trustSources: [{ source: "system_prompt", trust }], serverInAllowlist });
    const config = (policies: PolicyPackCase["policy"]["policies"]): PolicyPackCase["policy"] => ({ version: "2", meta: { environment: "development", sessionApprovalRequired: false }, policies });
    const cases: PolicyPackCase[] = [
      configuredCase("allow-system-read", "ALLOW", config([{ id: "allow-read", description: "allow trusted read", match: { tools: ["read_file"], trustLevel: [TrustLevel.SYSTEM], environment: ["development"] }, action: "ALLOW" }]), input("read_file")),
      configuredCase("deny-overrides-allow", "DENY", config([{ id: "allow-write", description: "allow write", match: { tools: ["write_file"] }, action: "ALLOW" }, { id: "deny-prod-write", description: "deny prod write", match: { tools: ["write_file"], environment: ["production"] }, action: "DENY" }]), input("write_file", "production")),
      configuredCase("confirm-delete", "CONFIRM", config([{ id: "confirm-delete", description: "approval required", match: { tools: ["delete_file"] }, action: "CONFIRM", channel: "stdout" }]), input("delete_file")),
      configuredCase("quarantine-external-write", "QUARANTINE", config([{ id: "quarantine-external", description: "quarantine external content", match: { trustSource: [TrustLevel.EXTERNAL], nextTool: ["write_file"] }, action: "QUARANTINE" }]), input("write_file", "development", TrustLevel.EXTERNAL)),
      configuredCase("input-pattern-match", "DENY", config([{ id: "deny-secret-query", description: "block secret query", match: { inputPatterns: ["secret"] }, action: "DENY" }]), input("search", "development", TrustLevel.AGENT, true, { query: "secret material" })),
      configuredCase("deny-unallowlisted-server", "DENY", config([{ id: "deny-unlisted", description: "unlisted servers denied", match: { serverNotInAllowlist: true }, action: "DENY" }]), input("read_file", "development", TrustLevel.SYSTEM, false)),
      configuredCase("default-deny", "DENY", config([]), input("unknown_tool")),
    ];
    const result = runPolicyPackCases(cases, metadata);
    expect(result.results.map((entry) => entry.passed)).toEqual(Array(7).fill(true));
    expect(result.summary).toEqual({ totalCases: 7, passedCases: 7, actionAccuracy: 1 });
  });

  it("runs the checked-in public smoke corpus against Warden's actual policy engine", async () => {
    const corpusPath = resolve("benchmarks/warden-policy/cases.jsonl");
    const cases = parsePolicyPackCases(await readFile(corpusPath, "utf8"));
    const result = runPolicyPackCases(cases, metadata);
    expect(result.summary).toEqual({ totalCases: 7, passedCases: 7, actionAccuracy: 1 });
    expect(result.results.map(({ id, actualAction }) => [id, actualAction])).toEqual([
      ["allow-system-read", "ALLOW"],
      ["deny-overrides-allow", "DENY"],
      ["confirm-delete", "CONFIRM"],
      ["quarantine-external-write", "QUARANTINE"],
      ["input-pattern-match", "DENY"],
      ["deny-unallowlisted-server", "DENY"],
      ["default-deny", "DENY"],
    ]);
  });

  it("pins the local case asset size and digest in the Val manifest", async () => {
    const manifest = JSON.parse(await readFile(resolve("benchmarks/warden-policy/manifest.json"), "utf8")) as { id: string; splits: Array<{ id: string; role: string; visibility: string; assets: Array<{ path: string; sizeBytes: number; sha256: string }> }> };
    const assetPath = resolve("benchmarks/warden-policy/cases.jsonl");
    const asset = await readFile(assetPath);
    expect(manifest.id).toBe("warden-policy-pack");
    expect(manifest.splits).toHaveLength(1);
    expect(manifest.splits[0]).toMatchObject({ id: "smoke", role: "example", visibility: "public" });
    expect(manifest.splits[0]!.assets[0]).toMatchObject({
      path: "cases.jsonl",
      sizeBytes: asset.byteLength,
      sha256: createHash("sha256").update(asset).digest("hex"),
    });
  });

  it("requires an explicit Val CLI path before invoking the pack command", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", resolve("scripts/run-policy-benchmark.ts"), "--split", "smoke"], {
      encoding: "utf8",
      env: { ...process.env, VAL_CLI: "" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/VAL_CLI/i);
  });

  it("fails closed when the configured Val CLI cannot be executed", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", resolve("scripts/run-policy-benchmark.ts"), "--split", "smoke"], {
      encoding: "utf8",
      env: { ...process.env, VAL_CLI: "/nonexistent/val-cli.js" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/validation\/fetch failed/i);
  });
});
