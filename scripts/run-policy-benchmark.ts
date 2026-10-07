import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parsePolicyPackCases, runPolicyPackCases } from "../benchmarks/warden-policy/runner.js";
import type { PolicyPackMetadata } from "../benchmarks/warden-policy/runner.js";

interface PackManifest {
  id: string;
  version: string;
  source: { repository: string; revision: string };
  license: { id: string; attribution: string };
  scorer: { id: string; version: string };
  splits: Array<{ id: string; assets: Array<{ path: string; sha256: string }> }>;
}

function runVal(valCli: string, args: string[]): string {
  const result = spawnSync(process.execPath, [valCli, ...args], { encoding: "utf8", timeout: 60_000, maxBuffer: 1_048_576 });
  if (result.error || result.status !== 0) throw new Error("Val benchmark validation/fetch failed; check the manifest and Val CLI version");
  return result.stdout;
}

async function main(): Promise<void> {
  let values: { split?: string };
  try {
    ({ values } = parseArgs({ options: { split: { type: "string" } }, allowPositionals: false }));
  } catch {
    throw new Error("usage: npm run benchmark:policy -- --split <id>");
  }
  const splitId = values.split;
  if (!splitId) throw new Error("usage: npm run benchmark:policy -- --split <id>");
  const valCli = process.env.VAL_CLI;
  if (!valCli) throw new Error("VAL_CLI must point to the built Val CLI from the pinned Val source checkout");

  const manifestPath = resolve("benchmarks/warden-policy/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackManifest;
  const split = manifest.splits.find((candidate) => candidate.id === splitId);
  if (!split || split.assets.length !== 1) throw new Error(`unknown or unsupported policy pack split: ${splitId}`);
  runVal(resolve(valCli), ["benchmark", "validate", manifestPath]);
  const fetchedOutput = runVal(resolve(valCli), ["benchmark", "fetch", manifestPath, "--split", splitId]);
  const fetched = fetchedOutput.split(/\r?\n/).slice(1).filter(Boolean).map((line) => line.split("\t"));
  if (fetched.length !== split.assets.length) throw new Error("Val returned an incomplete split cache result");

  const cachedByAsset = new Map<string, string>();
  for (const columns of fetched) {
    if (columns.length !== 3 || !columns[0] || !columns[1] || !columns[2] || cachedByAsset.has(columns[0])) {
      throw new Error("Val returned an invalid or duplicate split cache result");
    }
    cachedByAsset.set(columns[0], columns[2]);
  }
  for (const asset of split.assets) {
    const matchingEntry = fetched.find((columns) => columns[0] === asset.path && columns[1] === asset.sha256);
    if (!matchingEntry || !cachedByAsset.has(asset.path)) throw new Error("Val cache result does not match the selected split manifest");
  }
  const casesPath = cachedByAsset.get(split.assets[0]!.path)!;
  const cases = parsePolicyPackCases(await readFile(casesPath, "utf8"));
  const metadata: PolicyPackMetadata = {
    packId: manifest.id,
    version: manifest.version,
    splitId,
    source: manifest.source,
    license: manifest.license,
    scorer: manifest.scorer,
  };
  const report = runPolicyPackCases(cases, metadata);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.summary.actionAccuracy !== 1) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "policy benchmark failed");
  process.exitCode = 2;
});
