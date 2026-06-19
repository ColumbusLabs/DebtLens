import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildOwnershipSummary,
  loadCodeowners,
  matchCodeowners,
  parseCodeowners,
} from "../../src/core/ownership.js";
import type { CodeownersFile, DebtIssue, DuplicateLogicCluster, Severity } from "../../src/core/types.js";

describe("parseCodeowners", () => {
  it("parses owners, inline comments, and reports invalid unsupported lines", () => {
    const parsed = parseCodeowners([
      "# top-level comment",
      "* @global",
      "*.ts @org/platform dev@example.com # inline comment",
      "docs/* @docs",
      "src/",
      "!secret @security",
      "[abc].ts @range",
      "\\#hash @hash",
      "src bad-owner",
    ].join("\n"), "CODEOWNERS");

    assert.deepEqual(parsed.rules, [
      { pattern: "*", owners: ["@global"], line: 2 },
      { pattern: "*.ts", owners: ["@org/platform", "dev@example.com"], line: 3 },
      { pattern: "docs/*", owners: ["@docs"], line: 4 },
      { pattern: "src/", owners: [], line: 5 },
    ]);
    assert.equal(parsed.warnings.length, 4);
    assert.ok(parsed.warnings.some((warning) => warning.includes("CODEOWNERS:6") && warning.includes("negation")));
    assert.ok(parsed.warnings.some((warning) => warning.includes("CODEOWNERS:7") && warning.includes("bracket ranges")));
    assert.ok(parsed.warnings.some((warning) => warning.includes("CODEOWNERS:8") && warning.includes("escaped leading #")));
    assert.ok(parsed.warnings.some((warning) => warning.includes("CODEOWNERS:9") && warning.includes("invalid owner token")));
  });

  it("parses escaped whitespace in patterns", () => {
    const parsed = parseCodeowners("docs/My\\ File.md @docs\n");

    assert.deepEqual(parsed.rules, [
      { pattern: "docs/My File.md", owners: ["@docs"], line: 1 },
    ]);
    assert.deepEqual(parsed.warnings, []);
  });
});

describe("matchCodeowners", () => {
  it("implements last-match wins, case-sensitive matching, and practical directory globs", () => {
    const rules = parseCodeowners([
      "* @all",
      "*.ts @ts",
      "/src/ @src",
      "docs/* @docs",
      "apps/ @apps",
      "**/logs @logs",
      "a/b/c @deep",
      "foo* @foo",
      "src/Case.ts @case",
    ].join("\n")).rules;

    assert.deepEqual(matchCodeowners(rules, "README.md")?.owners, ["@all"]);
    assert.deepEqual(matchCodeowners(rules, "lib/util.ts")?.owners, ["@ts"]);
    assert.deepEqual(matchCodeowners(rules, "src/nested/file.js")?.owners, ["@src"]);
    assert.deepEqual(matchCodeowners(rules, "lib/src/file.js")?.owners, ["@all"]);
    assert.deepEqual(matchCodeowners(rules, "docs/intro.md")?.owners, ["@docs"]);
    assert.deepEqual(matchCodeowners(rules, "docs/nested/intro.md")?.owners, ["@all"]);
    assert.deepEqual(matchCodeowners(rules, "packages/apps/ui/Button.tsx")?.owners, ["@apps"]);
    assert.deepEqual(matchCodeowners(rules, "logs/today.txt")?.owners, ["@logs"]);
    assert.deepEqual(matchCodeowners(rules, "server/logs/today.txt")?.owners, ["@logs"]);
    assert.deepEqual(matchCodeowners(rules, "a/b/c/file.ts")?.owners, ["@deep"]);
    assert.deepEqual(matchCodeowners(rules, "foobar/file.ts")?.owners, ["@foo"]);
    assert.deepEqual(matchCodeowners(rules, "src/Case.ts")?.owners, ["@case"]);
    assert.deepEqual(matchCodeowners(rules, "src/case.ts")?.owners, ["@src"]);
    assert.deepEqual(matchCodeowners(rules, "SRC/case.ts")?.owners, ["@ts"]);
  });

  it("returns the later matching rule with its pattern and line", () => {
    const rules = parseCodeowners([
      "* @all",
      "/src/ @src",
      "/src/app.ts @app",
    ].join("\n")).rules;

    assert.deepEqual(matchCodeowners(rules, "src/app.ts"), {
      owners: ["@app"],
      pattern: "/src/app.ts",
      line: 3,
    });
  });

  it("allows ownerless rules to clear earlier ownership", () => {
    const rules = parseCodeowners([
      "* @all",
      "/src/generated/",
    ].join("\n")).rules;

    assert.deepEqual(matchCodeowners(rules, "src/app.ts")?.owners, ["@all"]);
    assert.deepEqual(matchCodeowners(rules, "src/generated/api.ts"), {
      owners: [],
      pattern: "/src/generated/",
      line: 2,
    });
  });

  it("matches anchored single-segment directories and escaped spaces", () => {
    const rules = parseCodeowners([
      "/docs @docs",
      "docs/My\\ File.md @docs-space",
    ].join("\n")).rules;

    assert.deepEqual(matchCodeowners(rules, "docs/guide.md")?.owners, ["@docs"]);
    assert.deepEqual(matchCodeowners(rules, "src/docs/guide.md"), undefined);
    assert.deepEqual(matchCodeowners(rules, "docs/My File.md")?.owners, ["@docs-space"]);
  });
});

describe("loadCodeowners", () => {
  it("discovers CODEOWNERS in GitHub lookup order without requiring a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-codeowners-"));
    try {
      mkdirSync(join(dir, ".github"), { recursive: true });
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, ".github", "CODEOWNERS"), "*.ts @github\n");
      writeFileSync(join(dir, "CODEOWNERS"), "*.ts @root\n");
      writeFileSync(join(dir, "docs", "CODEOWNERS"), "*.ts @docs\n");

      const loaded = loadCodeowners(dir);

      assert.equal(loaded?.path, join(dir, ".github", "CODEOWNERS"));
      assert.deepEqual(matchCodeowners(loaded?.rules ?? [], "src/app.ts")?.owners, ["@github"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers repository-root CODEOWNERS from a git subdirectory", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-codeowners-git-root-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, ".github"), { recursive: true });
      mkdirSync(join(dir, "packages", "ui"), { recursive: true });
      writeFileSync(join(dir, ".github", "CODEOWNERS"), "packages/ui/* @ui\n");

      const loaded = loadCodeowners(join(dir, "packages", "ui"));

      const root = realpathSync(dir);
      assert.equal(loaded?.path, join(root, ".github", "CODEOWNERS"));
      assert.equal(loaded?.root, root);
      assert.deepEqual(matchCodeowners(loaded?.rules ?? [], "packages/ui/Button.ts")?.owners, ["@ui"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses an explicit path override and returns undefined when missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-codeowners-explicit-"));
    try {
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "CODEOWNERS"), "*.ts @root\n");
      writeFileSync(join(dir, "docs", "CODEOWNERS"), "*.ts @docs\n");

      const explicit = loadCodeowners(dir, "docs/CODEOWNERS");

      assert.equal(explicit?.path, join(dir, "docs", "CODEOWNERS"));
      assert.deepEqual(matchCodeowners(explicit?.rules ?? [], "src/app.ts")?.owners, ["@docs"]);
      assert.equal(loadCodeowners(dir, "missing/CODEOWNERS"), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the git root for explicit CODEOWNERS files loaded from a subdirectory", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-codeowners-explicit-git-root-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, ".github"), { recursive: true });
      mkdirSync(join(dir, "packages", "ui"), { recursive: true });
      writeFileSync(join(dir, ".github", "CODEOWNERS"), "packages/ui/* @ui\n");

      const loaded = loadCodeowners(join(dir, "packages", "ui"), "../../.github/CODEOWNERS");

      assert.equal(loaded ? realpathSync(loaded.path) : undefined, join(realpathSync(dir), ".github", "CODEOWNERS"));
      assert.equal(loaded?.root, realpathSync(dir));
      assert.deepEqual(matchCodeowners(loaded?.rules ?? [], "packages/ui/Button.ts")?.owners, ["@ui"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips CODEOWNERS files at or above 3 MiB without falling through to lower-priority files", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-codeowners-oversize-"));
    try {
      mkdirSync(join(dir, ".github"), { recursive: true });
      writeFileSync(join(dir, ".github", "CODEOWNERS"), Buffer.alloc(3 * 1024 * 1024, "x"));
      writeFileSync(join(dir, "CODEOWNERS"), "*.ts @root\n");

      assert.equal(loadCodeowners(dir), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildOwnershipSummary", () => {
  it("aggregates high-debt handoffs, owner summaries, and unowned hotspots", () => {
    const codeowners = codeownersFile([
      "/src/ @platform",
      "apps/ @apps-team",
    ].join("\n"));
    const duplicateClusters: DuplicateLogicCluster[] = [{
      clusterId: "cluster-1",
      issueCount: 1,
      locations: [
        { file: "virtual/mobile.tsx", startLine: 4 },
        { file: "src/high.ts", startLine: 8 },
      ],
    }];
    const summary = buildOwnershipSummary({
      codeowners,
      duplicateClusters,
      fileToRepositoryPath: new Map([["virtual/mobile.tsx", "packages/apps/mobile.tsx"]]),
      issues: [
        issue("src-high-props", "src/high.ts", "high", "prop-drilling"),
        issue("src-high-state", "src/high.ts", "medium", "state-sprawl"),
        issue("src-low", "src/low.ts", "low", "todo-comment"),
        issue("app-dup", "virtual/mobile.tsx", "high", "duplicate-logic"),
        issue("docs-high", "docs/guide.ts", "high", "todo-comment"),
        issue("docs-medium", "docs/guide.ts", "medium", "naming-drift"),
      ],
    });

    assert.equal(summary?.source, "codeowners");
    assert.equal(summary?.codeownersPath, "/repo/.github/CODEOWNERS");
    assert.deepEqual(summary?.files.map((file) => [file.file, file.repositoryPath, file.owners]), [
      ["docs/guide.ts", "docs/guide.ts", []],
      ["virtual/mobile.tsx", "packages/apps/mobile.tsx", ["@apps-team"]],
      ["src/high.ts", "src/high.ts", ["@platform"]],
      ["src/low.ts", "src/low.ts", ["@platform"]],
    ]);
    assert.deepEqual(summary?.handoffs.map((handoff) => handoff.file), [
      "src/high.ts",
      "virtual/mobile.tsx",
      "src/low.ts",
    ]);
    assert.deepEqual(summary?.unownedHotspots.map((handoff) => handoff.file), ["docs/guide.ts"]);
    assert.equal(summary?.unownedHotspots[0]?.bySeverity.high, 1);
    assert.deepEqual(summary?.ownerSummaries.map((owner) => [owner.owner, owner.files, owner.totalIssues]), [
      ["@platform", 2, 3],
      ["@apps-team", 1, 1],
    ]);
    assert.deepEqual(summary?.ownerSummaries[0]?.topFiles.map((file) => file.file), ["src/high.ts", "src/low.ts"]);
  });

  it("sorts equal handoffs and owner summaries deterministically", () => {
    const codeowners = codeownersFile([
      "src/b.ts @team-b",
      "src/a.ts @team-a",
    ].join("\n"));
    const summary = buildOwnershipSummary({
      codeowners,
      issues: [
        issue("b", "src/b.ts", "low", "todo-comment"),
        issue("a", "src/a.ts", "low", "todo-comment"),
      ],
    });

    assert.deepEqual(summary?.handoffs.map((handoff) => handoff.file), ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(summary?.ownerSummaries.map((owner) => owner.owner), ["@team-a", "@team-b"]);
  });

  it("returns undefined when no CODEOWNERS source is provided", () => {
    assert.equal(buildOwnershipSummary({ issues: [issue("a", "src/a.ts", "low", "todo-comment")] }), undefined);
  });
});

function codeownersFile(content: string): CodeownersFile {
  const parsed = parseCodeowners(content, "/repo/.github/CODEOWNERS");
  return {
    path: "/repo/.github/CODEOWNERS",
    root: "/repo",
    rules: parsed.rules,
    warnings: parsed.warnings,
  };
}

function issue(id: string, file: string, severity: Severity, ruleId: string): DebtIssue {
  return {
    id,
    fingerprint: id,
    ruleId,
    ruleName: ruleId,
    severity,
    confidence: 0.9,
    message: `${ruleId} finding`,
    file,
    tags: [],
  };
}
