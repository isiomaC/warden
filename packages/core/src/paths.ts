import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const PATH_KEYS = new Set([
  "path", "file_path", "filepath", "filename",
  "dir", "directory", "base_dir", "cwd", "workdir", "working_dir", "workingdirectory", "root",
  "target", "source", "dest", "destination",
]);

export function extractPaths(toolInput: unknown): string[] {
  const paths: string[] = [];
  const seen = new Set<object>();
  let nodes = 0;

  function visit(value: unknown, depth: number): void {
    nodes++;
    if (nodes > 10_000 || depth > 32) {
      throw new Error("Warden: unparseable path input exceeded traversal limits.");
    }
    if (typeof value !== "object" || value === null) return;
    if (seen.has(value)) throw new Error("Warden: unparseable path input contains a cycle.");
    seen.add(value);

    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value as Record<string, unknown>);
    for (const [key, child] of entries) {
      if (Array.isArray(value)) {
        visit(child, depth + 1);
        continue;
      }
      const lowerKey = key.toLowerCase();
      const isPathKey = PATH_KEYS.has(lowerKey) || /(?:path|file|dir|directory|filename|destination|source|target)(?:name|s)?$/i.test(key) || /^(?:cwd|root|workdir|workingdir|workingdirectory)$/i.test(key);
      if (isPathKey) {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (typeof item === "string" && item.length > 0) paths.push(item);
            else if (typeof item === "object" && item !== null) visit(item, depth + 1);
            else throw new Error(`Warden: unparseable path value for field "${key}".`);
          }
          continue;
        }
        if (typeof child !== "string" || child.length === 0) {
          throw new Error(`Warden: unparseable path value for field "${key}".`);
        }
        paths.push(child);
      } else {
        visit(child, depth + 1);
      }
    }
  }

  visit(toolInput, 0);
  return paths;
}

function expandHome(p: string): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  return p.startsWith("~/") && home.length > 0 ? home + p.slice(1) : p;
}

function resolveRealPath(p: string): string | undefined {
  const absolute = resolve(expandHome(p));
  let candidate = absolute;
  const missing: string[] = [];
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    missing.unshift(candidate.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    candidate = parent;
  }
  try {
    return resolve(realpathSync(candidate), ...missing);
  } catch {
    return undefined;
  }
}

/**
 * Both sides are fully resolved (~ expansion, `..`/`.` segments, relative →
 * absolute against cwd) before comparison, and a match requires either exact
 * equality or a separator boundary — so `/allowed/../etc/passwd` cannot escape
 * via unresolved traversal and `/allowed-evil` cannot match allowlist entry
 * `/allowed` as a bare string prefix.
 */
export function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return false;
  const resolved = resolveRealPath(filePath);
  if (!resolved) return false;
  return allowedPaths.some((allowed) => {
    const allowedResolved = resolveRealPath(allowed);
    if (!allowedResolved) return false;
    if (allowedResolved === sep) return true;
    return resolved === allowedResolved || resolved.startsWith(allowedResolved + sep);
  });
}
