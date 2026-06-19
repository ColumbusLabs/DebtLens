import type { Command } from "commander";
import { resolve } from "node:path";
import { RULE_PACK_IDS } from "../../config/packs.js";
import { parseSeverity } from "../../core/severity.js";
import { detectorIds } from "../../detectors/index.js";
import { getChangedFiles, getStagedFiles } from "../../utils/git.js";
import { runDoctor } from "../doctor.js";
import { parseCommaList, parseInteger, parseRuleList, parseThresholds } from "../parse.js";

export interface DoctorCommandResult {
  text: string;
  exitCode: number;
}

export function registerDoctorCommand(program: Command): void {
  program.command("doctor")
    .description("Inspect resolved config and file matching without running detectors.")
    .argument("[target]", "directory or file to inspect", ".")
    .option("-i, --include <patterns>", "comma-separated glob patterns to include")
    .option("-x, --exclude <patterns>", "comma-separated glob patterns to exclude")
    .option("--min-severity <severity>", "info, low, medium, or high")
    .option("--pack <pack>", `built-in rule pack preset (${RULE_PACK_IDS.join(", ")})`)
    .option("--rules <rules>", `comma-separated rule ids. Available: ${detectorIds.join(", ")}`)
    .option("--threshold <thresholds>", "comma-separated key=value threshold overrides")
    .option("--max-files <count>", "maximum files to scan", parseInteger)
    .option("--baseline <path>", "baseline path to report (not loaded)")
    .option("--changed [ref]", "include git changed-file diagnostics")
    .option("--staged", "include git staged-file diagnostics")
    .option("--respect-gitignore", "skip files ignored by git")
    .option("--config <path>", "path to debtlens.config.json")
    .option("--cwd <path>", "working directory", process.cwd())
    .option("--package <name>", "inspect a single workspace package by name")
    .option("--provenance", "show which layer supplied resolved config values")
    .action(async (target: string, rawOptions: Record<string, unknown>) => {
      try {
        const result = await runDoctorCommand(target, rawOptions);
        process.stdout.write(result.text);
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

export async function runDoctorCommand(target: string, rawOptions: Record<string, unknown>): Promise<DoctorCommandResult> {
  const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
  if (rawOptions.staged === true && rawOptions.changed !== undefined) {
    throw new Error("Use either --staged or --changed, not both.");
  }

  let changedFiles: string[] | undefined;
  let changedIgnored = false;
  let stagedIgnored = false;
  let gitChangedCount: number | undefined;
  let gitStagedCount: number | undefined;

  if (rawOptions.changed) {
    const base = rawOptions.changed === true ? undefined : String(rawOptions.changed);
    const changed = getChangedFiles(cwd, base);
    if (changed === null) {
      changedIgnored = true;
    } else {
      changedFiles = changed.files;
      gitChangedCount = changed.files.length;
    }
  } else if (rawOptions.staged === true) {
    const staged = getStagedFiles(cwd);
    if (staged === null) {
      stagedIgnored = true;
    } else {
      changedFiles = staged.files;
      gitStagedCount = staged.files.length;
    }
  }

  const report = await runDoctor({
    target,
    cwd,
    configPath: rawOptions.config ? String(rawOptions.config) : undefined,
    packageName: rawOptions.package ? String(rawOptions.package) : undefined,
    baselinePath: rawOptions.baseline ? String(rawOptions.baseline) : undefined,
    usedChanged: rawOptions.changed !== undefined,
    usedStaged: rawOptions.staged === true,
    changedIgnored,
    stagedIgnored,
    gitChangedCount,
    gitStagedCount,
    cliOptions: {
      cwd,
      include: parseCommaList(rawOptions.include as string | undefined),
      exclude: parseCommaList(rawOptions.exclude as string | undefined),
      rules: parseRuleList(rawOptions.rules as string | undefined),
      pack: rawOptions.pack ? String(rawOptions.pack) : undefined,
      minSeverity: parseSeverity(String(rawOptions.minSeverity ?? "low"), "low"),
      thresholds: parseThresholds(rawOptions.threshold as string | undefined),
      maxFiles: rawOptions.maxFiles as number | undefined,
      respectGitignore: rawOptions.respectGitignore === true ? true : undefined,
      changedFiles,
    },
    cliSources: {
      include: rawOptions.include !== undefined,
      exclude: rawOptions.exclude !== undefined,
      minSeverity: rawOptions.minSeverity !== undefined,
      pack: rawOptions.pack !== undefined,
      rules: rawOptions.rules !== undefined,
      thresholds: rawOptions.threshold !== undefined,
      maxFiles: rawOptions.maxFiles !== undefined,
      respectGitignore: rawOptions.respectGitignore === true,
    },
    showProvenance: rawOptions.provenance === true,
  });

  return {
    text: report.text,
    exitCode: report.ok ? 0 : 1,
  };
}

export async function runDoctorForMcp(target: string, args: Record<string, unknown>): Promise<DoctorCommandResult> {
  return runDoctorCommand(target, {
    ...args,
    cwd: args.cwd ?? process.cwd(),
  });
}
