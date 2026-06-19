import type { Command } from "commander";
import { RULE_PACK_IDS } from "../../config/packs.js";
import { DEFAULT_BASELINE_FILENAME } from "../../core/baseline.js";
import { detectorIds } from "../../detectors/index.js";
import { parseInteger } from "../parse.js";
import {
  type BaselineMaintenanceMode,
  runBaselineMaintenanceCommand,
} from "../baselineMaintenance.js";

export function registerBaselineCommand(program: Command): void {
  const baseline = program.command("baseline")
    .description("Inspect and maintain DebtLens baseline files.");

  addBaselineSubcommand(baseline, "diff", "Preview new, resolved, and changed debt without writing files.");
  addBaselineSubcommand(baseline, "prune", "Remove resolved entries from a baseline file.");
  addBaselineSubcommand(baseline, "update", "Rewrite a baseline file to the current scan result.");
}

function addBaselineSubcommand(parent: Command, mode: BaselineMaintenanceMode, description: string): void {
  const command = parent.command(mode)
    .description(description)
    .argument("[target]", "directory or file to scan", ".")
    .option("--baseline <path>", "baseline file to inspect or update", DEFAULT_BASELINE_FILENAME)
    .option("--format <format>", "terminal or json", "terminal")
    .option("-i, --include <patterns>", "comma-separated glob patterns to include")
    .option("-x, --exclude <patterns>", "comma-separated glob patterns to exclude")
    .option("--min-severity <severity>", "info, low, medium, or high", "low")
    .option("--pack <pack>", `built-in rule pack preset (${RULE_PACK_IDS.join(", ")})`)
    .option("--rules <rules>", `comma-separated rule ids. Available: ${detectorIds.join(", ")}`)
    .option("--threshold <thresholds>", "comma-separated key=value threshold overrides")
    .option("--max-files <count>", "maximum files to scan", parseInteger)
    .option("--respect-gitignore", "skip files ignored by git")
    .option("--config <path>", "path to debtlens.config.json")
    .option("--cwd <path>", "working directory", process.cwd())
    .option("--package <name>", "scan a single workspace package by name")
    .option("--cache [path]", "reuse unchanged scan results from a content-hash cache")
    .option("--parallel", "run detectors concurrently after source loading")
    .option("--batch-size <count>", "load source files in bounded batches", parseInteger);

  if (mode !== "diff") {
    command.option("--dry-run", "preview without writing the baseline file");
  }

  command.action(async (target: string, rawOptions: Record<string, unknown>) => {
    try {
      const result = await runBaselineMaintenanceCommand(mode, target, rawOptions);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.report) process.stdout.write(result.report);
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`DebtLens failed: ${message}\n`);
      process.exitCode = 1;
    }
  });
}
