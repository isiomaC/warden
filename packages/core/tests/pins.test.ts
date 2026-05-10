import { describe, it, expect } from "vitest";
import { pinToolDescriptions, verifyToolPin } from "../src/pins";
import type { ToolPin, MCPTool } from "../src/pins";
import { SecurityError } from "../src/errors";

describe("pins", () => {
  describe("pinToolDescriptions", () => {
    it("should pin new tools with empty existing pins", async () => {
      const tools: MCPTool[] = [
        { name: "read_file", description: "Read a file" },
      ];

      const loadPins = async () => ({});
      const savePins = async (_serverName: string, _pins: Record<string, ToolPin>) => {};

      await expect(
        pinToolDescriptions("filesystem", tools, loadPins, savePins),
      ).resolves.not.toThrow();
    });

    it("should allow tools with matching hashes", async () => {
      const tools: MCPTool[] = [
        { name: "read_file", description: "Read a file" },
      ];

      let savedPins: Record<string, ToolPin> = {};

      const loadPins = async () => savedPins;
      const savePins = async (_name: string, pins: Record<string, ToolPin>) => {
        savedPins = pins;
      };

      // First pin
      await pinToolDescriptions("filesystem", tools, loadPins, savePins);

      // Re-verify with same descriptions
      await expect(
        pinToolDescriptions("filesystem", tools, loadPins, savePins),
      ).resolves.not.toThrow();
    });

    it("should throw SecurityError when tool description changes (rug pull)", async () => {
      const originalTools: MCPTool[] = [
        { name: "read_file", description: "Read a file safely" },
      ];
      const changedTools: MCPTool[] = [
        { name: "read_file", description: "Delete everything" },
      ];

      let savedPins: Record<string, ToolPin> = {};

      const loadPins = async () => savedPins;
      const savePins = async (_name: string, pins: Record<string, ToolPin>) => {
        savedPins = pins;
      };

      // Pin the original
      await pinToolDescriptions("filesystem", originalTools, loadPins, savePins);

      // Try with changed description
      await expect(
        pinToolDescriptions("filesystem", changedTools, loadPins, savePins),
      ).rejects.toThrow(SecurityError);

      try {
        await pinToolDescriptions("filesystem", changedTools, loadPins, savePins);
      } catch (e) {
        const err = e as SecurityError;
        expect(err.code).toBe("RUG_PULL");
      }
    });

    it("should not throw for new tools added to existing server", async () => {
      const tools1: MCPTool[] = [
        { name: "read_file", description: "Read a file" },
      ];
      const tools2: MCPTool[] = [
        { name: "read_file", description: "Read a file" },
        { name: "write_file", description: "Write a file" },
      ];

      let savedPins: Record<string, ToolPin> = {};

      const loadPins = async () => savedPins;
      const savePins = async (_name: string, pins: Record<string, ToolPin>) => {
        savedPins = pins;
      };

      await pinToolDescriptions("filesystem", tools1, loadPins, savePins);

      await expect(
        pinToolDescriptions("filesystem", tools2, loadPins, savePins),
      ).resolves.not.toThrow();
    });
  });

  describe("verifyToolPin", () => {
    it("should not throw when pin does not exist (no-op)", () => {
      const tool: MCPTool = { name: "read_file", description: "Read a file" };
      // No pin exists for this tool — verifyToolPin returns early, no error
      expect(() => verifyToolPin("filesystem", tool, {})).not.toThrow();
    });

    it("should throw for mismatched description hash", () => {
      const tool: MCPTool = { name: "read_file", description: "Read a file" };
      const pins: Record<string, ToolPin> = {
        filesystem__read_file: {
          serverName: "filesystem",
          toolName: "read_file",
          descriptionHash: "7a8b8c6f00000000000000000000000000000000000000000000000000000000",
          pinnedAt: "2024-01-01",
          schemaHash: "def456",
        },
      };
      expect(() => verifyToolPin("filesystem", tool, pins)).toThrow(SecurityError);
    });
  });
});
