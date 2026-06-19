import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runScan(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "scan", ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

const pluginSource = `
export default {
  id: "no-console",
  name: "No console",
  description: "Flags console.log in production source.",
  defaultSeverity: "low",
  tags: ["hygiene"],
  detect(context) {
    const issues = [];
    for (const file of context.files) {
      const lines = file.content.split(/\\r?\\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].includes("console.log")) {
          issues.push({
            id: "dl_nc_" + file.relativePath + ":" + (index + 1),
            ruleId: "no-console",
            ruleName: "No console",
            severity: "low",
            confidence: 0.85,
            message: "console.log found in source.",
            file: file.relativePath,
            location: { startLine: index + 1 },
            tags: ["hygiene"],
            suggestion: "Remove debug logging or route through a logger.",
          });
        }
      }
    }
    return issues;
  },
};
`;

function withPluginProject(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-plugin-"));
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "no-console.mjs"), pluginSource);
    writeFileSync(join(dir, "src", "app.ts"), "console.log(\"debug\");\nexport const value = 1;\n");
    writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
      pluginApiVersion: 1,
      plugins: ["./no-console.mjs"],
    }));
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("debtlens scan with plugins", () => {
  it("runs plugin detectors alongside built-in rules", () => {
    withPluginProject((dir) => {
      const result = runScan([".", "--cwd", dir, "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.ok(parsed.issues.some((issue: { ruleId: string }) => issue.ruleId === "no-console"));
    });
  });

  it("runs plugin detectors from a policy scaffold that omits rules and pack", () => {
    withPluginProject((dir) => {
      const result = runScan([".", "--cwd", dir, "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.ok(parsed.summary.rulesRun > 13);
      assert.ok(parsed.issues.some((issue: { ruleId: string }) => issue.ruleId === "no-console"));
    });
  });

  it("runs plugin detectors when a policy config also selects a built-in pack", () => {
    withPluginProject((dir) => {
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        pluginApiVersion: 1,
        plugins: ["./no-console.mjs"],
        pack: "core",
      }));

      const result = runScan([".", "--cwd", dir, "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.rulesRun, 14);
      assert.ok(parsed.issues.some((issue: { ruleId: string }) => issue.ruleId === "no-console"));
    });
  });

  it("discovers Python files for language-aware plugin rules beside pack defaults", () => {
    withPluginProject((dir) => {
      writeFileSync(join(dir, "python-marker.mjs"), `
export default {
  id: "python-marker",
  name: "Python marker",
  description: "Flags a marker in Python files.",
  defaultSeverity: "low",
  tags: ["python"],
  languages: ["python"],
  detect(context) {
    return context.files
      .filter((file) => file.content.includes("PY_MARKER"))
      .map((file) => ({
        id: "dl_py_marker_" + file.relativePath,
        ruleId: "python-marker",
        ruleName: "Python marker",
        severity: "low",
        confidence: 0.9,
        message: "Python marker found.",
        file: file.relativePath,
        location: { startLine: 1 },
        tags: ["python"],
        suggestion: "Remove the marker.",
      }));
  },
};
`);
      writeFileSync(join(dir, "src", "service.py"), "PY_MARKER = True\n");
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        pluginApiVersion: 1,
        plugins: ["./python-marker.mjs"],
        pack: "core",
      }));

      const result = runScan([".", "--cwd", dir, "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.rulesRun, 14);
      assert.ok(parsed.issues.some((issue: { ruleId: string; file: string }) =>
        issue.ruleId === "python-marker" && issue.file === "src/service.py"));
    });
  });

  it("selects plugin rules explicitly via --rules", () => {
    withPluginProject((dir) => {
      const result = runScan([".", "--cwd", dir, "--rules", "no-console", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.equal(parsed.issues[0].ruleId, "no-console");
      assert.equal(parsed.issues[0].file, "src/app.ts");
    });
  });

  it("supports inline suppressions for plugin rules", () => {
    withPluginProject((dir) => {
      writeFileSync(
        join(dir, "src", "app.ts"),
        "// debtlens-disable-next-line no-console -- intentional CLI output\nconsole.log(\"debug\");\n",
      );

      const result = runScan([".", "--cwd", dir, "--rules", "no-console", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 0);
      assert.equal(parsed.summary.filterStats?.suppressedByInline, 1);
    });
  });

  it("skips plugins with a stderr note when DEBTLENS_DISABLE_PLUGINS=1", () => {
    withPluginProject((dir) => {
      const result = runScan([".", "--cwd", dir, "--format", "json"], {
        env: { DEBTLENS_DISABLE_PLUGINS: "1" },
      });
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.match(result.stderr, /plugins configured but skipped because DEBTLENS_DISABLE_PLUGINS=1/);
      assert.ok(!parsed.issues.some((issue: { ruleId: string }) => issue.ruleId === "no-console"));
    });
  });

  it("applies plugin threshold defaults and lets user config override them", () => {
    withPluginProject((dir) => {
      const thresholdPluginSource = `
export default {
  rules: [{
    id: "no-console",
    name: "No console",
    description: "Flags console.log in production source.",
    defaultSeverity: "low",
    tags: ["hygiene"],
    detect(context) {
      const maxCalls = context.getThreshold("no-console.maxCalls", 0);
      const issues = [];
      for (const file of context.files) {
        const lines = file.content.split(/\\r?\\n/);
        const matches = [];
        for (let index = 0; index < lines.length; index += 1) {
          if (lines[index].includes("console.log")) matches.push(index);
        }
        if (matches.length <= maxCalls) continue;
        for (const index of matches) {
          issues.push({
            id: "dl_nc_" + file.relativePath + ":" + (index + 1),
            ruleId: "no-console",
            ruleName: "No console",
            severity: "low",
            confidence: 0.85,
            message: "console.log found in source.",
            file: file.relativePath,
            location: { startLine: index + 1 },
            tags: ["hygiene"],
            suggestion: "Remove debug logging.",
          });
        }
      }
      return issues;
    },
  }],
  thresholds: { "no-console.maxCalls": 1 },
};
`;
      writeFileSync(join(dir, "no-console.mjs"), thresholdPluginSource);

      // The plugin default (maxCalls: 1) tolerates the single console.log in the fixture.
      const withPluginDefault = runScan([".", "--cwd", dir, "--rules", "no-console", "--format", "json"]);
      assert.equal(JSON.parse(withPluginDefault.stdout).summary.totalIssues, 0);

      // User config overrides the plugin default back down to zero tolerance.
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        pluginApiVersion: 1,
        plugins: ["./no-console.mjs"],
        thresholds: { "no-console.maxCalls": 0 },
      }));
      const withUserOverride = runScan([".", "--cwd", dir, "--rules", "no-console", "--format", "json"]);
      assert.equal(JSON.parse(withUserOverride.stdout).summary.totalIssues, 1);
    });
  });

  it("merges plugin vocabulary into naming-drift concept groups", () => {
    withPluginProject((dir) => {
      writeFileSync(join(dir, "no-console.mjs"), `
export default {
  rules: [],
  vocabulary: { logging: ["log", "logger", "console", "debug", "trace"] },
};
`);
      writeFileSync(join(dir, "src", "app.ts"), [
        "export const log = 1;",
        "export const logger = 2;",
        "export const consoleThing = 3;",
        "export const debugMode = 4;",
        "export const traceLevel = 5;",
        "",
      ].join("\n"));

      const result = runScan([".", "--cwd", dir, "--rules", "naming-drift", "--min-severity", "info", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.equal(parsed.issues[0].ruleId, "naming-drift");
      assert.match(parsed.issues[0].message, /competing terms for logging/);
    });
  });

  it("fails with a clear error when a plugin rule id collides", () => {
    withPluginProject((dir) => {
      writeFileSync(join(dir, "todo-clone.mjs"), pluginSource.replace(/no-console/g, "todo-comment"));
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        pluginApiVersion: 1,
        plugins: ["./todo-clone.mjs"],
      }));

      const result = runScan([".", "--cwd", dir, "--format", "json"]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /collides with an existing rule/);
    });
  });
});
