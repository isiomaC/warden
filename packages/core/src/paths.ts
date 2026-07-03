import { resolve, sep } from "node:path";

const PATH_KEYS = new Set([
  "path", "file_path", "filepath", "filename",
  "dir", "directory", "base_dir",
  "target", "source", "dest", "destination",
]);

export function extractPaths(toolInput: unknown): string[] {
  if (typeof toolInput !== "object" || toolInput === null) return [];
  const paths: string[] = [];
  for (const [key, val] of Object.entries(toolInput as Record<string, unknown>)) {
    if (PATH_KEYS.has(key.toLowerCase()) && typeof val === "string" && val.length > 0) {
      paths.push(val);
    }
  }
  return paths;
}

function expandHome(p: string): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  return p.startsWith("~/") && home.length > 0 ? home + p.slice(1) : p;
}

/**
 * Both sides are fully resolved (~ expansion, `..`/`.` segments, relative →
 * absolute against cwd) before comparison, and a match requires either exact
 * equality or a separator boundary — so `/allowed/../etc/passwd` cannot escape
 * via unresolved traversal and `/allowed-evil` cannot match allowlist entry
 * `/allowed` as a bare string prefix.
 */
export function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return true;
  const resolved = resolve(expandHome(filePath));
  return allowedPaths.some((allowed) => {
    const allowedResolved = resolve(expandHome(allowed));
    if (allowedResolved === sep) return true;
    return resolved === allowedResolved || resolved.startsWith(allowedResolved + sep);
  });
}
