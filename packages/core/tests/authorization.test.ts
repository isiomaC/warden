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
});
