import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConsoleDemo } from "../../packages/cli/src/console-phase-0-runner.js";

const args = process.argv.slice(2);
const urlIndex = args.indexOf("--sideshow-url");
const sideshowUrl = urlIndex === -1 ? undefined : args[urlIndex + 1];

if (urlIndex !== -1 && !sideshowUrl) {
  throw new Error("--sideshow-url requires a URL");
}

const directory = mkdtempSync(join(tmpdir(), "warden-console-phase-0-"));
const result = await runConsoleDemo({ directory, ...(sideshowUrl ? { sideshowUrl } : {}) });

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
