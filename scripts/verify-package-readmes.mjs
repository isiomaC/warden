import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  ["packages/core", "@stlw/warden"],
  ["packages/hook-server", "@stlw/warden-hook-server"],
  ["packages/mcp-gateway", "@stlw/warden-mcp-gateway"],
  ["packages/cli", "@stlw/warden-cli"],
];
const temporaryDirectory = mkdtempSync(join(tmpdir(), "warden-package-readmes-"));
const npmEnvironment = { ...process.env, npm_config_cache: join(temporaryDirectory, "npm-cache") };

try {
  for (const [directory, name] of packages) {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: join(workspace, directory),
      encoding: "utf8",
      env: npmEnvironment,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const [packed] = JSON.parse(output);
    if (!packed?.files?.some((file) => file.path === "README.md")) {
      throw new Error(`Packed ${name} is missing README.md`);
    }
  }
  console.log("Verified package READMEs in all publishable tarballs.");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
