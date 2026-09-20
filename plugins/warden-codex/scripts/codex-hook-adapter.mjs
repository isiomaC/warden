import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const unavailable = {
  permissionDecision: "deny",
  permissionDecisionReason: "Warden: policy enforcement unavailable; action denied.",
};

const endpoints = {
  SessionStart: "/hooks/session-start",
  PreToolUse: "/hooks/pre-tool-use",
  PostToolUse: "/hooks/post-tool-use",
  UserPromptSubmit: "/hooks/prompt-submit",
  SessionEnd: "/hooks/session-end",
};

function statePath(stateDir, sessionId) {
  return join(stateDir, `${basename(sessionId)}.json`);
}

async function loadToken(stateDir, sessionId) {
  const state = JSON.parse(await readFile(statePath(stateDir, sessionId), "utf8"));
  if (typeof state.token !== "string" || state.token.length === 0) throw new Error("missing token");
  return state.token;
}

async function saveToken(stateDir, sessionId, token) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = statePath(stateDir, sessionId);
  await writeFile(path, JSON.stringify({ token }), { mode: 0o600 });
  await chmod(path, 0o600);
}

function payload(input) {
  return {
    session_id: input.session_id,
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    tool_output: input.tool_output,
    prompt: input.prompt,
    allowedTools: input.allowed_tools ?? input.allowedTools,
    environment: input.environment ?? "development",
  };
}

export async function handleHook(input, dependencies = {}) {
  const event = input?.hook_event_name ?? input?.hookEventName;
  const endpoint = endpoints[event];
  const stateDir = dependencies.stateDir ?? process.env.WARDEN_CODEX_STATE_DIR ?? process.env.PLUGIN_DATA ?? join(process.cwd(), ".warden", "codex");
  const baseUrl = dependencies.baseUrl ?? process.env.WARDEN_HOOK_URL ?? "http://127.0.0.1:7429";
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  if (!endpoint || typeof input?.session_id !== "string") return event === "PreToolUse" ? unavailable : {};
  if (event === "PreToolUse" && (typeof input.tool_name !== "string" || !input.tool_input || typeof input.tool_input !== "object")) return unavailable;

  try {
    let token;
    if (event !== "SessionStart") token = await loadToken(stateDir, input.session_id);
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token ?? "codex-session"}`,
      },
      body: JSON.stringify(payload(input)),
    });
    if (!response.ok) throw new Error(`Warden returned ${response.status}`);
    const result = await response.json();
    const output = result?.hookSpecificOutput;
    if (!output || (event === "PreToolUse" && !["allow", "deny"].includes(output.permissionDecision))) throw new Error("invalid Warden response");
    if (event === "SessionStart") {
      if (typeof output.sessionToken !== "string") throw new Error("missing session token");
      await saveToken(stateDir, input.session_id, output.sessionToken);
    }
    if (event === "SessionEnd") await rm(statePath(stateDir, input.session_id), { force: true });
    return {
      ...(typeof output.permissionDecision === "string" ? { permissionDecision: output.permissionDecision } : {}),
      ...(typeof output.permissionDecisionReason === "string" ? { permissionDecisionReason: output.permissionDecisionReason } : {}),
    };
  } catch {
    return event === "PreToolUse" ? unavailable : {};
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const result = await handleHook(JSON.parse(raw));
  process.stdout.write(JSON.stringify(result));
}
