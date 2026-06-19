import type { Command } from "commander";
import { resolve } from "node:path";
import { RULE_PACK_IDS } from "../../config/packs.js";
import { detectorIds } from "../../detectors/index.js";
import { gatePresets } from "../../core/gatePresets.js";
import { parseConfidence, parseInteger, parseOptionalInteger } from "../parse.js";
import { runWatch } from "../watch.js";

export function registerWatchCommand(program: Command): void {
  program.command("watch")
    .description("Re-run scans when files change during local development.")
    .argument("[target]", "directory or file to scan", ".")
    .option("-i, --include <patterns>", "comma-separated glob patterns to include")
    .option("-x, --exclude <patterns>", "comma-separated glob patterns to exclude")
    .option("--min-severity <severity>", "info, low, medium, or high", "low")
    .option("--pack <pack>", `built-in rule pack preset (${RULE_PACK_IDS.join(", ")})`)
    .option("--rules <rules>", `comma-separated rule ids. Available: ${detectorIds.join(", ")}`)
    .option("--threshold <thresholds>", "comma-separated key=value threshold overrides")
    .option("--max-files <count>", "maximum files to scan", parseInteger)
    .option("--format <format>", "terminal, json, markdown, pr-comment, sarif, html, junit, or gitlab-codequality", "terminal")
    .option("-o, --output <path>", "write the report to a file instead of stdout")
    .option("--fail-on <severity>", "exit with code 1 when any issue meets this severity")
    .option("--fail-on-confidence <0-1>", "with --fail-on, require at least this confidence to fail", parseConfidence)
    .option("--gate <preset>", `named quality gate preset (${gatePresets.join(", ")})`)
    .option("--fail-on-regression", "exit with code 1 when counts increase versus --baseline or --diff-base")
    .option("--baseline <path>", "report only issues absent from this baseline file")
    .option("--diff-base <ref>", "report only findings introduced since this git ref")
    .option("--write-baseline [path]", "not supported in watch mode")
    .option("--changed [ref]", "scan only files changed vs HEAD (or vs <ref> if given)")
    .option("--staged", "scan only files staged in git")
    .option("--respect-gitignore", "skip files ignored by git")
    .option("--config <path>", "path to debtlens.config.json")
    .option("--cwd <path>", "working directory", process.cwd())
    .option("--package <name>", "scan a single workspace package by name")
    .option("--no-color", "disable ANSI color in terminal output")
    .option("-q, --quiet", "print only the summary line, suppress individual findings")
    .option("--profile", "print per-rule timing without changing findings")
    .option("--audit-suppressions", "include used and unused inline suppression directives in scan output")
    .option("--cache [path]", "reuse unchanged scan results from a content-hash cache")
    .option("--parallel", "run detectors concurrently after source loading")
    .option("--batch-size <count>", "load source files in bounded batches", parseInteger)
    .option("--blame-age", "add introducedDaysAgo metadata to JSON issues using git blame")
    .option("--hotspots [limit]", "rank files by current findings plus recent git churn", parseOptionalInteger)
    .option("--churn-days <count>", "with --hotspots, look back this many days", parseInteger)
    .option("--churn-range <range>", "with --hotspots, use this git revision range instead of --churn-days")
    .option("--group-by <group>", "terminal grouping: severity, rule, or file", "severity")
    .option("--sarif-compact", "with --format sarif, emit only rules referenced by findings")
    .option("--sarif-category <category>", "with --format sarif, set runs[].automationDetails.id for separated code scanning runs")
    .option("--junit-fail-on <severity>", "with --format junit, mark findings at or above this severity as failed testcases")
    .option("--markdown-heatmap [limit]", "with --format markdown, append a debt heatmap table", parseOptionalInteger)
    .option("--debounce <ms>", "watch debounce in milliseconds", parseInteger)
    .action((target: string, rawOptions: Record<string, unknown>) => {
      try {
        runWatch({
          cwd: resolve(String(rawOptions.cwd ?? process.cwd())),
          target,
          rawOptions,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`DebtLens failed: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
