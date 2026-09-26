import type { DemoResult } from "./console-phase-0.js";

export interface SideshowSurface {
  kind: "markdown" | "json";
  content: string | unknown;
}

export interface SideshowPost {
  title: string;
  surfaces: SideshowSurface[];
}

export function toSideshowPost(result: DemoResult): SideshowPost {
  const timeline = result.steps.map((step, index) => {
    const approval = step.approval ? `; approval ${step.approval}` : "";
    return `${index + 1}. **${step.decision}** — ${step.title} (${step.matchedRules.join(", ")}${approval})`;
  }).join("\n");

  return {
    title: "Warden Console Phase 0",
    surfaces: [
      {
        kind: "markdown",
        content: `# Warden policy evidence\n\n${timeline}\n\n` +
          "**Deny wins:** the second decision matches both an allow and a deny rule; Warden returns DENY.\n\n" +
          "MCP tools routed through Warden are governed. Native tools remain outside this MCP proxy unless a separately verified integration exists. In other words, native tools are not covered by this demo's MCP proxy.",
      },
      { kind: "json", content: { chain: result.chain, entries: result.audit.entries } },
      { kind: "json", content: { formatVersion: 1, audit: result.audit } },
    ],
  };
}
