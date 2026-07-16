import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { resolveFilePaths } from "../../src/core/resolveFiles.js";
import { scan } from "../../src/core/scan.js";

describe("scan integration", () => {
  it("keeps opt-in detectors out of default scans while explicit rules and packs include them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-opt-in-detector-"));
    try {
      writeFileSync(join(dir, "flags.ts"), "const enableCheckout = true;\nif (enableCheckout) launch();\n");
      const defaultResult = await scan(mergeConfig(".", {}, { cwd: dir }));
      const explicitResult = await scan(mergeConfig(".", {}, { cwd: dir, rules: ["stale-feature-flag"] }));
      const packResult = await scan(mergeConfig(".", { pack: "feature-flags" }, { cwd: dir }));

      assert.equal(defaultResult.summary.byRule["stale-feature-flag"], undefined);
      assert.equal(explicitResult.summary.byRule["stale-feature-flag"], 1);
      assert.equal(packResult.summary.byRule["stale-feature-flag"], 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the full pipeline against examples/react", async () => {
    const cwd = process.cwd();
    const result = await scan({
      cwd,
      target: resolve("examples/react"),
      include: defaultConfig.include,
      exclude: [],
      minSeverity: "medium",
      rules: ["duplicate-logic", "prop-drilling"],
      thresholds: {},
      maxFiles: defaultConfig.maxFiles,
    });

    assert.equal(result.summary.filesScanned, 3);
    assert.equal(result.summary.rulesRun, 2);
    assert.equal(result.summary.totalIssues, 2);
    assert.equal(result.summary.bySeverity.high, 2);
    assert.deepEqual(result.summary.byRule, {
      "prop-drilling": 1,
      "duplicate-logic": 1,
    });

    assert.deepEqual(result.issues.map((issue) => issue.ruleId), ["prop-drilling", "duplicate-logic"]);
    assert.equal(result.issues[0]?.severity, "high");
    assert.equal(result.issues[0]?.file, "src/Dashboard.tsx");
    assert.equal(result.issues[1]?.severity, "high");
    assert.equal(result.issues[1]?.file, "src/duplicateOne.ts");
  });

  it("only filters .gitignore matches when respectGitignore is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-gitignore-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, ".gitignore"), "src/ignored.ts\n");
      writeFileSync(join(dir, "src", "ignored.ts"), "// TODO ignored\nexport const ignored = 1;\n");
      writeFileSync(join(dir, "src", "kept.ts"), "// TODO kept\nexport const kept = 1;\n");

      const baseOptions = {
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low" as const,
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
      };

      const defaultResult = await scan(baseOptions);
      const filteredResult = await scan({ ...baseOptions, respectGitignore: true });

      assert.equal(defaultResult.summary.totalIssues, 2);
      assert.equal(filteredResult.summary.totalIssues, 1);
      assert.deepEqual(filteredResult.issues.map((issue) => issue.file), ["src/kept.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("filters gitignored files for absolute targets outside the caller cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-absolute-gitignore-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, ".gitignore"), "src/ignored.ts\n");
      writeFileSync(join(dir, "src", "ignored.ts"), "// TODO ignored\nexport const ignored = 1;\n");
      writeFileSync(join(dir, "src", "kept.ts"), "// TODO kept\nexport const kept = 1;\n");

      const result = await scan({
        cwd: process.cwd(),
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        respectGitignore: true,
      });

      assert.equal(result.summary.totalIssues, 1);
      assert.deepEqual(result.issues.map((issue) => issue.file), ["src/kept.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies maxFiles after deterministic path ordering", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-maxfiles-order-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "z.ts"), "export const z = 1;\n");
      writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
      writeFileSync(join(dir, "src", "m.ts"), "export const m = 1;\n");

      const paths = await resolveFilePaths({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: 2,
      });

      assert.deepEqual(paths.map((path) => relative(dir, path)), [
        "src/a.ts",
        "src/m.ts",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns when maxFiles truncates matched files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-maxfiles-warning-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
      writeFileSync(join(dir, "src", "b.ts"), "export const b = 1;\n");
      writeFileSync(join(dir, "src", "c.ts"), "export const c = 1;\n");

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: 2,
      });

      assert.equal(result.summary.filesScanned, 2);
      assert.match(result.summary.warnings?.[0] ?? "", /DebtLens scanned the first 2 of 3 matched files/);
      assert.match(result.summary.warnings?.[0] ?? "", /--max-files/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses central suppression accounting for valid suppressions on new detectors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-new-rule-suppress-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "worker.ts"),
        `
export function load() {
  // debtlens-disable-next-line floating-promise -- intentional fire-and-forget startup ping
  fetch("/api/startup");
}
`,
      );

      const result = await scan({
        cwd: dir,
        target: dir,
        include: ["**/*.{ts,tsx,js,jsx}"],
        exclude: [],
        minSeverity: "info",
        rules: ["floating-promise"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        auditSuppressions: true,
      });

      assert.equal(result.summary.totalIssues, 0);
      assert.equal(result.summary.filterStats?.suppressedByInline, 1);
      assert.equal(result.suppressions?.[0]?.ruleId, "floating-promise");
      assert.equal(result.suppressionDirectives?.[0]?.status, "used");
      assert.equal(result.suppressionDirectives?.[0]?.suppressedIssueCount, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps new detector findings when suppression reasons are missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-new-rule-missing-reason-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "worker.ts"),
        `
export function load() {
  // debtlens-disable-next-line floating-promise
  fetch("/api/startup");
}
`,
      );

      const result = await scan({
        cwd: dir,
        target: dir,
        include: ["**/*.{ts,tsx,js,jsx}"],
        exclude: [],
        minSeverity: "info",
        rules: ["floating-promise"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        auditSuppressions: true,
      });

      assert.equal(result.summary.totalIssues, 1);
      assert.equal(result.issues[0]?.ruleId, "floating-promise");
      assert.equal(result.summary.filterStats?.suppressedByInline, undefined);
      assert.ok(result.summary.warnings?.some((warning) => /reason is missing/.test(warning)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies file-level suppressions to every matching new error-handling finding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-new-rule-file-suppress-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "worker.ts"),
        `
// debtlens-disable-file empty-catch -- legacy SDK throws harmless telemetry errors
export function one() {
  try {
    risky();
  } catch (error) {
  }
}

export function two() {
  try {
    risky();
  } catch (error) {
  }
}
`,
      );

      const result = await scan({
        cwd: dir,
        target: dir,
        include: ["**/*.{ts,tsx,js,jsx}"],
        exclude: [],
        minSeverity: "info",
        rules: ["empty-catch"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        auditSuppressions: true,
      });

      assert.equal(result.summary.totalIssues, 0);
      assert.equal(result.summary.filterStats?.suppressedByInline, 2);
      assert.equal(result.suppressions?.length, 2);
      assert.equal(result.suppressionDirectives?.[0]?.kind, "file");
      assert.equal(result.suppressionDirectives?.[0]?.status, "used");
      assert.equal(result.suppressionDirectives?.[0]?.suppressedIssueCount, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies Next pack duplicated-literal ignores during a scan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-next-literals-"));
    try {
      mkdirSync(join(dir, "app", "dashboard"), { recursive: true });
      mkdirSync(join(dir, "app", "settings"), { recursive: true });
      mkdirSync(join(dir, "app", "reports"), { recursive: true });
      writeFileSync(join(dir, "app", "dashboard", "ClientOne.tsx"), `"use client";
export function ClientOne() {
  return <button>One</button>;
}
`);
      writeFileSync(join(dir, "app", "settings", "ClientTwo.tsx"), `"use client";
export function ClientTwo() {
  return <button>Two</button>;
}
`);
      writeFileSync(join(dir, "app", "reports", "ClientThree.tsx"), `"use client";
export function ClientThree() {
  return <button>Three</button>;
}
`);

      const result = await scan(mergeConfig(".", { pack: "next" }, {
        cwd: dir,
        rules: ["duplicated-literal"],
      }));

      assert.equal(result.summary.filesScanned, 3);
      assert.equal(result.summary.rulesRun, 1);
      assert.equal(result.summary.totalIssues, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies ruleSeverities overrides to reported issues and summary counts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-severities-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "// TODO fix later\nexport const value = 1;\n");

      const baseOptions = {
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "info" as const,
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
      };

      const result = await scan({ ...baseOptions, ruleSeverities: { "todo-comment": "high" } });

      assert.equal(result.summary.totalIssues, 1);
      assert.equal(result.issues[0]?.severity, "high");
      assert.equal(result.summary.bySeverity.high, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("filters issues below a per-rule confidence floor and tracks filterStats", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-confidence-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "// TODO fix later\nexport const value = 1;\n");

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "info",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        ruleConfidenceFloors: { "todo-comment": 1 },
      });

      assert.equal(result.summary.totalIssues, 0);
      assert.equal(result.summary.filterStats?.filteredByConfidenceFloor, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns on unknown rule ids in per-rule overrides with a suggestion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-unknown-rule-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "export const value = 1;\n");

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "info",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        ruleSeverities: { "todo-coment": "info" },
        ruleConfidenceFloors: { "prop-driling": 0.5 },
      });

      const warnings = result.summary.warnings ?? [];
      assert.ok(warnings.some((warning) => warning.includes('ruleSeverities: unknown rule "todo-coment" (did you mean "todo-comment"?)')));
      assert.ok(warnings.some((warning) => warning.includes('ruleConfidenceFloors: unknown rule "prop-driling" (did you mean "prop-drilling"?)')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps scanning outside git repos when respectGitignore is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-plain-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, ".gitignore"), "src/ignored.ts\n");
      writeFileSync(join(dir, "src", "ignored.ts"), "// TODO still scanned outside git\nexport const ignored = 1;\n");

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        respectGitignore: true,
      });

      assert.equal(result.summary.totalIssues, 1);
      assert.equal(result.issues[0]?.file, "src/ignored.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
