import { evaluate } from "../../packages/core/src/index.js";
import { TrustLevel } from "../../packages/core/src/trust.js";
import type { EvaluateInput, PolicyAction, PolicyConfig } from "../../packages/core/src/index.js";

const ACTIONS = new Set<PolicyAction>(["ALLOW", "DENY", "CONFIRM", "QUARANTINE"]);
const CASE_KEYS = ["description", "expectedAction", "id", "input", "policy"];
const MAX_CASES = 500;
const MAX_LINE_BYTES = 1_048_576;

export interface PolicyPackCase {
  id: string;
  description: string;
  policy: PolicyConfig;
  input: EvaluateInput;
  expectedAction: PolicyAction;
}

export interface PolicyPackMetadata {
  packId: string;
  version: string;
  splitId: string;
  source: { repository: string; revision: string };
  license: { id: string; attribution: string };
  scorer: { id: string; version: string };
}

export interface PolicyPackResult {
  schemaVersion: "warden-policy-benchmark-result/v1";
  pack: { id: string; version: string; splitId: string };
  source: { repository: string; revision: string };
  license: { id: string; attribution: string };
  scorer: { id: string; version: string };
  summary: { totalCases: number; passedCases: number; actionAccuracy: number };
  results: Array<{ id: string; expectedAction: PolicyAction; actualAction: PolicyAction; passed: boolean }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertCase(value: unknown, lineNumber: number): asserts value is PolicyPackCase {
  const prefix = `policy pack JSONL line ${lineNumber}`;
  if (!isRecord(value)) throw new Error(`${prefix}: case must be an object`);
  const keys = Object.keys(value).sort();
  if (keys.length !== CASE_KEYS.length || keys.some((key, index) => key !== CASE_KEYS[index])) {
    throw new Error(`${prefix}: case has missing or unknown fields`);
  }
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.id)) throw new Error(`${prefix}: id is invalid`);
  if (typeof value.description !== "string" || value.description.length === 0 || value.description.length > 500) throw new Error(`${prefix}: description is invalid`);
  if (typeof value.expectedAction !== "string" || !ACTIONS.has(value.expectedAction as PolicyAction)) throw new Error(`${prefix}: expectedAction is invalid`);
  if (!isRecord(value.policy) || typeof value.policy.version !== "string" || !isRecord(value.policy.meta) || !Array.isArray(value.policy.policies)) {
    throw new Error(`${prefix}: policy is invalid`);
  }
  if (!isRecord(value.input) || typeof value.input.toolName !== "string" || !isRecord(value.input.toolInput) ||
      typeof value.input.environment !== "string" || typeof value.input.serverInAllowlist !== "boolean" || !Array.isArray(value.input.trustSources)) {
    throw new Error(`${prefix}: input is invalid`);
  }
  for (const trustSource of value.input.trustSources) {
    if (!isRecord(trustSource) || typeof trustSource.source !== "string" || ![TrustLevel.EXTERNAL, TrustLevel.TOOL, TrustLevel.AGENT, TrustLevel.SYSTEM].includes(trustSource.trust as 0 | 1 | 2 | 3)) {
      throw new Error(`${prefix}: trustSources is invalid`);
    }
  }
}

export function parsePolicyPackCases(jsonl: string): PolicyPackCase[] {
  if (typeof jsonl !== "string" || jsonl.length === 0) throw new Error("policy pack JSONL is empty");
  const cases: PolicyPackCase[] = [];
  const ids = new Set<string>();
  for (const [index, line] of jsonl.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) throw new Error(`policy pack JSONL line ${index + 1} exceeds 1 MiB`);
    let value: unknown;
    try { value = JSON.parse(line); }
    catch { throw new Error(`policy pack JSONL line ${index + 1} is invalid JSON`); }
    assertCase(value, index + 1);
    if (ids.has(value.id)) throw new Error(`policy pack JSONL contains duplicate case ID: ${value.id}`);
    ids.add(value.id);
    cases.push(value);
    if (cases.length > MAX_CASES) throw new Error(`policy pack exceeds the ${MAX_CASES} case limit`);
  }
  if (cases.length === 0) throw new Error("policy pack JSONL contains no cases");
  return cases;
}

export function runPolicyPackCases(cases: PolicyPackCase[], metadata: PolicyPackMetadata): PolicyPackResult {
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > MAX_CASES) throw new Error("policy pack must contain 1 to 500 cases");
  const results = cases.map((testCase) => {
    let actualAction: PolicyAction;
    try { actualAction = evaluate(testCase.policy, testCase.input).action; }
    catch { throw new Error(`policy benchmark case ${testCase.id} could not be evaluated`); }
    return { id: testCase.id, expectedAction: testCase.expectedAction, actualAction, passed: actualAction === testCase.expectedAction };
  });
  const passedCases = results.filter((result) => result.passed).length;
  return {
    schemaVersion: "warden-policy-benchmark-result/v1",
    pack: { id: metadata.packId, version: metadata.version, splitId: metadata.splitId },
    source: { ...metadata.source },
    license: { ...metadata.license },
    scorer: { ...metadata.scorer },
    summary: { totalCases: results.length, passedCases, actionAccuracy: passedCases / results.length },
    results,
  };
}
