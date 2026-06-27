import { defineCommand } from "citty";
import { FileConfigSource } from "@warden/core";

export const configValidateCommand = defineCommand({
  meta: {
    name: "config-validate",
    description: "Validate warden.config.yml schema and check for rule conflicts",
  },
  args: {
    config: {
      type: "string",
      description: "Path to warden.config.yml",
      default: "warden.config.yml",
    },
  },
  async run({ args }) {
    try {
      const source = new FileConfigSource(args.config);
      const config = await source.load();
      const valid = await source.verify(config);

      if (!valid) {
        process.stdout.write("Config hash verification failed.\n");
        process.exit(1);
      }

      const ruleIds = config.policies.map((p) => p.id);
      const duplicates = ruleIds.filter((id, i) => ruleIds.indexOf(id) !== i);
      if (duplicates.length > 0) {
        process.stdout.write(`WARNING: Duplicate rule IDs: ${duplicates.join(", ")}\n`);
      }

      process.stdout.write(`
=== Config Validation ===

Config path: ${args.config}
Version:     ${config.version}
Environment: ${config.meta.environment}
Rules:       ${config.policies.length}
Rule IDs:    ${ruleIds.join(", ") || "(none)"}
Status:      VALID
${duplicates.length > 0 ? `Duplicates: ${duplicates.join(", ")}\n` : ""}
`);

      process.exit(0);
    } catch (err) {
      process.stderr.write(`Config validation FAILED: ${err}\n`);
      process.exit(1);
    }
  },
});
