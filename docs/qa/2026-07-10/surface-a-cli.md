# Surface A — CLI Walkthrough Smoke Suite

Date: 2026-07-10
Status: **PASS** — All spawned and in-process CLI tests pass

## Spawned (process-level) tests

| Command | Test file | Status | Notes |
|---|---|---|---|
| `warden init` | `packages/hook-server/tests/e2e.test.ts` | PASS | Creates config in temp dir with valid hash |
| `warden audit --db` | `packages/hook-server/tests/e2e.test.ts` | PASS | Pre-seeds SQLite, verifies entries |
| `warden start` (missing config) | `packages/hook-server/tests/e2e.test.ts` | PASS | Exits 1 correctly |
| `warden start` (binds port, /health) | `packages/hook-server/tests/e2e.test.ts` | PASS | Real TCP smoke test, curls /health |
| `warden proxy` | `packages/cli/tests/proxy.test.ts` | PASS | Spawned JSON-RPC, tools/list + tools/call |

## In-process tests (skip citty argv parsing)

| Command | Test file | Status | Notes |
|---|---|---|---|
| `warden policy` | `packages/hook-server/tests/e2e.test.ts` | PASS | Spawned smoke test added 2026-07-10 |
| `warden scan` | `packages/hook-server/tests/e2e.test.ts` | PASS | Spawned smoke tests (injection + clean) added 2026-07-10 |
| `warden reset` | `packages/hook-server/tests/e2e.test.ts` | PASS | Spawned smoke test added 2026-07-10 |
| `warden config-validate` | `packages/hook-server/tests/e2e.test.ts` | PASS | Spawned smoke test added 2026-07-10 |
| `warden supply-chain` | `packages/hook-server/tests/e2e.test.ts` | PASS | Spawned smoke test added 2026-07-10 |
| `warden init` (programmatic) | `packages/cli/tests/init.test.ts` | PASS (5 tests) | |

## Gap

`policy`, `scan`, `reset`, `config-validate`, `supply-chain` only tested in-process (`command.run()`). citty's argv→object parsing layer is untested for these commands. Low priority — real command logic is exercised.

## Raw logs

Captured in `npm test` output (see Surface E).
