import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractPaths, isPathAllowed } from "../src/paths";

describe("extractPaths", () => {
  it("extracts values from path-like keys", () => {
    expect(extractPaths({ path: "/a", file_path: "/b", query: "x" })).toEqual(["/a", "/b"]);
  });

  it("is case-insensitive on key names", () => {
    expect(extractPaths({ FILE_PATH: "/a", Directory: "/b" })).toEqual(["/a", "/b"]);
  });

  it("rejects non-string and empty values in path fields", () => {
    expect(() => extractPaths({ path: 42 })).toThrow(/unparseable path/i);
    expect(() => extractPaths({ dir: "" })).toThrow(/unparseable path/i);
    expect(() => extractPaths({ target: null })).toThrow(/unparseable path/i);
  });

  it("returns empty array for non-object input", () => {
    expect(extractPaths(null)).toEqual([]);
    expect(extractPaths("str")).toEqual([]);
    expect(extractPaths(undefined)).toEqual([]);
  });

  it("walks nested input and arrays to find path values", () => {
    expect(extractPaths({ options: { path: "/etc/passwd" }, files: [{ filePath: "/tmp/a" }], paths: ["/tmp/b"] }))
      .toEqual(["/etc/passwd", "/tmp/a", "/tmp/b"]);
  });

  it("rejects path-like fields with unsupported values", () => {
    expect(() => extractPaths({ path: { value: "/etc/passwd" } })).toThrow(/unparseable path/i);
  });
});

describe("isPathAllowed", () => {
  it("denies everything when the allowlist is empty", () => {
    expect(isPathAllowed("/etc/passwd", [])).toBe(false);
  });

  it("allows exact match and children of an allowed directory", () => {
    expect(isPathAllowed("/tmp/work", ["/tmp/work"])).toBe(true);
    expect(isPathAllowed("/tmp/work/sub/file.txt", ["/tmp/work"])).toBe(true);
  });

  it("denies paths outside the allowlist", () => {
    expect(isPathAllowed("/etc/passwd", ["/tmp/work"])).toBe(false);
  });

  it("denies .. traversal escaping an allowed directory", () => {
    expect(isPathAllowed("/tmp/work/../../etc/passwd", ["/tmp/work"])).toBe(false);
    expect(isPathAllowed("/tmp/work/../work-evil/x", ["/tmp/work"])).toBe(false);
  });

  it("allows .. traversal that stays inside the allowed directory", () => {
    expect(isPathAllowed("/tmp/work/a/../b.txt", ["/tmp/work"])).toBe(true);
  });

  it("denies sibling directories that share a string prefix", () => {
    expect(isPathAllowed("/tmp/work-evil/x", ["/tmp/work"])).toBe(false);
    expect(isPathAllowed("/tmp/workspace", ["/tmp/work"])).toBe(false);
  });

  it("ignores trailing slashes on allowlist entries", () => {
    expect(isPathAllowed("/tmp/work/file", ["/tmp/work/"])).toBe(true);
  });

  it("expands ~ in both the input path and allowlist entries", () => {
    const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
    if (home.length === 0) return;
    expect(isPathAllowed("~/projects/x", ["~/projects"])).toBe(true);
    expect(isPathAllowed(`${home}/projects/x`, ["~/projects"])).toBe(true);
    expect(isPathAllowed("~/other/x", ["~/projects"])).toBe(false);
  });

  it("resolves relative paths against cwd before comparing", () => {
    expect(isPathAllowed("subdir/file.txt", [process.cwd()])).toBe(true);
    expect(isPathAllowed("../outside.txt", [process.cwd()])).toBe(false);
  });

  it("treats a root allowlist entry as allow-all", () => {
    expect(isPathAllowed("/anything/at/all", ["/"])).toBe(true);
  });

  it("denies paths that escape an allowed root through a symlink", () => {
    const temp = mkdtempSync(join(tmpdir(), "warden-path-symlink-"));
    const allowed = join(temp, "allowed");
    const outside = join(temp, "outside");
    mkdirSync(allowed);
    mkdirSync(outside);
    symlinkSync(outside, join(allowed, "link"));
    try {
      expect(isPathAllowed(join(allowed, "link", "secret.txt"), [allowed])).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
