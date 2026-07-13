# Surface E — Core Unit & Integration Tests

Date: 2026-07-10
Status: PASS (30/30 files, 359/359 tests)

## Run Results

```
Test Files  30 passed (30)
     Tests  359 passed (359)
  Duration  36.78s
```

| Package | Tests | Status |
|---|---|---|
| packages/core/tests/rate-limiter | 18 | PASS |
| packages/core/tests/ledger | 15 | PASS |
| packages/opencode-plugin/tests/plugin | 17 | PASS |
| packages/mcp-gateway/tests/gateway | 25 | PASS |
| packages/hook-server/tests/approvals | 23 | PASS |
| packages/hook-server/tests/integration | 56 | PASS |
| packages/core/tests/policy | 12 | PASS |
| packages/core/tests/config-source | 8 | PASS |
| packages/cli/tests/config-validate | 5 | PASS |
| packages/core/tests/context | 13 | PASS |
| packages/core/tests/logger | 14 | PASS |
| packages/cli/tests/supply-chain | 4 | PASS |
| packages/core/tests/vault | 9 | PASS |
| packages/cli/tests/init | 5 | PASS |
| packages/cli/tests/reset | 5 | PASS |
| packages/cli/tests/policy | 7 | PASS |
| packages/core/tests/supply-chain | 6 | PASS |
| packages/core/tests/scanner | 13 | PASS |
| packages/core/tests/sqlite-ledger | 6 | PASS |
| packages/cli/tests/scan | 6 | PASS |
| packages/core/tests/redact | 10 | PASS |
| packages/core/tests/trust-registry | 8 | PASS |
| packages/core/tests/paths | 14 | PASS |
| packages/hook-server/tests/shared-secret | 6 | PASS |
| packages/core/tests/trust | 11 | PASS |
| packages/hook-server/tests/fail-closed | 7 | PASS |
| packages/core/tests/id | 3 | PASS |
| packages/cli/tests/proxy | 3 | PASS |
| packages/hook-server/tests/e2e | 24 | PASS |
| packages/core/tests/pins | 6 | PASS |

## Coverage Thresholds Met

- Core: N/A (not measured this run, target >=85%)
- Elsewhere: N/A (target >=78%)

## Notes

- All spawned CLI smoke tests pass (init, audit, start)
- MCP proxy tests pass (spawned, JSON-RPC over stdin)
- Performance benchmarks pass (1000 sequential calls <10s)

## Raw logs

Captured in `npm test` output above.
