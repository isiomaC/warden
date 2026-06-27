import { describe, it, expect, beforeEach } from "vitest";
import { ContextManager } from "../src/context";
import type { WardenConfig } from "../src/context";

describe("ContextManager", () => {
  let ctx: ContextManager;

  beforeEach(() => {
    ctx = new ContextManager();
  });

  describe("createTask", () => {
    it("should create a task with a unique ID", () => {
      const task = ctx.createTask("session_1");
      expect(task.taskId).toBeTruthy();
      expect(task.sessionId).toBe("session_1");
      expect(task.toolCallCount).toBe(0);
      expect(task.mcpServersContacted.size).toBe(0);
    });
  });

  describe("getTask", () => {
    it("should return the task by ID", () => {
      const task = ctx.createTask("session_1");
      const found = ctx.getTask(task.taskId);
      expect(found?.taskId).toBe(task.taskId);
    });

    it("should return undefined for unknown ID", () => {
      expect(ctx.getTask("unknown")).toBeUndefined();
    });
  });

  describe("recordToolCall", () => {
    it("should increment tool call count", () => {
      const task = ctx.createTask("session_1");
      ctx.recordToolCall(task.taskId, "filesystem");
      ctx.recordToolCall(task.taskId, "filesystem");
      const found = ctx.getTask(task.taskId);
      expect(found?.toolCallCount).toBe(2);
    });

    it("should track unique servers contacted", () => {
      const task = ctx.createTask("session_1");
      ctx.recordToolCall(task.taskId, "filesystem");
      ctx.recordToolCall(task.taskId, "github");
      ctx.recordToolCall(task.taskId, "postgres");
      const found = ctx.getTask(task.taskId);
      expect(found?.mcpServersContacted.size).toBe(3);
    });
  });

  describe("checkLateralMovement", () => {
    it("should detect lateral movement when exceeding max servers", () => {
      const config: WardenConfig = {
        threatDetection: {
          lateralMovement: {
            enabled: true,
            maxMCPServersPerTaskChain: 2,
            alertAction: "DENY",
          },
        },
      };

      const task = ctx.createTask("session_1");
      ctx.recordToolCall(task.taskId, "filesystem");
      ctx.recordToolCall(task.taskId, "github");
      ctx.recordToolCall(task.taskId, "postgres"); // 3 > 2

      expect(ctx.checkLateralMovement(task.taskId, config)).toBe(true);
    });

    it("should not detect lateral movement when under max", () => {
      const config: WardenConfig = {
        threatDetection: {
          lateralMovement: {
            enabled: true,
            maxMCPServersPerTaskChain: 5,
            alertAction: "DENY",
          },
        },
      };

      const task = ctx.createTask("session_1");
      ctx.recordToolCall(task.taskId, "filesystem");
      ctx.recordToolCall(task.taskId, "github");

      expect(ctx.checkLateralMovement(task.taskId, config)).toBe(false);
    });

    it("should return false when disabled", () => {
      const config: WardenConfig = {
        threatDetection: {
          lateralMovement: {
            enabled: false,
            maxMCPServersPerTaskChain: 0,
            alertAction: "DENY",
          },
        },
      };

      const task = ctx.createTask("session_1");
      ctx.recordToolCall(task.taskId, "filesystem");
      ctx.recordToolCall(task.taskId, "github");
      ctx.recordToolCall(task.taskId, "postgres");

      expect(ctx.checkLateralMovement(task.taskId, config)).toBe(false);
    });
  });

  describe("expireTask", () => {
    it("should remove task from context", () => {
      const task = ctx.createTask("session_1");
      ctx.expireTask(task.taskId);
      expect(ctx.getTask(task.taskId)).toBeUndefined();
    });
  });

  describe("expireAllForSession", () => {
    it("should remove all tasks for a session", () => {
      ctx.createTask("session_a");
      ctx.createTask("session_a");
      const taskB = ctx.createTask("session_b");

      ctx.expireAllForSession("session_a");

      // Session B task should still exist by its taskId
      expect(ctx.getTask(taskB.taskId)).toBeDefined();
    });
  });

  describe("listActiveTasks", () => {
    it("should return empty when no tasks exist", () => {
      expect(ctx.listActiveTasks()).toEqual([]);
    });

    it("should return active tasks", () => {
      ctx.createTask("session_a");
      ctx.createTask("session_b");
      const tasks = ctx.listActiveTasks();
      expect(tasks.length).toBe(2);
    });

    it("should not return expired tasks", () => {
      const task = ctx.createTask("session_a", -1); // TTL -1 = already expired
      const tasks = ctx.listActiveTasks();
      expect(tasks.find((t) => t.taskId === task.taskId)).toBeUndefined();
    });
  });
});
