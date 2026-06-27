import type { ContextStore, PolicyConfig } from "@wardenlabs/core";

export interface LateralDetectionResult {
  shouldBlock: boolean;
  alertAction: "CONFIRM" | "DENY";
  serversContacted: number;
  maxAllowed: number;
}

export function checkLateralMovement(
  taskId: string,
  contextManager: ContextStore,
  config: PolicyConfig & {
    threatDetection: {
      lateralMovement: {
        enabled: boolean;
        maxMCPServersPerTaskChain: number;
        alertAction: "CONFIRM" | "DENY";
      };
    };
  },
): LateralDetectionResult {
  const ctx = contextManager.getTask(taskId);
  if (!ctx) {
    return { shouldBlock: false, alertAction: "DENY", serversContacted: 0, maxAllowed: 0 };
  }

  if (!config.threatDetection.lateralMovement.enabled) {
    return { shouldBlock: false, alertAction: "CONFIRM", serversContacted: 0, maxAllowed: 0 };
  }

  const max = config.threatDetection.lateralMovement.maxMCPServersPerTaskChain;
  const contacted = ctx.mcpServersContacted.size;

  if (contacted > max) {
    return {
      shouldBlock: true,
      alertAction: config.threatDetection.lateralMovement.alertAction,
      serversContacted: contacted,
      maxAllowed: max,
    };
  }

  return { shouldBlock: false, alertAction: "CONFIRM", serversContacted: contacted, maxAllowed: max };
}
