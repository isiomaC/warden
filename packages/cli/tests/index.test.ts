import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import main from "../src/index.js";

describe("warden CLI metadata", () => {
  it("exposes the package version for the --version flag", async () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "packages/cli/package.json"), "utf8")) as { version: string };
    const meta = typeof main.meta === "function" ? await main.meta() : await main.meta;
    expect(meta?.version).toBe(packageJson.version);
  });
});
