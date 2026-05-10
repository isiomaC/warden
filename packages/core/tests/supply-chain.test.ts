import { describe, it, expect } from "vitest";
import { checkSupplyChain, parseLockDeps } from "../src/supply-chain";
import type { PackagePin, Dependency } from "../src/supply-chain";

describe("supply-chain", () => {
  describe("checkSupplyChain", () => {
    it("should detect unpinned packages", () => {
      const deps: Dependency[] = [
        { name: "lodash", version: "4.17.21", integrity: "sha512-abc" },
      ];
      const pinned: Record<string, PackagePin> = {};
      const report = checkSupplyChain(deps, pinned);
      expect(report.clean).toBe(false);
      expect(report.violations[0].type).toBe("UNPINNED");
    });

    it("should detect version drift", () => {
      const deps: Dependency[] = [
        { name: "lodash", version: "4.18.0", integrity: "sha512-abc" },
      ];
      const pinned: Record<string, PackagePin> = {
        lodash: {
          name: "lodash",
          version: "4.17.21",
          integrity: "sha512-abc",
          approvedAt: "2024-01-01",
          approvedBy: "warden",
        },
      };
      const report = checkSupplyChain(deps, pinned);
      expect(report.clean).toBe(false);
      expect(report.violations[0].type).toBe("VERSION_DRIFT");
    });

    it("should detect integrity mismatch", () => {
      const deps: Dependency[] = [
        { name: "lodash", version: "4.17.21", integrity: "sha512-xyz" },
      ];
      const pinned: Record<string, PackagePin> = {
        lodash: {
          name: "lodash",
          version: "4.17.21",
          integrity: "sha512-abc",
          approvedAt: "2024-01-01",
          approvedBy: "warden",
        },
      };
      const report = checkSupplyChain(deps, pinned);
      expect(report.clean).toBe(false);
      expect(report.violations[0].type).toBe("INTEGRITY_MISMATCH");
    });

    it("should report clean when all match", () => {
      const deps: Dependency[] = [
        { name: "lodash", version: "4.17.21", integrity: "sha512-abc" },
      ];
      const pinned: Record<string, PackagePin> = {
        lodash: {
          name: "lodash",
          version: "4.17.21",
          integrity: "sha512-abc",
          approvedAt: "2024-01-01",
          approvedBy: "warden",
        },
      };
      const report = checkSupplyChain(deps, pinned);
      expect(report.clean).toBe(true);
      expect(report.violations).toHaveLength(0);
    });

    it("should handle multiple issues per package", () => {
      const deps: Dependency[] = [
        { name: "lodash", version: "4.18.0", integrity: "sha512-xyz" },
      ];
      const pinned: Record<string, PackagePin> = {
        lodash: {
          name: "lodash",
          version: "4.17.21",
          integrity: "sha512-abc",
          approvedAt: "2024-01-01",
          approvedBy: "warden",
        },
      };
      const report = checkSupplyChain(deps, pinned);
      expect(report.violations.length).toBe(2);
    });
  });

  describe("parseLockDeps", () => {
    it("should parse lock data into dependencies", () => {
      const lockData = {
        lodash: { version: "4.17.21", integrity: "sha512-abc" },
        express: { version: "5.0.0", integrity: "sha512-def" },
      };
      const deps = parseLockDeps(lockData);
      expect(deps).toHaveLength(2);
      expect(deps[0].name).toBe("lodash");
    });
  });
});
