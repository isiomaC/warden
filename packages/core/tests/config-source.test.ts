import { describe, it, expect, afterEach } from "vitest";
import { FileConfigSource } from "../src/config-source";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

const TEST_YAML = "/tmp/warden-test-config.yml";

function cleanup() {
  if (existsSync(TEST_YAML)) unlinkSync(TEST_YAML);
}

const validYaml = `
version: "2"
meta:
  environment: "development"
  sessionApprovalRequired: false
policies: []
`;

const yamlWithPolicies = `
version: "2"
meta:
  environment: "production"
  sessionApprovalRequired: true
policies: []
`;

const yamlWithPopulatedPolicies = `
version: "2"
meta:
  environment: "development"
  sessionApprovalRequired: false
mcpServers:
  allowed:
    - name: "filesystem"
      type: local
      transport: stdio
      allowedTools: ["read_file", "list_directory"]
      authRequired: false
policies:
  - id: "block-shell-injection"
    description: "Block dangerous shell patterns"
    match:
      tool: "Bash"
      inputPatterns:
        - "rm\\\\s+-rf"
        - "curl.*\\\\|.*sh"
    action: DENY
  - id: "confirm-destructive"
    description: "Human approval for destructive operations"
    match:
      tools: ["delete_file", "drop_table"]
    action: CONFIRM
    channel: "stdout"
    timeoutSeconds: 60
`;

describe("FileConfigSource", () => {
  afterEach(() => {
    cleanup();
  });

  it("should load a valid YAML config", async () => {
    writeFileSync(TEST_YAML, validYaml);
    const source = new FileConfigSource(TEST_YAML);
    const config = await source.load();

    expect(config.version).toBe("2");
    expect(config.meta.environment).toBe("development");
    expect(config.meta.sessionApprovalRequired).toBe(false);
    expect(config.policies).toEqual([]);
  });

  it("should verify matching config hashes", async () => {
    writeFileSync(TEST_YAML, validYaml);
    const source = new FileConfigSource(TEST_YAML);
    const config = await source.load();
    const valid = await source.verify(config);
    expect(valid).toBe(true);
  });

  it("should reject modified config", async () => {
    writeFileSync(TEST_YAML, validYaml);
    const source = new FileConfigSource(TEST_YAML);
    const config = await source.load();

    config.meta.environment = "production";

    const valid = await source.verify(config);
    expect(valid).toBe(false);
  });

  it("should parse production config correctly", async () => {
    writeFileSync(TEST_YAML, yamlWithPolicies);
    const source = new FileConfigSource(TEST_YAML);
    const config = await source.load();

    expect(config.meta.environment).toBe("production");
    expect(config.meta.sessionApprovalRequired).toBe(true);
  });

  it("should parse a populated policies block-sequence as a flat array, not a nested object", async () => {
    writeFileSync(TEST_YAML, yamlWithPopulatedPolicies);
    const source = new FileConfigSource(TEST_YAML);
    const config = await source.load();

    expect(Array.isArray(config.policies)).toBe(true);
    expect(config.policies).toHaveLength(2);

    const [first, second] = config.policies as unknown as Array<Record<string, unknown>>;
    expect(first.id).toBe("block-shell-injection");
    expect(first.action).toBe("DENY");
    expect(first.match).toEqual({
      tool: "Bash",
      inputPatterns: ["rm\\\\s+-rf", "curl.*\\\\|.*sh"],
    });

    expect(second.id).toBe("confirm-destructive");
    expect(second.action).toBe("CONFIRM");
    expect(second.channel).toBe("stdout");
    expect(second.timeoutSeconds).toBe(60);
    expect(second.match).toEqual({ tools: ["delete_file", "drop_table"] });
  });

  it("should parse a nested mapping-within-mapping (mcpServers.allowed) correctly", async () => {
    writeFileSync(TEST_YAML, yamlWithPopulatedPolicies);
    const source = new FileConfigSource(TEST_YAML);
    const config = await source.load();

    const mcpServers = (config as unknown as Record<string, unknown>).mcpServers as Record<
      string,
      unknown
    >;
    expect(Array.isArray(mcpServers.allowed)).toBe(true);
    expect(mcpServers.allowed).toEqual([
      {
        name: "filesystem",
        type: "local",
        transport: "stdio",
        allowedTools: ["read_file", "list_directory"],
        authRequired: false,
      },
    ]);
  });

  it("should throw on malformed config with inconsistent indentation", async () => {
    const malformed = `
version: "2"
meta:
  environment: "development"
   sessionApprovalRequired: false
policies: []
`;
    writeFileSync(TEST_YAML, malformed);
    const source = new FileConfigSource(TEST_YAML);
    await expect(source.load()).rejects.toThrow();
  });

  it("should hash canonical JSON, not raw YAML", async () => {
    writeFileSync(TEST_YAML, validYaml + "\n# comment\n");
    const source = new FileConfigSource(TEST_YAML);
    const config = await source.load();

    writeFileSync(TEST_YAML, validYaml + "\n");
    const source2 = new FileConfigSource(TEST_YAML);
    const config2 = await source2.load();

    const canonical1 = JSON.stringify(config);
    const canonical2 = JSON.stringify(config2);
    expect(canonical1).toBe(canonical2);
  });
});
