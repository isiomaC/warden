export interface ApprovalRequest {
  tool: string;
  input: unknown;
  reason: string;
  timeoutMs: number;
}

export interface ApprovalChannel {
  request(req: ApprovalRequest): Promise<boolean>;
}

export class StdoutApprovalChannel implements ApprovalChannel {
  async request(req: ApprovalRequest): Promise<boolean> {
    process.stdout.write(`\n[WARDEN CONFIRM] Tool: ${req.tool}\n`);
    process.stdout.write(`[WARDEN CONFIRM] Reason: ${req.reason}\n`);
    process.stdout.write(`[WARDEN CONFIRM] Input: ${JSON.stringify(req.input)}\n`);
    process.stdout.write(`[WARDEN CONFIRM] Timeout: ${req.timeoutMs}ms\n`);
    process.stdout.write(`[WARDEN CONFIRM] Auto-allowing in stdout mode...\n\n`);
    return true;
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
