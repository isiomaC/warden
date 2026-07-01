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

  /**
   * Recursive-descent parser with one-line lookahead so a key with an empty
   * value (e.g. `policies:`) is resolved as a sequence or mapping based on
   * what actually follows it, instead of always assuming a nested mapping.
   */
  private parseYaml(raw: string): unknown {
    const lines: Array<{ indent: number; content: string }> = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      lines.push({ indent: line.length - line.trimStart().length, content: trimmed });
    }

    if (lines.length === 0) return {};

    const pos = { i: 0 };
    const root = this.parseBlock(lines, pos, lines[0].indent);

    if (pos.i < lines.length) {
      throw new Error(
        `Warden: malformed config — unexpected indentation at "${lines[pos.i].content}"`,
      );
    }

    return root;
  }

  private isSequenceLine(content: string): boolean {
    return content === "-" || content.startsWith("- ");
  }

  /** Finds the key/value separator colon, ignoring colons inside quoted substrings. */
  private findColon(s: string): number {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "'" && !inDouble) inSingle = !inSingle;
      else if (c === '"' && !inSingle) inDouble = !inDouble;
      else if (c === ":" && !inSingle && !inDouble) {
        if (i + 1 === s.length || s[i + 1] === " ") return i;
      }
    }
    return -1;
  }

  private parseBlock(
    lines: Array<{ indent: number; content: string }>,
    pos: { i: number },
    indent: number,
  ): unknown {
    if (pos.i >= lines.length) return null;
    return this.isSequenceLine(lines[pos.i].content)
      ? this.parseSequence(lines, pos, indent)
      : this.parseMapping(lines, pos, indent);
  }

  private parseMapping(
    lines: Array<{ indent: number; content: string }>,
    pos: { i: number },
    indent: number,
  ): Record<string, unknown> {
    const obj: Record<string, unknown> = {};

    while (
      pos.i < lines.length &&
      lines[pos.i].indent === indent &&
      !this.isSequenceLine(lines[pos.i].content)
    ) {
      const content = lines[pos.i].content;
      const colonIdx = this.findColon(content);
      if (colonIdx <= 0) {
        throw new Error(`Warden: malformed config line: "${content}"`);
      }

      const key = content.slice(0, colonIdx).trim();
      const value = content.slice(colonIdx + 1).trim();
      pos.i++;

      if (value === "") {
        obj[key] =
          pos.i < lines.length && lines[pos.i].indent > indent
            ? this.parseBlock(lines, pos, lines[pos.i].indent)
            : null;
      } else if (value.startsWith("[") && value.endsWith("]")) {
        obj[key] = this.parseArray(value);
      } else {
        obj[key] = this.parseScalar(value);
      }
    }

    return obj;
  }

  private parseSequence(
    lines: Array<{ indent: number; content: string }>,
    pos: { i: number },
    indent: number,
  ): unknown[] {
    const arr: unknown[] = [];

    while (
      pos.i < lines.length &&
      lines[pos.i].indent === indent &&
      this.isSequenceLine(lines[pos.i].content)
    ) {
      const content = lines[pos.i].content;
      const afterDash = content === "-" ? "" : content.slice(2);

      if (afterDash === "") {
        pos.i++;
        arr.push(
          pos.i < lines.length && lines[pos.i].indent > indent
            ? this.parseBlock(lines, pos, lines[pos.i].indent)
            : null,
        );
        continue;
      }

      const colonIdx = this.findColon(afterDash);
      if (colonIdx > 0) {
        // Rewrite this line as a mapping entry one level deeper and let
        // parseMapping consume it plus any sibling keys under the same item.
        lines[pos.i] = { indent: indent + 2, content: afterDash };
        arr.push(this.parseBlock(lines, pos, indent + 2));
      } else if (afterDash.startsWith("[") && afterDash.endsWith("]")) {
        arr.push(this.parseArray(afterDash));
        pos.i++;
      } else {
        arr.push(this.parseScalar(afterDash));
        pos.i++;
      }
    }

    return arr;
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
