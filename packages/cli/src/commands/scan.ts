import { defineCommand } from "citty";
import { scanForInjection, TrustLevel } from "@warden/core";

export const scanCommand = defineCommand({
  meta: {
    name: "scan",
    description: "Scan a prompt for injection patterns",
  },
  args: {
    prompt: {
      type: "string",
      description: "Prompt text to scan",
      required: true,
    },
    trust: {
      type: "string",
      description: "Trust level (SYSTEM, AGENT, TOOL, EXTERNAL)",
      default: "EXTERNAL",
    },
  },
  async run({ args }) {
    const trustMap: Record<string, TrustLevel> = {
      SYSTEM: TrustLevel.SYSTEM,
      AGENT: TrustLevel.AGENT,
      TOOL: TrustLevel.TOOL,
      EXTERNAL: TrustLevel.EXTERNAL,
    };

    const normalizedTrust = args.trust.toUpperCase();
    if (!(normalizedTrust in trustMap)) {
      process.stderr.write(
        `Warden: invalid --trust "${args.trust}". Expected one of: ${Object.keys(trustMap).join(", ")}\n`,
      );
      process.exit(1);
    }
    const trust: TrustLevel = trustMap[normalizedTrust];

    const result = scanForInjection(args.prompt, trust);

    process.stdout.write(`
=== Injection Scan ===

Prompt:    "${args.prompt.slice(0, 80)}${args.prompt.length > 80 ? "..." : ""}"
Trust:     ${args.trust.toUpperCase()}
Clean:     ${result.clean ? "YES" : "NO (DETECTED)"}
${!result.clean ? `Patterns:  ${result.patterns?.join(", ")}` : ""}
${!result.clean ? `Recommend: ${result.recommendation}` : ""}
`);
  },
});
