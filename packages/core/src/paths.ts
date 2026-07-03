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

export function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return true;
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  const normalize = (p: string): string =>
    p.startsWith("~/") && home.length > 0 ? home + p.slice(1) : p;
  const normalized = normalize(filePath);
  return allowedPaths.some((allowed) => normalized.startsWith(normalize(allowed)));
}
