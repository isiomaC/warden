import { describe, expect, it } from "vitest";
import {
  createWarden,
  definePolicy,
  type AuthorizationPolicy,
  type DecisionEffect,
  type EvaluationRequest,
  type WardenExtension,
} from "../src/authorization";
import {
  evaluate,
  type EvaluateInput,
  type PolicyAction,
  type PolicyConfig,
} from "../src/policy";

const legacyPolicy: PolicyConfig = {
  version: "1",
  meta: {
    environment: "test",
    sessionApprovalRequired: false,
  },
  policies: [
    {
      id: "allow-read-file",
      description: "Allow non-destructive reads",
      match: { tools: ["read_file"] },
      action: "ALLOW",
    },
    {
      id: "deny-delete-file",
      description: "Deny destructive deletes",
      match: { tools: ["delete_file"] },
      action: "DENY",
    },
  ],
};

const genericPolicy: AuthorizationPolicy = definePolicy({
  id: "tool-policy",
  version: 1,
  rules: [
    {
      id: "allow-read-file",
      effect: "ALLOW",
      conditions: [{ name: "action.toolName", value: "read_file" }],
    },
    {
      id: "deny-delete-file",
      effect: "DENY",
      conditions: [{ name: "action.toolName", value: "delete_file" }],
    },
  ],
});

const toolExtension: WardenExtension = {
  name: "tool-compatibility",
  version: "1.0.0",
  conditions: [
    {
      name: "action.toolName",
      evaluate: (request, expected) => request.action === expected,
    },
  ],
};

const warden = createWarden({ extensions: [toolExtension] });

function legacyInput(toolName: string): EvaluateInput {
  return {
    toolName,
    toolInput: {},
    environment: "test",
    trustSources: [],
    serverInAllowlist: true,
  };
}

function genericRequest(toolName: string): EvaluationRequest {
  return {
    subject: { id: "compatibility-test" },
    action: toolName,
    resource: {},
  };
}

function genericEffect(action: PolicyAction): DecisionEffect | "QUARANTINE" {
  switch (action) {
    case "ALLOW":
    case "DENY":
      return action;
    case "CONFIRM":
      return "PENDING_APPROVAL";
    case "QUARANTINE":
      return "QUARANTINE";
  }
}

describe("legacy and generic policy compatibility", () => {
  it.each([
    ["read_file", "ALLOW"],
    ["delete_file", "DENY"],
    ["unknown_tool", "DENY"],
  ] as const)("returns %s => %s on both policy surfaces", async (toolName, expected) => {
    const legacyDecision = evaluate(legacyPolicy, legacyInput(toolName));
    const genericDecision = await warden.evaluate(genericPolicy, genericRequest(toolName));

    expect(genericEffect(legacyDecision.action)).toBe(expected);
    expect(genericDecision.effect).toBe(expected);
  });

  it("uses deny-wins when multiple legacy rules match", () => {
    const policy: PolicyConfig = {
      ...legacyPolicy,
      policies: [
        {
          id: "allow-delete",
          description: "Broad compatibility allowance",
          match: { tools: ["delete_file"] },
          action: "ALLOW",
        },
        {
          id: "deny-delete",
          description: "Destructive-operation guard",
          match: { tools: ["delete_file"] },
          action: "DENY",
        },
      ],
    };

    expect(evaluate(policy, legacyInput("delete_file")).action).toBe("DENY");
  });

  it("uses deny-wins when multiple generic rules match", async () => {
    const policy = definePolicy({
      id: "generic-deny-wins",
      version: 1,
      rules: [
        {
          id: "allow-delete",
          effect: "ALLOW",
          conditions: [{ name: "action.toolName", value: "delete_file" }],
        },
        {
          id: "deny-delete",
          effect: "DENY",
          conditions: [{ name: "action.toolName", value: "delete_file" }],
        },
      ],
    });

    await expect(warden.evaluate(policy, genericRequest("delete_file"))).resolves.toMatchObject({
      effect: "DENY",
      matchedRules: ["allow-delete", "deny-delete"],
    });
  });

  it("defaults to deny when no legacy rule matches", () => {
    expect(evaluate(legacyPolicy, legacyInput("unknown_tool"))).toMatchObject({
      action: "DENY",
      reason: "No matching policy rule. Default deny.",
    });
  });

  it("defaults to deny when no generic rule matches", async () => {
    await expect(warden.evaluate(genericPolicy, genericRequest("unknown_tool"))).resolves.toMatchObject({
      effect: "DENY",
      matchedRules: [],
      reasons: [{ code: "NO_MATCH" }],
    });
  });
});
