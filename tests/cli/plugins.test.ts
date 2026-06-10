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
