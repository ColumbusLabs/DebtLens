import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "../../src/config/loadConfig.js";
import { DEBTLENS_PLUGIN_API_VERSION } from "../../src/plugins/version.js";

function withTempConfig(config: Record<string, unknown>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "debtlens-plugin-config-"));
  try {
    writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify(config));
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("plugin config validation", () => {
  it("loads a config with a matching pluginApiVersion", () => {
    withTempConfig({ pluginApiVersion: DEBTLENS_PLUGIN_API_VERSION, plugins: ["./plugin.mjs"] }, (dir) => {
      const config = loadConfig(dir);
      assert.deepEqual(config.plugins, ["./plugin.mjs"]);
      assert.equal(config.pluginApiVersion, DEBTLENS_PLUGIN_API_VERSION);
    });
  });

  it("rejects plugins without a pluginApiVersion", () => {
    withTempConfig({ plugins: ["./plugin.mjs"] }, (dir) => {
      assert.throws(() => loadConfig(dir), new RegExp(`"plugins" requires "pluginApiVersion": ${DEBTLENS_PLUGIN_API_VERSION}`));
    });
  });

  it("rejects an unsupported pluginApiVersion with an upgrade message", () => {
    withTempConfig({ pluginApiVersion: 999, plugins: ["./plugin.mjs"] }, (dir) => {
      assert.throws(
        () => loadConfig(dir),
        /pluginApiVersion 999 is not supported by this DebtLens release \(supported: 1\)/,
      );
    });
  });

  it("ignores plugin fields when neither is present", () => {
    withTempConfig({ minSeverity: "low" }, (dir) => {
      const config = loadConfig(dir);
      assert.equal(config.plugins, undefined);
    });
  });
});
