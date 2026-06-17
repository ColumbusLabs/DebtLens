import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findConfigPath, findLocalConfigPath, loadEffectiveConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { validateConfigShape } from "../config/validateConfig.js";
import { resolveWorkspacePackage } from "../config/workspaces.js";
import { allDetectors } from "../detectors/index.js";
import { resolveFilePaths } from "../core/resolveFiles.js";
import type { CliOptions, ScanOptions } from "../core/types.js";
import { getChangedFiles, getStagedFiles, isGitRepo } from "../utils/git.js";
import { buildZeroFilesScannedWarning } from "./scanWarnings.js";

export interface DoctorInput {
  target: string;
  cwd: string;
  configPath?: string;
  packageName?: string;
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
  ok: boolean;
}

export async function runDoctor(input: DoctorInput): Promise<DoctorReport> {
  let target = input.target;
  let packageDirectory: string | undefined;
  if (input.packageName) {
    const workspacePackage = resolveWorkspacePackage(input.cwd, input.packageName);
    packageDirectory = workspacePackage.directory;
    target = packageDirectory;
  }

  const configPath = findConfigPath(input.cwd, input.configPath);
  const packageConfigPath = packageDirectory ? findLocalConfigPath(packageDirectory) : undefined;
  const explicitConfigPath = input.configPath ? resolve(input.cwd, input.configPath) : undefined;
  const missingConfigPath = explicitConfigPath && !existsSync(explicitConfigPath)
    ? explicitConfigPath
    : undefined;
  const displayConfigPaths = [
    configPath && existsSync(configPath) ? configPath : undefined,
    packageConfigPath && packageConfigPath !== configPath ? packageConfigPath : undefined,
  ].filter((path): path is string => path !== undefined);
  const configValidation = combineConfigValidations([
    { path: configPath, result: validateConfigAtPath(configPath, missingConfigPath) },
    packageConfigPath && packageConfigPath !== configPath
      ? { path: packageConfigPath, result: validateConfigAtPath(packageConfigPath, undefined) }
      : undefined,
  ]);
  const effectiveConfig = configValidation.state === "invalid"
    ? { config: {}, paths: [], pluginConfigDir: input.cwd }
    : loadEffectiveConfig(input.cwd, input.configPath, packageDirectory);
  const fileConfig = configValidation.state === "invalid"
    ? {}
    : effectiveConfig.config;
  const options = mergeConfig(target, fileConfig, input.cliOptions);
  const filePaths = await resolveFilePaths(options);
  const resolvedRules = resolveRuleIds(options);
  const warnings = missingConfigPath
    ? [`DebtLens warning: config file not found at ${missingConfigPath}.`]
    : configValidation.state === "invalid"
      ? [`DebtLens warning: config schema validation failed: ${configValidation.errors.join("; ")}.`]
    : [];

  const lines = [
    "DebtLens Doctor",
    "===============",
    `Working directory: ${options.cwd}`,
    `Config: ${formatConfigPaths(missingConfigPath, displayConfigPaths)}`,
    `Config schema: ${formatConfigSchemaStatus(configValidation)}`,
    `Target: ${options.target}`,
    ...(input.packageName ? [`Package: ${input.packageName}`] : []),
    `Pack: ${options.pack ?? "(none)"}`,
    `Rules: ${resolvedRules.join(", ")}`,
    `Thresholds: ${formatThresholds(options.thresholds)}`,
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

  return { text: `${lines.join("\n")}\n`, ok: configValidation.state !== "invalid" };
}

function validateConfigAtPath(configPath: string | undefined, missingConfigPath: string | undefined): ConfigValidationResultForDoctor {
  if (!configPath || missingConfigPath || !existsSync(configPath)) {
    return { state: "not-found" };
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const validation = validateConfigShape(parsed);
    return validation.valid
      ? { state: "valid" }
      : { state: "invalid", errors: validation.errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: "invalid", errors: [`could not parse config JSON: ${message}`] };
  }
}

type ConfigValidationResultForDoctor =
  | { state: "not-found" }
  | { state: "valid" }
  | { state: "invalid"; errors: string[] };

interface NamedConfigValidation {
  path?: string;
  result: ConfigValidationResultForDoctor;
}

function combineConfigValidations(
  validations: Array<NamedConfigValidation | undefined>,
): ConfigValidationResultForDoctor {
  const present = validations.filter((entry): entry is NamedConfigValidation => entry !== undefined);
  const invalid = present.filter((entry) => entry.result.state === "invalid");
  if (invalid.length > 0) {
    return {
      state: "invalid",
      errors: invalid.flatMap((entry) => {
        const prefix = entry.path ? `${entry.path}: ` : "";
        return entry.result.state === "invalid"
          ? entry.result.errors.map((error) => `${prefix}${error}`)
          : [];
      }),
    };
  }
  return present.some((entry) => entry.result.state === "valid")
    ? { state: "valid" }
    : { state: "not-found" };
}

function formatConfigSchemaStatus(result: ConfigValidationResultForDoctor): string {
  if (result.state === "not-found") return "(not checked)";
  if (result.state === "valid") return "valid";
  return `invalid (${result.errors.join("; ")})`;
}

function formatConfigPaths(missingConfigPath: string | undefined, configPaths: string[]): string {
  if (missingConfigPath) return `${missingConfigPath} (missing)`;
  if (configPaths.length === 0) return "(none found)";
  return configPaths.join(" + ");
}

function formatThresholds(thresholds: ScanOptions["thresholds"]): string {
  const entries = Object.entries(thresholds).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "(none)";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function resolveRuleIds(options: ScanOptions): string[] {
  if (options.rules?.length) {
    return options.rules;
  }

  return allDetectors.map((detector) => detector.id);
}
