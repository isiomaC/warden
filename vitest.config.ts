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
    },
  },
});
