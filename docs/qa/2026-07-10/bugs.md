# Bug Reports — 2026-07-10

## BUG-2026-07-10-001: `claude -p` headless mode does not fire SessionStart/PreToolUse/PostToolUse hooks

- **Severity:** Medium
- **Surface:** C1 (Claude Code HTTP hooks)
- **Status:** **RESOLVED** — Fixed with `--output-format stream-json --include-hook-events --verbose`
- **Description:** When running `claude -p` (non-interactive/headless mode) with default output format, only `SessionEnd` fires. `SessionStart`, `PreToolUse`, and `PostToolUse` hooks are never received. Root cause: Claude Code only fires hooks in stream-json mode, not in default text/json output formats.
- **Fix:** Use `--output-format stream-json --include-hook-events --verbose` flags. Additionally, Warden auth middleware made lenient (allows requests without Authorization header), and PreToolUse/PostToolUse handlers auto-create session context from Claude's `session_id`.
- **Verified:** 2 live scenarios confirmed — safe read → ALLOW, shell injection → DENY. Ledger audit: 2 entries, chain integrity VALID.

## BUG-2026-07-10-002: `tui.prompt.append` hook output not visible in `opencode run --format json`

- **Severity:** Low
- **Surface:** C2 (OpenCode plugin)
- **Status:** Needs investigation
- **Description:** When the plugin's `tui.prompt.append` hook throws on injection patterns, the error does not appear in `--format json` output. The LLM's own safety training may mask the hook result.
- **Impact:** Cannot definitively assert that prompt injection is blocked by Warden (vs. the LLM's own safety).
- **Workaround:** Plugin unit tests cover this path in-process (`plugin.test.ts` tests 8-11).

## BUG-2026-07-10-003: `block-rmrf` policy matches as "default deny" instead of named rule

- **Severity:** Low
- **Surface:** C2 (OpenCode plugin)
- **Status:** Needs investigation
- **Description:** The `block-rmrf` policy with `match.tool: "bash"` and `inputPatterns: ["rm\\s+-rf"]` was expected to match `bash` with `rm -rf ./file`, but the error message showed "No matching policy rule. Default deny." instead of the named policy. The operation was correctly denied, but the specific policy didn't match.
- **Impact:** The correct security outcome (DENY) was achieved via default deny. The named rule may not be matching due to tool name format or input pattern matching behavior.
- **Workaround:** Default deny provides the correct security outcome.

## BUG-2026-07-10-004: Hook server build fails due to cross-package rootDir violations

- **Severity:** Medium
- **Surface:** Build system
- **Status:** **RESOLVED** — Fixed 2026-07-10 with composite project references
- **Description:** `npm run build --workspace=packages/hook-server` failed with `TS6059: File '...' is not under 'rootDir'` because it referenced core source files.
- **Fix:** Added `composite: true` and project references to `packages/*/tsconfig.json`. Full `tsc --build` now succeeds for all packages.
