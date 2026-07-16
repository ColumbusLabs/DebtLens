import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");
const localRequire = createRequire(import.meta.url);
const tsxLoader = localRequire.resolve("tsx");

const lowReactThresholds = [
  "--threshold",
  "large-component.maxLines=50,large-component.maxHooks=3,large-component.maxBranches=5",
];

function runCli(args: string[], options: { cwd?: string } = {}) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cliEntrypoint, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
  });
}

describe("debtlens calibrate", () => {
  it("prints percentile-based threshold suggestions", () => {
    const result = runCli([
      "calibrate",
      "examples/react",
      "--pack",
      "react",
      ...lowReactThresholds,
      "--percentile",
      "90",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DebtLens calibrate \(p90\)/);
    assert.match(result.stdout, /large-component\.maxBranches/);
    assert.match(result.stdout, /Suggested config snippet/);
  });

  it("collects below-threshold metrics and can recommend lower thresholds", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-calibrate-distribution-"));
    try {
      const sourcePath = join(dir, "src", "Widgets.tsx");
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(sourcePath, [
        "export function SmallWidget() {",
        "  const value = 1;",
        "  return <div>{value}</div>;",
        "}",
        "",
        "export function MediumWidget() {",
        "  const first = 1;",
        "  const second = 2;",
        "  return <div>{first + second}</div>;",
        "}",
        "",
      ].join("\n"));
      writeFileSync(join(dir, "src", "helpers.ts"), [
        "export function addOne(value: number) {",
        "  return value + 1;",
        "}",
        "",
        "export function addTwo(value: number) {",
        "  const next = value + 1;",
        "  return next + 1;",
        "}",
        "",
      ].join("\n"));

      const result = runCli([
        "calibrate",
        ".",
        "--cwd",
        dir,
        "--rules",
        "large-component,large-function",
        "--percentile",
        "50",
      ]);

      assert.equal(result.status, 0, result.stderr);
      const row = result.stdout.split("\n").find((line) => line.startsWith("large-component.maxLines"));
      assert.ok(row);
      const [, current, suggested, samples] = row.trim().split(/\s+/);
      assert.equal(Number(current), 250);
      assert.ok(Number(suggested) < Number(current));
      assert.equal(Number(samples), 2);
      const functionRow = result.stdout.split("\n").find((line) => line.startsWith("large-function.maxLines"));
      assert.ok(functionRow);
      assert.equal(Number(functionRow.trim().split(/\s+/)[3]), 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges suggested thresholds with --write", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-calibrate-write-"));
    try {
      const configPath = join(dir, "debtlens.config.json");
      writeFileSync(configPath, JSON.stringify({
        pack: "react",
        rules: ["large-component"],
        minSeverity: "low",
        thresholds: {
          "large-component.maxLines": 500,
          "large-component.maxHooks": 3,
          "large-component.maxBranches": 5,
        },
      }));

      const result = runCli([
        "calibrate",
        "examples/react",
        "--cwd",
        repoRoot,
        "--config",
        configPath,
        "--pack",
        "react",
        ...lowReactThresholds,
        "--write",
      ]);
      assert.equal(result.status, 0, result.stderr);

      const config = JSON.parse(readFileSync(configPath, "utf8")) as {
        minSeverity: string;
        thresholds: Record<string, number>;
      };
      assert.equal(config.minSeverity, "low");
      assert.ok(config.thresholds["large-component.maxLines"] < 500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
