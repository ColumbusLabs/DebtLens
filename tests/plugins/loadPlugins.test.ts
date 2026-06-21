import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadPlugins, pluginsDisabled } from "../../src/plugins/loadPlugins.js";

const builtInIds = new Set(["todo-comment"]);

const validDetectorSource = (id: string) => `
export default {
  id: "${id}",
  name: "Example",
  description: "Example plugin rule.",
  defaultSeverity: "low",
  tags: ["example"],
  detect: () => [],
};
`;

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "debtlens-plugins-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("loadPlugins", () => {
  it("returns no detectors when no plugins are configured", async () => {
    const result = await loadPlugins("/anywhere", {}, builtInIds);
    assert.deepEqual(result.detectors, []);
    assert.deepEqual(result.warnings, []);
  });

  it("loads a single default-exported detector", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "plugin.mjs"), validDetectorSource("no-console"));
      const result = await loadPlugins(dir, { plugins: ["./plugin.mjs"] }, builtInIds);
      assert.equal(result.detectors.length, 1);
      assert.equal(result.detectors[0]?.id, "no-console");
    });
  });

  it("accepts registered plugin languages", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "plugin.mjs"), `
export default {
  id: "python-policy",
  name: "Python policy",
  description: "Example Python-only plugin rule.",
  defaultSeverity: "low",
  tags: ["example"],
  languages: ["python"],
  detect: () => [],
};
`);
      const result = await loadPlugins(dir, { plugins: ["./plugin.mjs"] }, builtInIds);
      assert.deepEqual(result.detectors[0]?.languages, ["python"]);
    });
  });

  it("rejects malformed or unknown plugin languages", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "bad-shape.mjs"), `
export default {
  id: "bad-language-shape",
  name: "Bad language shape",
  description: "Example plugin rule.",
  defaultSeverity: "low",
  tags: ["example"],
  languages: "python",
  detect: () => [],
};
`);
      writeFileSync(join(dir, "bad-id.mjs"), `
export default {
  id: "bad-language-id",
  name: "Bad language id",
  description: "Example plugin rule.",
  defaultSeverity: "low",
  tags: ["example"],
  languages: ["go"],
  detect: () => [],
};
`);

      await assert.rejects(
        loadPlugins(dir, { plugins: ["./bad-shape.mjs"] }, builtInIds),
        /"languages" must be a non-empty array of registered source languages: tsjs, python, kotlin, swift, vue, svelte/,
      );
      await assert.rejects(
        loadPlugins(dir, { plugins: ["./bad-id.mjs"] }, builtInIds),
        /"languages" must contain registered source languages: tsjs, python, kotlin, swift, vue, svelte; received "go"/,
      );
    });
  });

  it("loads a { rules } export with vocabulary and thresholds", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "plugin.mjs"), `
const rule = {
  id: "custom-rule",
  name: "Custom",
  description: "Custom rule.",
  defaultSeverity: "medium",
  tags: [],
  detect: () => [],
};
export default {
  rules: [rule],
  thresholds: { "custom-rule.maxThings": 3 },
  vocabulary: { media: ["movie", "film"] },
};
`);
      const result = await loadPlugins(dir, { plugins: ["./plugin.mjs"] }, builtInIds);
      assert.equal(result.detectors.length, 1);
      assert.equal(result.detectors[0]?.id, "custom-rule");
      assert.deepEqual(result.thresholds, { "custom-rule.maxThings": 3 });
      assert.deepEqual(result.vocabulary, { media: ["movie", "film"] });
      assert.deepEqual(result.warnings, []);
    });
  });

  it("rejects non-numeric plugin thresholds", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "plugin.mjs"), `
export default {
  rules: [],
  thresholds: { "custom-rule.maxThings": "lots" },
};
`);
      await assert.rejects(
        loadPlugins(dir, { plugins: ["./plugin.mjs"] }, builtInIds),
        /threshold "custom-rule.maxThings" must be a finite number/,
      );
    });
  });

  it("rejects malformed plugin vocabulary groups", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "plugin.mjs"), `
export default {
  rules: [],
  vocabulary: { media: [] },
};
`);
      await assert.rejects(
        loadPlugins(dir, { plugins: ["./plugin.mjs"] }, builtInIds),
        /vocabulary group "media" must be a non-empty array of strings/,
      );
    });
  });

  it("warns when a later plugin overrides an earlier plugin's threshold or vocabulary", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "one.mjs"), `
export default { rules: [], thresholds: { "shared.max": 1 }, vocabulary: { media: ["movie"] } };
`);
      writeFileSync(join(dir, "two.mjs"), `
export default { rules: [], thresholds: { "shared.max": 2 }, vocabulary: { media: ["film"] } };
`);
      const result = await loadPlugins(dir, { plugins: ["./one.mjs", "./two.mjs"] }, builtInIds);
      assert.deepEqual(result.thresholds, { "shared.max": 2 });
      assert.deepEqual(result.vocabulary, { media: ["film"] });
      assert.equal(result.warnings.length, 2);
      assert.match(result.warnings[0] ?? "", /threshold "shared.max" was already set by an earlier plugin/);
      assert.match(result.warnings[1] ?? "", /vocabulary group "media" was already set by an earlier plugin/);
    });
  });

  it("rejects rule id collisions with built-in rules", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "plugin.mjs"), validDetectorSource("todo-comment"));
      await assert.rejects(
        loadPlugins(dir, { plugins: ["./plugin.mjs"] }, builtInIds),
        /rule id "todo-comment", which collides with an existing rule/,
      );
    });
  });

  it("rejects rule id collisions between plugins", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "one.mjs"), validDetectorSource("dup-rule"));
      writeFileSync(join(dir, "two.mjs"), validDetectorSource("dup-rule"));
      await assert.rejects(
        loadPlugins(dir, { plugins: ["./one.mjs", "./two.mjs"] }, builtInIds),
        /collides with an existing rule/,
      );
    });
  });

  it("rejects invalid detector shapes with a clear field error", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "plugin.mjs"), `
export default {
  id: "broken-rule",
  name: "Broken",
  description: "Missing detect.",
  defaultSeverity: "low",
  tags: [],
};
`);
      await assert.rejects(
        loadPlugins(dir, { plugins: ["./plugin.mjs"] }, builtInIds),
        /"detect" must be a function/,
      );
    });
  });

  it("rejects exports that are neither a detector nor { rules }", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "plugin.mjs"), "export default 42;\n");
      await assert.rejects(
        loadPlugins(dir, { plugins: ["./plugin.mjs"] }, builtInIds),
        /must default-export a Detector or \{ rules: Detector\[\] \}/,
      );
    });
  });

  it("rejects paths that traverse outside the config directory", async () => {
    await withTempDir(async (dir) => {
      const nested = join(dir, "nested");
      mkdirSync(nested);
      writeFileSync(join(dir, "outside.mjs"), validDetectorSource("outside-rule"));
      await assert.rejects(
        loadPlugins(nested, { plugins: ["../outside.mjs"] }, builtInIds),
        /resolves outside the config directory/,
      );
    });
  });

  it("rejects missing plugin modules", async () => {
    await withTempDir(async (dir) => {
      await assert.rejects(
        loadPlugins(dir, { plugins: ["./missing.mjs"] }, builtInIds),
        /Plugin module not found/,
      );
    });
  });

  it("skips loading entirely when DEBTLENS_DISABLE_PLUGINS=1", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "plugin.mjs"), validDetectorSource("no-console"));
      const result = await loadPlugins(dir, { plugins: ["./plugin.mjs"] }, builtInIds, {
        DEBTLENS_DISABLE_PLUGINS: "1",
      });
      assert.deepEqual(result.detectors, []);
      assert.match(result.warnings[0] ?? "", /skipped because DEBTLENS_DISABLE_PLUGINS=1/);
    });
  });

  it("reports plugin disable state from the environment", () => {
    assert.equal(pluginsDisabled({ DEBTLENS_DISABLE_PLUGINS: "1" }), true);
    assert.equal(pluginsDisabled({ DEBTLENS_DISABLE_PLUGINS: "0" }), false);
    assert.equal(pluginsDisabled({}), false);
  });
});
