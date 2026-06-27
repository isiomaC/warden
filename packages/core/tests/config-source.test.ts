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
