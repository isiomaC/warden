import { ulid } from "ulid";
import type { TrustLevel } from "./trust";

export interface TaskContext {
  taskId: string;
  sessionId: string;
  startedAt: string;
  expiresAt: string;
  trustBudget: Map<string, TrustLevel>;
  toolCallCount: number;
  mcpServersContacted: Set<string>;
}

export interface WardenConfig {
  threatDetection: {
    lateralMovement: {
      enabled: boolean;
      maxMCPServersPerTaskChain: number;
      alertAction: "CONFIRM" | "DENY";
    };
  };
}

export class ContextManager {
  private contexts = new Map<string, TaskContext>();

  createTask(sessionId: string, ttlMinutes = 30): TaskContext {
    const taskId = ulid();
    const now = new Date();
    const ctx: TaskContext = {
      taskId,
      sessionId,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
      trustBudget: new Map(),
      toolCallCount: 0,
      mcpServersContacted: new Set(),
    };
    this.contexts.set(taskId, ctx);
    return ctx;
  }

  getTask(taskId: string): TaskContext | undefined {
    const ctx = this.contexts.get(taskId);
    if (!ctx) return undefined;

    if (new Date() > new Date(ctx.expiresAt)) {
      this.contexts.delete(taskId);
      return undefined;
    }

    return ctx;
  }

  recordToolCall(taskId: string, serverName: string): void {
    const ctx = this.getTask(taskId);
    if (!ctx) return;
    ctx.toolCallCount++;
    ctx.mcpServersContacted.add(serverName);
  }

  checkLateralMovement(taskId: string, config: WardenConfig): boolean {
    const ctx = this.getTask(taskId);
    if (!ctx) return false;
    if (!config.threatDetection.lateralMovement.enabled) return false;
    return (
      ctx.mcpServersContacted.size >
      config.threatDetection.lateralMovement.maxMCPServersPerTaskChain
    );
  }

  expireTask(taskId: string): void {
    this.contexts.delete(taskId);
  }

  expireAllForSession(sessionId: string): void {
    for (const [id, ctx] of this.contexts) {
      if (ctx.sessionId === sessionId) {
        this.contexts.delete(id);
      }
    }
  }
}
