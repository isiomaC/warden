import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreDirectory = join(workspace, "packages", "core");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "warden-core-package-"));
const artifactDirectory = join(temporaryDirectory, "artifacts");
const fixtureDirectory = join(temporaryDirectory, "consumer");
const npmEnvironment = { ...process.env, npm_config_cache: join(temporaryDirectory, "npm-cache") };

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  mkdirSync(artifactDirectory);
  mkdirSync(fixtureDirectory);

  run("npm", ["run", "build", "--workspace=packages/core"], { cwd: workspace });
  const packOutput = run("npm", ["pack", "--json", "--pack-destination", artifactDirectory], { cwd: coreDirectory, env: npmEnvironment });
  const [packed] = JSON.parse(packOutput);
  assert(packed && typeof packed.filename === "string" && Array.isArray(packed.files), "npm pack did not return filename/files metadata");

  const paths = packed.files.map((file) => file.path);
  for (const required of ["dist/src/index.js", "dist/src/index.d.ts", "LICENSE", "package.json"]) {
    assert(paths.includes(required), `Packed @stlw/warden is missing ${required}`);
  }
  const unintended = paths.filter((path) =>
    path.startsWith("src/")
    || path === "docs/internal"
    || path.startsWith("docs/internal/")
    || path.split("/").includes("tests")
    || path.endsWith(".tsbuildinfo")
    || path === "coverage"
    || path.startsWith("coverage/"),
  );
  assert(unintended.length === 0, `Packed @stlw/warden contains unintended files: ${unintended.join(", ")}`);

  const tarball = join(artifactDirectory, packed.filename);
  writeFileSync(join(fixtureDirectory, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  writeFileSync(join(fixtureDirectory, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: false },
    include: ["consumer.ts"],
  }, null, 2)}\n`);
  writeFileSync(join(fixtureDirectory, "consumer.ts"), `import {
  AuditChain, createApprovalRequest, createWarden, definePolicy, resolveApproval, verifyAuditChain,
  type EvaluationRequest, type WardenExtension,
} from "@stlw/warden";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Request = EvaluationRequest<{ id: string }, "read" | "delete", { id: string }>;
const extension: WardenExtension = {
  name: "consumer",
  version: "1.0.0",
  conditions: [
    { name: "actionEquals", evaluate(request, expected) { return request.action === expected; } },
    { name: "throws", evaluate() { throw new Error("consumer condition failure"); } },
  ],
};
const request: Request = { subject: { id: "agent-1" }, action: "read", resource: { id: "document-1" } };
const warden = createWarden({ extensions: [extension] });
const allow = await warden.evaluate(definePolicy({ id: "allow-read", version: 1, rules: [{ id: "allow", effect: "ALLOW", conditions: [{ name: "actionEquals", value: "read" }] }] }), request);
const deny = await warden.evaluate(definePolicy({ id: "deny-delete", version: 1, rules: [{ id: "deny", effect: "DENY", conditions: [{ name: "actionEquals", value: "delete" }] }] }), { ...request, action: "delete" });
const failClosed = await warden.evaluate(definePolicy({ id: "fail-closed", version: 1, rules: [{ id: "broken", effect: "ALLOW", conditions: [{ name: "throws" }] }] }), request);
assert(allow.effect === "ALLOW", "expected allow decision");
assert(deny.effect === "DENY", "expected deny decision");
assert(failClosed.effect === "DENY" && failClosed.reasons[0]?.code === "EVALUATION_ERROR", "expected fail-closed decision");

const audit = new AuditChain();
audit.append({ eventId: "event-1", eventType: "authorization", occurredAt: "2026-01-01T00:00:00.000Z", payload: allow });
audit.append({ eventId: "event-2", eventType: "authorization", occurredAt: "2026-01-01T00:00:01.000Z", payload: deny });
assert(verifyAuditChain(audit.entries).valid, "expected valid audit chain");

const approval = createApprovalRequest({ requestId: "approval-1", requesterId: "agent-1", action: "delete", resource: { id: "document-1" }, requestedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:05:00.000Z" });
const resolved = resolveApproval(approval, { decision: "APPROVED", approverId: "human-1", resolvedAt: "2026-01-01T00:01:00.000Z" });
assert(resolved.status === "APPROVED", "expected approved request");
`);

  run("npm", ["install", "--ignore-scripts", "--package-lock=false", tarball], { cwd: fixtureDirectory, env: npmEnvironment });
  const compiler = join(workspace, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [compiler, "--project", "tsconfig.json", "--noEmit"], { cwd: fixtureDirectory });
  run(process.execPath, [compiler, "--project", "tsconfig.json", "--noEmit", "false", "--outDir", "compiled"], { cwd: fixtureDirectory });
  run(process.execPath, [join(fixtureDirectory, "compiled", "consumer.js")], { cwd: fixtureDirectory });

  console.log(`Verified packed @stlw/warden consumer: ${packed.filename}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
  rmSync(join(coreDirectory, "dist"), { recursive: true, force: true });
}
