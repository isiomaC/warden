import { isIP } from "node:net";

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  return isIP(host) === 4 && Number(host.split(".")[0]) === 127;
}

export function assertSafeBindHost(host: string, authToken?: string): void {
  if (!isLoopbackHost(host) && !authToken) {
    throw new Error("WARDEN_AUTH_TOKEN is required when binding Warden to a non-loopback host.");
  }
}
