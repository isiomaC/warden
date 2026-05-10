export interface PackagePin {
  name: string;
  version: string;
  integrity: string;
  approvedAt: string;
  approvedBy: string;
}

export interface Dependency {
  name: string;
  version: string;
  integrity: string;
}

export interface SupplyChainViolation {
  type: "UNPINNED" | "VERSION_DRIFT" | "INTEGRITY_MISMATCH";
  package: string;
  version?: string;
  pinned?: string;
  current?: string;
}

export interface SupplyChainReport {
  violations: SupplyChainViolation[];
  clean: boolean;
}

export function checkSupplyChain(
  deps: Dependency[],
  pinned: Record<string, PackagePin>,
): SupplyChainReport {
  const violations: SupplyChainViolation[] = [];

  for (const dep of deps) {
    const pin = pinned[dep.name];
    if (!pin) {
      violations.push({
        type: "UNPINNED",
        package: dep.name,
        version: dep.version,
      });
      continue;
    }

    if (pin.version !== dep.version) {
      violations.push({
        type: "VERSION_DRIFT",
        package: dep.name,
        pinned: pin.version,
        current: dep.version,
      });
    }

    if (pin.integrity !== dep.integrity) {
      violations.push({
        type: "INTEGRITY_MISMATCH",
        package: dep.name,
      });
    }
  }

  return { violations, clean: violations.length === 0 };
}

export function parseLockDeps(
  lockData: Record<string, { version: string; integrity: string }>,
): Dependency[] {
  return Object.entries(lockData).map(([name, info]) => ({
    name,
    version: info.version,
    integrity: info.integrity,
  }));
}
