import * as readline from "node:readline";

export interface ApprovalRequest {
  tool: string;
  input: unknown;
  reason: string;
  timeoutMs: number;
}

export interface ApprovalChannel {
  request(req: ApprovalRequest): Promise<boolean>;
}

export interface HookResponse {
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: "allow" | "deny" | "block";
    permissionDecisionReason: string;
    errorCode?: string;
    sessionToken?: string;
    taskId?: string;
    trustLevel?: number;
    source?: string;
  };
}

export class StdoutApprovalChannel implements ApprovalChannel {
  async request(req: ApprovalRequest): Promise<boolean> {
    const timeoutMs = Math.min(req.timeoutMs, 60_000);

    process.stdout.write(`\n[WARDEN CONFIRM] Tool: ${req.tool}\n`);
    process.stdout.write(`[WARDEN CONFIRM] Reason: ${req.reason}\n`);
    process.stdout.write(`[WARDEN CONFIRM] Input: ${JSON.stringify(req.input)}\n`);

    return new Promise<boolean>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const timer = setTimeout(() => {
        rl.close();
        process.stdout.write("\n[WARDEN CONFIRM] Timed out. Denying.\n");
        resolve(false);
      }, timeoutMs);

      rl.question("[WARDEN CONFIRM] Allow? (y/N): ", (answer: string) => {
        clearTimeout(timer);
        rl.close();
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === "y" || normalized === "yes");
      });
    });
  }
}

export class TimeoutApprovalChannel implements ApprovalChannel {
  async request(req: ApprovalRequest): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, Math.min(req.timeoutMs, 60_000));
    });
  }
}
