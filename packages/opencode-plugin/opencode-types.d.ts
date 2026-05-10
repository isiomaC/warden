// Type declarations for OpenCode plugin runtime.
// These types are provided by OpenCode at runtime when the plugin is loaded.
// Not installed as a project dependency — the plugin runs inside OpenCode's process.

declare module "@opencode-ai/plugin" {
  export interface PluginContext {
    project: { root: string; name: string };
    client: unknown;
    $: unknown;
    directory: string;
    worktree: string;
  }

  export type Plugin = (ctx: PluginContext) => Promise<PluginHooks>;

  export interface PluginHooks {
    event?: (input: { event: { type: string } }) => void;
    "tool.execute.before"?: (input: { tool: string; args: Record<string, unknown> }) => void;
    "tool.execute.after"?: (input: { tool: string; result: unknown }) => void;
    "tui.prompt.append"?: (input: { text: string }) => void;
    "permission.asked"?: (input: { tool: string; args: Record<string, unknown> }) => { allowed: boolean; reason?: string } | void;
  }
}
