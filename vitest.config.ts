import { defineConfig } from "vitest/config";
import { resolve } from "path";

const __dirname = new URL(".", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "@warden/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@warden/hook-server": resolve(__dirname, "packages/hook-server/src/server.ts"),
      "@warden/mcp-gateway": resolve(__dirname, "packages/mcp-gateway/src/gateway.ts"),
      "@warden/cli": resolve(__dirname, "packages/cli/src/index.ts"),
      "@warden/opencode-plugin": resolve(__dirname, "packages/opencode-plugin/warden-plugin.ts"),
    },
  },
  test: {
    globals: true,
    include: ["packages/**/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/**/src/**/*.ts"],
      // CLI commands that spawn a real subprocess in their own tests (audit,
      // start, proxy — see packages/cli/tests/ and hook-server e2e.test.ts)
      // report 0% here even though they're exercised: v8's coverage
      // instrumentation only sees the vitest process itself, not child
      // processes spawned by it. Excluded so they don't distort the
      // thresholds below with a false "untested" signal; bin.ts/index.ts are
      // trivial re-exports/entrypoints with no branching logic to protect.
      exclude: [
        // The include glob (packages/**/src/**/*.ts) matches "*.ts" as a
        // suffix, so it also matches compiled "*.d.ts" declaration files
        // under a package's dist/ output whenever a build has been run —
        // exclude those explicitly so stale build artifacts don't get
        // counted as untested source and distort the percentages below.
        "**/dist/**",
        "packages/cli/src/bin.ts",
        "packages/cli/src/index.ts",
        "packages/cli/src/commands/audit.ts",
        "packages/cli/src/commands/start.ts",
        "packages/cli/src/commands/proxy.ts",
      ],
      thresholds: {
        // Floor for everything else, set a few points below current measured
        // coverage so normal refactors don't flake CI, while a real drop
        // still fails it.
        statements: 78,
        branches: 80,
        functions: 80,
        lines: 78,
        // packages/core is the deterministic enforcement engine (policy,
        // trust, ledger, scanner, vault) — the security-critical surface
        // this project's own testing philosophy calls "the specification".
        // Held to a higher bar than the rest of the tree.
        "packages/core/src/**/*.ts": {
          statements: 78,
          branches: 82,
          functions: 87,
          lines: 82,
        },
      },
    },
  },
});
