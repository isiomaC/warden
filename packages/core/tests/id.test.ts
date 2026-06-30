import { describe, it, expect } from "vitest";
import { generateId } from "../src/id";

describe("generateId", () => {
  it("should prefix the generated id", () => {
    const id = generateId("ledger");
    expect(id.startsWith("ledger_")).toBe(true);
  });

  it("should produce a 26-character ULID after the prefix", () => {
    const id = generateId("err");
    const ulidPart = id.slice("err_".length);
    expect(ulidPart).toHaveLength(26);
  });

  it("should not collide across rapid successive calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId("x")));
    expect(ids.size).toBe(1000);
  });
});
