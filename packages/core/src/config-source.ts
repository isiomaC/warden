import { readFileSync } from "node:fs";
import { sha256 } from "./hash";
import type { PolicyConfig } from "./policy";

export interface ConfigSource {
  load(): Promise<PolicyConfig>;
  verify(config: PolicyConfig): Promise<boolean>;
  onChange(callback: (newConfig: PolicyConfig) => void): void;
}

export class FileConfigSource implements ConfigSource {
  private loadedHash: string = "";
  private path: string;

  constructor(filePath: string) {
    this.path = filePath;
  }

  async load(): Promise<PolicyConfig> {
    const raw = readFileSync(this.path, "utf-8");
    const parsed = this.parseYaml(raw) as PolicyConfig;
    const canonical = JSON.stringify(parsed);
    this.loadedHash = sha256(canonical);
    return parsed;
  }

  async verify(config: PolicyConfig): Promise<boolean> {
    const canonical = JSON.stringify(config);
    return sha256(canonical) === this.loadedHash;
  }

  private parseYaml(raw: string): unknown {
    const lines = raw.split("\n");
    const root: Record<string, unknown> = {};
    const stack: Array<Record<string, unknown>> = [root];
    const indentStack: number[] = [0];
    const lastKeyStack: string[] = [""];

    for (const line of lines) {
      if (line.trim() === "" || line.trim().startsWith("#")) continue;

      const indent = line.length - line.trimStart().length;
      const trimmed = line.trim();

      while (indentStack.length > 1 && indent <= indentStack[indentStack.length - 2]) {
        indentStack.pop();
        stack.pop();
        lastKeyStack.pop();
      }

      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        const parent = stack[stack.length - 1];
        const realKey = key.startsWith("- ") ? key.slice(2) : key;

        if (value === "") {
          const newObj: Record<string, unknown> = {};
          if (trimmed.startsWith("- ")) {
            const parentKey = lastKeyStack[lastKeyStack.length - 1];
            if (!Array.isArray(parent[parentKey])) {
              parent[parentKey] = [];
            }
            (parent[parentKey] as unknown[]).push(newObj);
          } else {
            parent[realKey] = newObj;
          }
          stack.push(newObj);
          indentStack.push(indent);
          lastKeyStack.push(realKey);
        } else if (value.startsWith("[") && value.endsWith("]")) {
          parent[realKey] = this.parseArray(value);
        } else if (trimmed.startsWith("- ")) {
          const parentKey = lastKeyStack[lastKeyStack.length - 1];
          const newObj: Record<string, unknown> = {};
          newObj[realKey] = this.parseScalar(value);
          if (Array.isArray(parent[parentKey])) {
            (parent[parentKey] as unknown[]).push(newObj);
          } else {
            parent[parentKey] = [newObj];
          }
        } else {
          parent[realKey] = this.parseScalar(value);
        }
      } else if (trimmed.startsWith("- ")) {
        const item = trimmed.slice(2).trim();
        const current = stack[stack.length - 1];
        const parentKey = lastKeyStack[lastKeyStack.length - 1];

        if (Array.isArray(current[parentKey])) {
          (current[parentKey] as unknown[]).push(this.parseScalar(item));
        } else {
          current[parentKey] = [this.parseScalar(item)];
        }
      }
    }

    return root;
  }

  private parseArray(value: string): unknown[] {
    const inner = value.slice(1, -1);
    if (inner.trim() === "") return [];
    return inner.split(",").map((s) => this.parseScalar(s.trim()));
  }

  private parseScalar(value: string): unknown {
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null" || value === "~") return null;
    if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
    if (/^\d+\.\d+$/.test(value)) return Number.parseFloat(value);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }

  onChange(_callback: (newConfig: PolicyConfig) => void): void {}
}
