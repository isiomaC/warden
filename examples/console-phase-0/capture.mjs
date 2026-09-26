import { mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const sideshowUrl = value("--sideshow-url");
const output = value("--output");

if (!sideshowUrl || !output) {
  process.stderr.write("Usage: npm run demo:console-phase-0:capture -- --sideshow-url http://127.0.0.1:8228 --output /tmp/warden-demo.webm\n");
  process.exit(2);
}

const published = spawnSync("npm", ["run", "demo:console-phase-0", "--", "--sideshow-url", sideshowUrl], {
  encoding: "utf8",
});
if (published.status !== 0) {
  process.stderr.write(published.stderr || published.stdout);
  process.exit(published.status ?? 1);
}

const target = resolve(output);
mkdirSync(dirname(target), { recursive: true });
const browser = await chromium.launch({ executablePath: chromium.executablePath() });
const context = await browser.newContext({ recordVideo: { dir: dirname(target), size: { width: 1440, height: 960 } } });
const page = await context.newPage();
await page.goto(sideshowUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2_000);
const videoPath = await page.video().path();
await context.close();
await browser.close();
renameSync(videoPath, target);
process.stdout.write(`Recorded real Warden Console Phase 0 board to ${target}\n`);
