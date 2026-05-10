import { describe, it, expect } from "vitest";
import { tagValue, TrustLevel, canPromote, lowestTrust } from "../src/trust";

describe("trust", () => {
  describe("tagValue", () => {
    it("should tag system prompt as SYSTEM trust", () => {
      const tagged = tagValue("hello", "system_prompt", "task_1");
      expect(tagged.trust).toBe(TrustLevel.SYSTEM);
    });

    it("should tag warden_config as SYSTEM trust", () => {
      const tagged = tagValue("config", "warden_config", "task_1");
      expect(tagged.trust).toBe(TrustLevel.SYSTEM);
    });

    it("should tag MCP tools as TOOL trust", () => {
      const tagged = tagValue("output", "mcp__filesystem__read_file", "task_1");
      expect(tagged.trust).toBe(TrustLevel.TOOL);
    });

    it("should tag unknown sources as EXTERNAL trust", () => {
      const tagged = tagValue("web content", "web_scrape", "task_1");
      expect(tagged.trust).toBe(TrustLevel.EXTERNAL);
    });

    it("should include a SHA-256 hash of the value", () => {
      const tagged = tagValue("test", "system_prompt", "task_1");
      expect(tagged.hash).toBeTruthy();
      expect(tagged.hash.length).toBe(64);
    });

    it("should include taskId and timestamp", () => {
      const tagged = tagValue("test", "system_prompt", "task_abc123");
      expect(tagged.taskId).toBe("task_abc123");
      expect(tagged.timestamp).toBeTruthy();
    });
  });

  describe("canPromote", () => {
    it("should allow promotion from SYSTEM to AGENT (downward)", () => {
      expect(canPromote(TrustLevel.SYSTEM, TrustLevel.AGENT)).toBe(true);
    });

    it("should block promotion from EXTERNAL to TOOL (upward)", () => {
      expect(canPromote(TrustLevel.EXTERNAL, TrustLevel.TOOL)).toBe(false);
    });

    it("should allow same-level", () => {
      expect(canPromote(TrustLevel.TOOL, TrustLevel.TOOL)).toBe(true);
    });
  });

  describe("lowestTrust", () => {
    it("should return SYSTEM for empty array", () => {
      expect(lowestTrust([])).toBe(TrustLevel.SYSTEM);
    });

    it("should return the lowest trust level", () => {
      const values = [
        tagValue("a", "system_prompt", "t"),
        tagValue("b", "mcp__tool", "t"),
        tagValue("c", "web", "t"),
      ];
      expect(lowestTrust(values)).toBe(TrustLevel.EXTERNAL);
    });
  });
});
