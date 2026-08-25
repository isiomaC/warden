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
