import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["core", "hook-server", "mcp-gateway", "cli"];
const temporaryDirectory = mkdtempSync(join(tmpdir(), "warden-cli-package-"));
const artifactDirectory = join(temporaryDirectory, "artifacts");
const consumerDirectory = join(temporaryDirectory, "consumer");
const npmEnvironment = { ...process.env, npm_config_cache: join(temporaryDirectory, "npm-cache") };

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
}

export function parsePackMetadata(output) {
  const parsed = JSON.parse(output);
  const metadata = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (!metadata || typeof metadata !== "object" || typeof metadata.filename !== "string") {
    throw new Error("npm pack did not return package metadata with a filename");
  }
  return metadata;
}

function main() {
  mkdirSync(artifactDirectory);
  mkdirSync(consumerDirectory);
  try {
    run("npm", ["run", "build"], { cwd: workspace });

    const tarballs = packages.map((name) => {
      const directory = join(workspace, "packages", name);
      const output = run("npm", ["pack", "--json", "--pack-destination", artifactDirectory], { cwd: directory, env: npmEnvironment });
      const metadata = parsePackMetadata(output);
      return join(artifactDirectory, metadata.filename);
    });

    run("npm", ["init", "--yes"], { cwd: consumerDirectory, env: npmEnvironment });
    run("npm", ["install", "--ignore-scripts", "--package-lock=false", ...tarballs], { cwd: consumerDirectory, env: npmEnvironment });
    const output = run(process.execPath, [join(consumerDirectory, "node_modules", "@stlw", "warden-cli", "dist", "src", "bin.js"), "--help"], { cwd: consumerDirectory });
    if (!output.includes("Warden — Security layer")) throw new Error("Packed Warden CLI did not print its help text");
    console.log("Verified packed @stlw/warden-cli executable");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
