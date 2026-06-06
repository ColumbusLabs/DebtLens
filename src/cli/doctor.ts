import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findConfigPath, loadConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { allDetectors } from "../detectors/index.js";
import { resolveFilePaths } from "../core/resolveFiles.js";
import type { CliOptions, ScanOptions } from "../core/types.js";
import { getChangedFiles, getStagedFiles, isGitRepo } from "../utils/git.js";
import { buildZeroFilesScannedWarning } from "./scanWarnings.js";

export interface DoctorInput {
  target: string;
  cwd: string;
  configPath?: string;
  baselinePath?: string;
  usedChanged: boolean;
  usedStaged: boolean;
  changedIgnored: boolean;
  stagedIgnored: boolean;
  gitChangedCount?: number;
  gitStagedCount?: number;
  cliOptions: CliOptions;
}

export interface DoctorReport {
  text: string;
}

export async function runDoctor(input: DoctorInput): Promise<DoctorReport> {
  const fileConfig = loadConfig(input.cwd, input.configPath);
  const options = mergeConfig(input.target, fileConfig, input.cliOptions);
  const configPath = findConfigPath(input.cwd, input.configPath);
  const explicitConfigPath = input.configPath ? resolve(input.cwd, input.configPath) : undefined;
  const missingConfigPath = explicitConfigPath && !existsSync(explicitConfigPath)
    ? explicitConfigPath
    : undefined;
  const filePaths = await resolveFilePaths(options);
  const resolvedRules = resolveRuleIds(options);
  const warnings = missingConfigPath
    ? [`DebtLens warning: config file not found at ${missingConfigPath}.`]
    : [];

  const lines = [
    "DebtLens Doctor",
    "===============",
    `Working directory: ${options.cwd}`,
    `Config: ${missingConfigPath ? `${missingConfigPath} (missing)` : configPath ?? "(none found)"}`,
    `Target: ${options.target}`,
    `Pack: ${options.pack ?? "(none)"}`,
    `Rules: ${resolvedRules.join(", ")}`,
    `Min severity: ${options.minSeverity}`,
    `Max files: ${options.maxFiles ?? "(unlimited)"}`,
    `Include globs: ${options.include.join(", ")}`,
    `Exclude globs: ${options.exclude.join(", ")}`,
    `Respect gitignore: ${options.respectGitignore ? "yes" : "no"}`,
    `Git repository: ${isGitRepo(input.cwd) ? "yes" : "no"}`,
  ];

  if (input.baselinePath) {
    lines.push(`Baseline: ${resolve(input.cwd, input.baselinePath)}`);
  }

  if (input.usedChanged) {
    if (input.changedIgnored) {
      lines.push("Changed mode: ignored (not a git repository)");
    } else {
      lines.push(`Changed mode: ${input.gitChangedCount ?? 0} file(s) from git diff`);
    }
  }

  if (input.usedStaged) {
    if (input.stagedIgnored) {
      lines.push("Staged mode: ignored (not a git repository)");
    } else {
      lines.push(`Staged mode: ${input.gitStagedCount ?? 0} file(s) from git index`);
    }
  }

  lines.push(`Matched files: ${filePaths.length}`);

  if (warnings.length) {
    lines.push("");
    lines.push(...warnings);
  }

  if (filePaths.length === 0) {
    lines.push("");
    lines.push(buildZeroFilesScannedWarning(
      options.target,
      options.include,
      input.usedChanged || input.usedStaged,
    ).trimEnd());
  }

  return { text: `${lines.join("\n")}\n` };
}

function resolveRuleIds(options: ScanOptions): string[] {
  if (options.rules?.length) {
    return options.rules;
  }

  return allDetectors.map((detector) => detector.id);
}
