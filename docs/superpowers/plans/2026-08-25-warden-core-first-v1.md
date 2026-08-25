# Warden Core-First V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden and release-gate Warden's domain-neutral authorization runtime without changing the existing MCP/tool enforcement behavior.

**Architecture:** Keep the existing synchronous tool evaluator and the new asynchronous generic evaluator as separate public surfaces in V1. Add a focused validation module at the generic runtime boundary, prove shared invariants with compatibility fixtures, and verify the actual packed `@warden/core` artifact in a clean Node 22 ESM consumer before CI can publish.

**Tech Stack:** TypeScript 5.7, Node.js 22 ESM, Vitest 4, npm workspaces, GitHub Actions.

---

## File Map

- Create `packages/core/src/validation.ts`: bounded, side-effect-free validation of untrusted generic values and plain records.
- Modify `packages/core/src/authorization.ts`: validate runtime options, extensions, policies, requests, and condition results; preserve fail-closed decisions.
- Modify `packages/core/src/index.ts`: export documented validation limits only if consumers need them; do not export internal walkers.
- Modify `packages/core/tests/authorization.test.ts`: generic validation and fail-closed coverage.
- Create `packages/core/tests/compatibility.test.ts`: evidence that old and generic policy surfaces preserve shared decision invariants.
- Create `scripts/verify-core-package.mjs`: build, pack, inspect, install, type-check, and execute the public artifact.
- Modify `package.json`: add `verify:core-package` release command.
- Modify `.github/workflows/ci.yml`: gate CI on the packed consumer.
- Modify `.github/workflows/publish.yml`: verify the same artifact before npm publication.
- Create `docs/EXTENSIONS.md`: stable V1 extension contract and example.
- Create `docs/THREAT_MODEL.md`: trust boundaries, failure behavior, and explicit limitations.
- Modify `docs/EMBEDDING.md`: document validation limits and dual API surfaces.
- Modify `README.md`: identify MCP as an adapter and link the new public docs.
- Modify `CHANGELOG.md`: accurately record V1 hardening and package verification.
- Delete tracked `docs/internal/*`: stop publishing maintainer plans going forward without rewriting history.

### Task 1: Bounded untrusted-value validation

**Files:**
- Create: `packages/core/src/validation.ts`
- Test: `packages/core/tests/authorization.test.ts`

- [ ] **Step 1: Add failing tests for unsafe and oversized values**

Append tests that evaluate policies or requests containing non-finite numbers,
functions, symbols, cycles, accessors, `__proto__`/`constructor` keys, excessive
nesting, and oversized strings. Assert a structured `DENY` with
`EVALUATION_ERROR`, never a thrown evaluation error or `ALLOW`.

```typescript
it.each([
  ["non-finite number", { value: Number.POSITIVE_INFINITY }],
  ["function", { value: () => true }],
  ["symbol", { value: Symbol("unsafe") }],
])("fails closed for a %s in untrusted input", async (_name, context) => {
  const decision = await createWarden({ extensions: [extension] }).evaluate(
    definePolicy({ id: "unsafe", version: 1, rules: [{ id: "allow", effect: "ALLOW", conditions: [] }] }),
    { subject: {}, action: {}, resource: {}, context },
  );
  expect(decision).toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
});
```

Create accessor and cycle fixtures with `Object.defineProperty()` and a
self-reference so validation is proven not to invoke getters or recurse
forever.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npx vitest run packages/core/tests/authorization.test.ts
```

Expected: new unsafe-value cases fail because the current runtime accepts or
clones them without the required bounded validation.

- [ ] **Step 3: Implement the internal validation module**

Create constants and a recursive walker with these exact V1 limits:

```typescript
export const AUTHORIZATION_LIMITS = {
  maxRules: 1_000,
  maxConditionsPerRule: 64,
  maxDepth: 16,
  maxNodes: 10_000,
  maxStringLength: 64 * 1024,
  maxResolverTimeoutMs: 30_000,
} as const;
```

Implement:

```typescript
export function assertPlainRecord(value: unknown, field: string): asserts value is Record<string, unknown>;
export function assertSafeValue(value: unknown, field: string): void;
```

`assertSafeValue` must use property descriptors rather than `value[key]`, reject
accessors, reject cycles with an ancestor set, count visited nodes, enforce
depth/string limits, reject non-finite numbers and unsupported JavaScript
types, allow only arrays and objects whose prototype is `Object.prototype` or
`null`, and reject keys `__proto__`, `prototype`, and `constructor`.

- [ ] **Step 4: Wire request and condition-value validation into evaluation**

At the start of the `try` block in `Warden.evaluate`, validate the policy and
request before executing any resolver or condition. Validate each
`ConditionReference.value` through the same walker. Do not export the internal
walker from `index.ts`.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run:

```bash
npx vitest run packages/core/tests/authorization.test.ts
```

Expected: all authorization tests pass and getters are never invoked.

- [ ] **Step 6: Commit bounded validation**

```bash
git add packages/core/src/validation.ts packages/core/src/authorization.ts packages/core/tests/authorization.test.ts
git commit -m "fix(core): bound generic authorization inputs"
```

### Task 2: Policy, extension, and resolver contract validation

**Files:**
- Modify: `packages/core/src/authorization.ts`
- Modify: `packages/core/tests/authorization.test.ts`

- [ ] **Step 1: Add failing registration and policy-shape tests**

Add table-driven cases for invalid policy IDs, versions, rules, effects,
condition names, condition counts, extension names/versions, duplicate resolver
names, missing callbacks, and resolver timeouts of `0`, negative values,
fractions, `Infinity`, and values above 30 seconds.

Registration and option errors must throw `TypeError` from `createWarden`.
Policy errors encountered through `warden.evaluate()` must return structured
`DENY`. A condition returning a non-boolean must also fail closed.

```typescript
it("fails closed when a condition does not return a boolean", async () => {
  const invalid = {
    name: "invalid",
    version: "1.0.0",
    conditions: [{ name: "invalid.result", evaluate: () => "yes" as unknown as boolean }],
  } satisfies WardenExtension;
  const decision = await createWarden({ extensions: [invalid] }).evaluate(
    { id: "policy", version: 1, rules: [{ id: "allow", effect: "ALLOW", conditions: [{ name: "invalid.result" }] }] },
    { subject: {}, action: {}, resource: {} },
  );
  expect(decision).toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run `npx vitest run packages/core/tests/authorization.test.ts`.

Expected: malformed runtime definitions are currently accepted.

- [ ] **Step 3: Add explicit validators and use them at the correct boundary**

Implement private helpers in `authorization.ts`:

```typescript
function assertIdentifier(value: unknown, field: string): asserts value is string;
function assertPolicy(policy: unknown): asserts policy is AuthorizationPolicy;
function assertExtension(extension: unknown): asserts extension is WardenExtension;
function assertResolverTimeout(value: unknown): asserts value is number;
```

Identifiers must be non-empty, at most 128 characters, and match
`^[A-Za-z0-9][A-Za-z0-9._/-]*$`. Extension versions must be non-empty strings
of at most 64 characters. Require own data properties for callbacks and verify
they are functions. Check effect membership explicitly. Enforce 64 conditions
per rule using `AUTHORIZATION_LIMITS`.

Keep `definePolicy()` as the throwing authoring helper. `evaluate()` catches
its validation error and returns `EVALUATION_ERROR`. After awaiting a
condition, require `typeof result === "boolean"` before using it.

- [ ] **Step 4: Run authorization and type tests**

```bash
npx vitest run packages/core/tests/authorization.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit contract validation**

```bash
git add packages/core/src/authorization.ts packages/core/tests/authorization.test.ts
git commit -m "fix(core): validate authorization extensions and policies"
```

### Task 3: Compatibility evidence for both policy surfaces

**Files:**
- Create: `packages/core/tests/compatibility.test.ts`

- [ ] **Step 1: Write the compatibility fixture tests**

Build one old `PolicyConfig` and one generic `AuthorizationPolicy` representing
the same allow/deny cases. Use a generic `tool.name` condition to map
`EvaluateInput.toolName` into `EvaluationRequest.action`.

```typescript
const effect = (action: PolicyDecision["action"]): DecisionEffect =>
  action === "CONFIRM" ? "PENDING_APPROVAL" : action;

it.each([
  ["read_file", "ALLOW"],
  ["delete_file", "DENY"],
  ["unknown_tool", "DENY"],
] as const)("preserves %s as %s", async (toolName, expected) => {
  const legacy = evaluate(toolPolicy, legacyInput(toolName));
  const generic = await warden.evaluate(genericPolicy, genericRequest(toolName));
  expect(effect(legacy.action)).toBe(expected);
  expect(generic.effect).toBe(expected);
});
```

Add separate cases proving deny-wins with multiple matches and default deny on
both APIs. Do not add a production translator.

- [ ] **Step 2: Run compatibility tests and confirm they pass against current contracts**

Run:

```bash
npx vitest run packages/core/tests/compatibility.test.ts packages/core/tests/policy.test.ts
```

Expected: PASS. This task adds regression evidence rather than changing either
evaluator.

- [ ] **Step 3: Commit compatibility evidence**

```bash
git add packages/core/tests/compatibility.test.ts
git commit -m "test(core): prove policy surface compatibility"
```

### Task 4: Packed `@warden/core` consumer gate

**Files:**
- Create: `scripts/verify-core-package.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish.yml`

- [ ] **Step 1: Add the failing package verification command**

Add to root `package.json`:

```json
"verify:core-package": "node scripts/verify-core-package.mjs"
```

Create a first script version that throws `new Error("package verification not implemented")`.

- [ ] **Step 2: Run the command and confirm RED**

Run `npm run verify:core-package`.

Expected: exit 1 with `package verification not implemented`.

- [ ] **Step 3: Implement artifact creation and inspection**

Use only Node built-ins and `execFileSync`. Create a temporary directory with
`mkdtempSync(join(tmpdir(), "warden-core-package-"))` and always remove it in a
`finally` block. Run the core workspace build, then:

```javascript
const packJson = execFileSync(
  "npm",
  ["pack", "--json", "--pack-destination", artifactDir],
  { cwd: coreDir, encoding: "utf8" },
);
const [{ filename, files }] = JSON.parse(packJson);
```

Assert that `files` contains `dist/src/index.js`, `dist/src/index.d.ts`,
`LICENSE`, and `package.json`;
assert no path contains `/src/` unless it is beneath `dist/`, and no path
contains `docs/internal`, `tests`, `tsbuildinfo`, or `coverage`.

- [ ] **Step 4: Implement the clean ESM consumer fixture**

Write a fixture `package.json` with `type: module` and a fixture `tsconfig.json`
using `module`/`moduleResolution: NodeNext`, `strict: true`, and `noEmit: true`.
Install the tarball with:

```javascript
execFileSync("npm", ["install", "--ignore-scripts", "--package-lock=false", tarball], {
  cwd: fixtureDir,
  stdio: "inherit",
});
```

Write `consumer.ts` importing only from `@warden/core`. It must create a typed
extension and request, assert allow/deny/fail-closed decisions, append and
verify two audit events, and create/resolve one approval request. Run the local
TypeScript compiler with `--noEmit`, then execute the same fixture with `tsx`
or compile it to a temporary output directory and run Node. Prefer compilation
plus Node so the release gate does not rely on workspace source loaders.

- [ ] **Step 5: Run package verification and confirm GREEN**

Run:

```bash
npm run verify:core-package
git status --short
```

Expected: verification prints the packed package name and completes with exit
0; no tarball, fixture, or generated file remains in the worktree.

- [ ] **Step 6: Add the gate to CI and publication**

In `.github/workflows/ci.yml`, add a Node 22 `package-consumer` job after
install/typecheck and make `docker-build` depend on it. In
`.github/workflows/publish.yml`, run `npm run verify:core-package` after tests
and before individual package builds/publishes.

- [ ] **Step 7: Commit package verification**

```bash
git add package.json scripts/verify-core-package.mjs .github/workflows/ci.yml .github/workflows/publish.yml
git commit -m "test(release): verify packed core consumer"
```

### Task 5: Public contracts, threat model, and repository hygiene

**Files:**
- Create: `docs/EXTENSIONS.md`
- Create: `docs/THREAT_MODEL.md`
- Modify: `docs/EMBEDDING.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Delete: `docs/internal/DEPLOYMENT.md`
- Delete: `docs/internal/ROADMAP.md`
- Delete: `docs/internal/WARDEN_UI_PLAN.md`
- Delete: `docs/internal/e2e-plan.md`

- [ ] **Step 1: Write extension documentation against the packed API**

Document `WardenExtension`, condition naming, `resolver:condition` references,
the 30-second maximum timeout, registration errors, evaluation errors, and a
copy-pasteable non-payment example. State that extensions cannot override
deny-wins or turn errors into `ALLOW`.

- [ ] **Step 2: Write the threat model**

Define trusted application code versus untrusted policy/request/resolver data;
fail-closed guarantees; bounded validation; resolver/network trust; secret
redaction boundaries; prototype-pollution defenses; audit hash-chain
properties; checkpoint requirement for final-entry truncation; local hook
server authentication; and explicit non-goals. Do not claim that hashing
provides confidentiality or that Warden is a compliance guarantee.

- [ ] **Step 3: Update embedding, README, and changelog**

State explicitly that the legacy tool API and generic API coexist in V1, MCP
is an adapter, Node 22 ESM is supported, and consumers use only package-root
exports. Link `EXTENSIONS.md`, `THREAT_MODEL.md`, and `EMBEDDING.md`. Correct
the changelog's existing packed-package claim so it names the actual automated
gate added in Task 4.

- [ ] **Step 4: Remove tracked internal plans going forward**

Run:

```bash
git rm docs/internal/DEPLOYMENT.md docs/internal/ROADMAP.md docs/internal/WARDEN_UI_PLAN.md docs/internal/e2e-plan.md
```

Do not rewrite repository history. Confirm `.gitignore` still excludes
`docs/internal/` so local maintainer documents are not re-added.

- [ ] **Step 5: Verify documentation examples and links**

Run:

```bash
npm run verify:core-package
rg -n 'docs/internal|packed-package consumer test coverage' README.md CHANGELOG.md docs -g '*.md'
git diff --check
```

Expected: package example passes, no public link points to removed internal
docs, and diff check reports no errors.

- [ ] **Step 6: Commit public documentation and hygiene**

```bash
git add README.md CHANGELOG.md docs/EXTENSIONS.md docs/THREAT_MODEL.md docs/EMBEDDING.md docs/internal
git commit -m "docs: publish Warden V1 security contracts"
```

### Task 6: Full release-candidate verification

**Files:**
- Modify only if verification exposes a defect in an earlier task.

- [ ] **Step 1: Run focused core verification**

```bash
npx vitest run packages/core/tests/authorization.test.ts packages/core/tests/compatibility.test.ts packages/core/tests/approval.test.ts packages/core/tests/audit.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run static and package build gates**

```bash
npm run typecheck
npm run build
npm run verify:core-package
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the complete regression suite with subprocess permissions**

```bash
npm test
```

Expected: every test passes. The baseline is 399 tests; the final count must be
higher because Tasks 1-3 add coverage.

- [ ] **Step 4: Inspect repository and release metadata**

```bash
git diff --check authorization-runtime...HEAD
git status --short
git log --oneline authorization-runtime..HEAD
node -e 'for (const p of ["core","hook-server","mcp-gateway","cli"]) { const j=require(`./packages/${p}/package.json`); console.log(j.name,j.version) }'
```

Expected: no uncommitted files, no whitespace errors, intentional commits only,
and consistent V1 package versions/dependency ranges.

- [ ] **Step 5: Record owner-controlled release blockers without performing them**

Report separately:

- npm `@warden` organization/scope ownership;
- package-name availability at publish time;
- `NPM_TOKEN` and GitHub `npm-release` environment configuration;
- chosen release version/tag;
- merge or PR into `main`;
- GitHub release creation and actual npm/GHCR publication.

Do not publish, merge, rewrite history, or expose credentials during this task.

- [ ] **Step 6: Commit any verification-only corrections**

If Step 1-4 required a correction, rerun the failed gate and commit only the
corrected files with a message describing the actual defect. If no correction
was required, create no empty commit.

### Task 7: Post-V1 remaining-work report

**Files:**
- Create: `docs/V1_REMAINING_WORK.md`

- [ ] **Step 1: Re-audit the three source planning documents**

Compare the completed branch against `WARDEN_UI_PLAN.md`,
`warden-incur-integration.md`, and the payment-readiness improvement plan in
the Stalewell docs repository. Classify each item as complete, required next,
valuable later, or optional.

- [ ] **Step 2: Write the prioritized report**

Include evidence links to Warden source/tests, updated effort ranges, and this
recommended order:

1. owner-controlled V1 release actions;
2. real Warden Pay extension integration feedback;
3. OpenUI Console component and serialization foundation;
4. approval/quarantine interactions and query layer;
5. CTA, TOON, and discovery improvements;
6. Sideshow and portfolio reuse if still valuable.

- [ ] **Step 3: Verify the report and commit**

```bash
git diff --check
git add docs/V1_REMAINING_WORK.md
git commit -m "docs: prioritize work remaining after Warden V1"
```

Expected: every section contains a concrete status, evidence path, priority,
and estimate; diff check passes.
