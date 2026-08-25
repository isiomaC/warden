import { describe, expect, it } from "vitest";
import {
  createWarden,
  definePolicy,
  type WardenExtension,
} from "../src/authorization";

type Resource = { ownerId: string; amount: string };
type Context = { blocked: boolean };

const extension: WardenExtension = {
  name: "test",
  version: "1.0.0",
  conditions: [
    {
      name: "resource.owner",
      evaluate: ({ resource }, expected) =>
        (resource as Resource).ownerId === expected,
    },
    {
      name: "context.notBlocked",
      evaluate: ({ context }) => !(context as Context).blocked,
    },
  ],
};

describe("generic authorization runtime", () => {
  it.each([
    ["an empty policy id", { id: "", version: 1, rules: [] }],
    ["an invalid policy id", { id: "bad id", version: 1, rules: [] }],
    ["an overlong policy id", { id: "a".repeat(129), version: 1, rules: [] }],
    ["a zero policy version", { id: "policy", version: 0, rules: [] }],
    ["a fractional policy version", { id: "policy", version: 1.5, rules: [] }],
    ["missing rules", { id: "policy", version: 1 }],
    ["non-array rules", { id: "policy", version: 1, rules: {} }],
    ["an invalid rule id", { id: "policy", version: 1, rules: [{ id: "bad id", effect: "ALLOW", conditions: [] }] }],
    ["duplicate rule ids", { id: "policy", version: 1, rules: [{ id: "same", effect: "ALLOW", conditions: [] }, { id: "same", effect: "DENY", conditions: [] }] }],
    ["an invalid effect", { id: "policy", version: 1, rules: [{ id: "rule", effect: "allow", conditions: [] }] }],
    ["missing conditions", { id: "policy", version: 1, rules: [{ id: "rule", effect: "ALLOW" }] }],
    ["an invalid condition name", { id: "policy", version: 1, rules: [{ id: "rule", effect: "ALLOW", conditions: [{ name: "bad name" }] }] }],
    ["too many conditions", { id: "policy", version: 1, rules: [{ id: "rule", effect: "ALLOW", conditions: Array.from({ length: 65 }, (_, index) => ({ name: `condition.${index}` })) }] }],
  ])("fails closed when a policy has %s", async (_description, policy) => {
    await expect(createWarden().evaluate(
      policy as never,
      { subject: {}, action: {}, resource: {} },
    )).resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
  });

  it("keeps definePolicy as a throwing authoring helper", () => {
    expect(() => definePolicy({ id: "bad id", version: 1, rules: [] })).toThrow(TypeError);
  });

  it.each([
    ["an empty extension name", { name: "", version: "1" }],
    ["an invalid extension name", { name: "bad name", version: "1" }],
    ["an overlong extension name", { name: "a".repeat(129), version: "1" }],
    ["an empty extension version", { name: "extension", version: "" }],
    ["a non-string extension version", { name: "extension", version: 1 }],
    ["an overlong extension version", { name: "extension", version: "v".repeat(65) }],
    ["an invalid condition name", { name: "extension", version: "1", conditions: [{ name: "bad name", evaluate: () => true }] }],
    ["a missing condition callback", { name: "extension", version: "1", conditions: [{ name: "condition" }] }],
    ["an inherited condition callback", { name: "extension", version: "1", conditions: [Object.assign(Object.create({ evaluate: () => true }), { name: "condition" })] }],
    ["an invalid resolver name", { name: "extension", version: "1", resolvers: [{ name: "bad name", resolve: () => true }] }],
    ["a missing resolver callback", { name: "extension", version: "1", resolvers: [{ name: "resolver" }] }],
    ["an inherited resolver callback", { name: "extension", version: "1", resolvers: [Object.assign(Object.create({ resolve: () => true }), { name: "resolver" })] }],
  ])("rejects an extension with %s", (_description, invalidExtension) => {
    expect(() => createWarden({ extensions: [invalidExtension as never] })).toThrow(TypeError);
  });

  it.each(["conditions", "resolvers"])(
    "rejects a changing extension-level %s accessor without invoking it",
    (property) => {
      let getterInvocations = 0;
      const invalidExtension = { name: "extension", version: "1" } as Record<string, unknown>;
      Object.defineProperty(invalidExtension, property, {
        enumerable: true,
        get() {
          getterInvocations += 1;
          return getterInvocations === 1 ? [] : [{ name: "bypass" }];
        },
      });

      expect(() => createWarden({ extensions: [invalidExtension as never] })).toThrow(TypeError);
      expect(getterInvocations).toBe(0);
    },
  );

  it.each([
    ["condition name", "conditions", "name"],
    ["condition callback", "conditions", "evaluate"],
    ["resolver name", "resolvers", "name"],
    ["resolver callback", "resolvers", "resolve"],
  ])("rejects a definition-level %s accessor without invoking it", (_description, collection, property) => {
    let getterInvocations = 0;
    const definition: Record<string, unknown> = {
      name: collection === "conditions" ? "condition" : "resolver",
      [collection === "conditions" ? "evaluate" : "resolve"]: () => true,
    };
    Object.defineProperty(definition, property, {
      configurable: true,
      enumerable: true,
      get() { getterInvocations += 1; return property === "name" ? "safe" : () => true; },
    });

    expect(() => createWarden({ extensions: [{
      name: "extension",
      version: "1",
      [collection]: [definition],
    } as never] })).toThrow(TypeError);
    expect(getterInvocations).toBe(0);
  });

  it("rejects duplicate resolver names", () => {
    expect(() => createWarden({ extensions: [
      { name: "one", version: "1", resolvers: [{ name: "shared", resolve: () => 1 }] },
      { name: "two", version: "1", resolvers: [{ name: "shared", resolve: () => 2 }] },
    ] })).toThrow(TypeError);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, 30_001])(
    "rejects the resolver timeout %s",
    (resolverTimeoutMs) => {
      expect(() => createWarden({ resolverTimeoutMs })).toThrow(TypeError);
    },
  );

  it("accepts the maximum resolver timeout", () => {
    expect(() => createWarden({ resolverTimeoutMs: 30_000 })).not.toThrow();
  });

  it.each([
    ["replacement", (definition: Record<string, unknown>, rogue: () => boolean) => { definition.evaluate = rogue; }],
    ["deletion and inheritance", (definition: Record<string, unknown>, rogue: () => boolean) => {
      delete definition.evaluate;
      Object.setPrototypeOf(definition, { evaluate: rogue });
    }],
    ["an accessor", (definition: Record<string, unknown>, rogue: () => boolean) => {
      Object.defineProperty(definition, "evaluate", { configurable: true, get: rogue });
    }],
  ])("snapshots condition callbacks before %s mutation", async (_description, mutate) => {
    let rogueInvocations = 0;
    const definition = { name: "condition", evaluate: () => true };
    const warden = createWarden({ extensions: [{ name: "extension", version: "1", conditions: [definition] }] });
    mutate(definition, () => { rogueInvocations += 1; return false; });

    await expect(warden.evaluate(
      { id: "policy", version: 1, rules: [{ id: "rule", effect: "ALLOW", conditions: [{ name: "condition" }] }] },
      { subject: {}, action: {}, resource: {} },
    )).resolves.toMatchObject({ effect: "ALLOW" });
    expect(rogueInvocations).toBe(0);
  });

  it.each([
    ["replacement", (definition: Record<string, unknown>, rogue: () => string) => { definition.resolve = rogue; }],
    ["deletion and inheritance", (definition: Record<string, unknown>, rogue: () => string) => {
      delete definition.resolve;
      Object.setPrototypeOf(definition, { resolve: rogue });
    }],
    ["an accessor", (definition: Record<string, unknown>, rogue: () => string) => {
      Object.defineProperty(definition, "resolve", { configurable: true, get: rogue });
    }],
  ])("snapshots resolver callbacks before %s mutation", async (_description, mutate) => {
    let rogueInvocations = 0;
    const definition = { name: "resolver", resolve: () => "trusted" };
    const warden = createWarden({ extensions: [{
      name: "extension",
      version: "1",
      resolvers: [definition],
      conditions: [{ name: "equals", evaluate: (_request, expected, resolved) => expected === resolved }],
    }] });
    mutate(definition, () => { rogueInvocations += 1; return "rogue"; });

    await expect(warden.evaluate(
      { id: "policy", version: 1, rules: [{ id: "rule", effect: "ALLOW", conditions: [{ name: "resolver:equals", value: "trusted" }] }] },
      { subject: {}, action: {}, resource: {} },
    )).resolves.toMatchObject({ effect: "ALLOW" });
    expect(rogueInvocations).toBe(0);
  });

  it("accepts contract boundaries", () => {
    expect(() => definePolicy({
      id: "a".repeat(128),
      version: 1,
      rules: [{
        id: "rule",
        effect: "ALLOW",
        conditions: Array.from({ length: 64 }, (_, index) => ({ name: `condition.${index}` })),
      }],
    })).not.toThrow();
    expect(() => createWarden({ resolverTimeoutMs: 1 })).not.toThrow();
  });

  it.each(["resolver:", ":condition", "resolver:condition:extra"])(
    "fails closed for the malformed qualified condition name %s",
    async (name) => {
      await expect(createWarden().evaluate(
        { id: "policy", version: 1, rules: [{ id: "rule", effect: "ALLOW", conditions: [{ name }] }] },
        { subject: {}, action: {}, resource: {} },
      )).resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
    },
  );

  it("fails closed when a condition returns a non-boolean", async () => {
    const warden = createWarden({ extensions: [{
      name: "invalid-result",
      version: "1",
      conditions: [{ name: "condition", evaluate: (() => "yes") as never }],
    }] });

    await expect(warden.evaluate(
      { id: "policy", version: 1, rules: [{ id: "rule", effect: "ALLOW", conditions: [{ name: "condition" }] }] },
      { subject: {}, action: {}, resource: {} },
    )).resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
  });

  it("evaluates domain-neutral requests with extension conditions", async () => {
    const warden = createWarden({ extensions: [extension] });
    const policy = definePolicy({
      id: "owner-policy",
      version: 3,
      rules: [{
        id: "allow-owner",
        effect: "ALLOW",
        conditions: [
          { name: "resource.owner", value: "actor-1" },
          { name: "context.notBlocked" },
        ],
      }],
    });

    const decision = await warden.evaluate(policy, {
      subject: { id: "actor-1" },
      action: { type: "document.read" },
      resource: { ownerId: "actor-1", amount: "1.00" },
      context: { blocked: false },
    });

    expect(decision).toMatchObject({
      effect: "ALLOW",
      policyId: "owner-policy",
      policyVersion: 3,
      matchedRules: ["allow-owner"],
    });
  });

  it("uses deny-wins and defaults to deny", async () => {
    const warden = createWarden({ extensions: [extension] });
    const policy = definePolicy({
      id: "deny-wins",
      version: 1,
      rules: [
        { id: "allow", effect: "ALLOW", conditions: [] },
        { id: "deny", effect: "DENY", conditions: [] },
      ],
    });

    const request = { subject: {}, action: {}, resource: {}, context: {} };
    await expect(warden.evaluate(policy, request)).resolves.toMatchObject({
      effect: "DENY",
      matchedRules: ["allow", "deny"],
    });
    await expect(
      warden.evaluate(definePolicy({ id: "none", version: 1, rules: [] }), request),
    ).resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "NO_MATCH" }] });
  });

  it.each(["unknown condition", "condition exception", "resolver timeout"])(
    "fails closed on %s",
    async (scenario) => {
      const failingExtension: WardenExtension = scenario === "condition exception"
        ? { name: "failure", version: "1", conditions: [{ name: "fail", evaluate: () => { throw new Error("boom"); } }] }
        : scenario === "resolver timeout"
          ? { name: "failure", version: "1", resolvers: [{ name: "slow", resolve: () => new Promise(() => undefined) }] }
          : { name: "failure", version: "1" };
      const warden = createWarden({ extensions: [failingExtension], resolverTimeoutMs: 5 });
      const policy = definePolicy({
        id: "failure",
        version: 1,
        rules: [{
          id: "allow",
          effect: "ALLOW",
          conditions: [{ name: scenario === "resolver timeout" ? "slow:value" : scenario === "condition exception" ? "fail" : "missing" }],
        }],
      });

      const decision = await warden.evaluate(policy, { subject: {}, action: {}, resource: {} });
      expect(decision.effect).toBe("DENY");
      expect(decision.reasons[0]?.code).toBe("EVALUATION_ERROR");
    },
  );

  it("rejects duplicate extension condition names", () => {
    expect(() => createWarden({ extensions: [extension, extension] })).toThrow(/duplicate/i);
  });

  it.each([
    ["non-finite numbers", { amount: Number.POSITIVE_INFINITY }],
    ["functions", { callback: () => undefined }],
    ["symbols", { marker: Symbol("unsafe") }],
  ])("fails closed for requests containing %s", async (_description, resource) => {
    const decision = await createWarden().evaluate(
      { id: "unsafe-request", version: 1, rules: [{ id: "allow", effect: "ALLOW", conditions: [] }] },
      { subject: {}, action: {}, resource },
    );

    expect(decision).toMatchObject({
      effect: "DENY",
      reasons: [{ code: "EVALUATION_ERROR" }],
    });
  });

  it("fails closed for cyclic requests without recursing forever", async () => {
    const resource: Record<string, unknown> = {};
    resource.self = resource;

    await expect(createWarden().evaluate(
      { id: "cyclic-request", version: 1, rules: [{ id: "allow", effect: "ALLOW", conditions: [] }] },
      { subject: {}, action: {}, resource },
    )).resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
  });

  it("rejects accessors without invoking their getters", async () => {
    let getterInvocations = 0;
    const resource = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() { getterInvocations += 1; return "secret"; },
    });

    await expect(createWarden().evaluate(
      { id: "accessor-request", version: 1, rules: [{ id: "allow", effect: "ALLOW", conditions: [] }] },
      { subject: {}, action: {}, resource },
    )).resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
    expect(getterInvocations).toBe(0);
  });

  it.each(["__proto__", "prototype", "constructor"])(
    "fails closed for the prototype-pollution key %s",
    async (key) => {
      const resource = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(resource, key, { enumerable: true, value: {} });

      await expect(createWarden().evaluate(
        { id: "pollution-request", version: 1, rules: [{ id: "allow", effect: "ALLOW", conditions: [] }] },
        { subject: {}, action: {}, resource },
      )).resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
    },
  );

  it("fails closed for excessive nesting and oversized strings", async () => {
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 17; depth += 1) nested = { nested };
    const warden = createWarden();
    const policy = { id: "bounded", version: 1, rules: [{ id: "allow", effect: "ALLOW" as const, conditions: [] }] };

    await expect(warden.evaluate(policy, { subject: {}, action: {}, resource: nested }))
      .resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
    await expect(warden.evaluate(policy, { subject: {}, action: {}, resource: "x".repeat(64 * 1024 + 1) }))
      .resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
  });

  it("fails closed for arrays with a hostile custom prototype", async () => {
    const resource: unknown[] = [];
    Object.setPrototypeOf(resource, { hostile: true });

    await expect(createWarden().evaluate(
      { id: "hostile-array", version: 1, rules: [{ id: "allow", effect: "ALLOW", conditions: [] }] },
      { subject: {}, action: {}, resource },
    )).resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
  });

  it("permits the node-limit boundary and fails closed above it", async () => {
    const warden = createWarden();
    const policy = { id: "node-limit", version: 1, rules: [{ id: "allow", effect: "ALLOW" as const, conditions: [] }] };

    await expect(warden.evaluate(
      policy,
      { subject: {}, action: {}, resource: Array(9_995).fill(null) },
    )).resolves.toMatchObject({ effect: "ALLOW" });
    await expect(warden.evaluate(
      policy,
      { subject: {}, action: {}, resource: Array(9_996).fill(null) },
    )).resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
  });

  it("fails closed for unsafe condition values before evaluating conditions", async () => {
    let evaluations = 0;
    const warden = createWarden({ extensions: [{
      name: "safe",
      version: "1",
      conditions: [{ name: "equals", evaluate: () => { evaluations += 1; return true; } }],
    }] });

    await expect(warden.evaluate(
      { id: "unsafe-policy", version: 1, rules: [{ id: "allow", effect: "ALLOW", conditions: [{ name: "equals", value: () => undefined }] }] },
      { subject: {}, action: {}, resource: {} },
    )).resolves.toMatchObject({ effect: "DENY", reasons: [{ code: "EVALUATION_ERROR" }] });
    expect(evaluations).toBe(0);
  });
});
