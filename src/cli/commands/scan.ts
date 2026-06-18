import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { loadEffectiveConfig } from "../../config/loadConfig.js";
import { mergeConfig } from "../../config/mergeConfig.js";
import { RULE_PACK_IDS } from "../../config/packs.js";
import { resolveWorkspacePackage } from "../../config/workspaces.js";
import { DEFAULT_BASELINE_FILENAME, createBaseline, writeBaseline } from "../../core/baseline.js";
import { scan } from "../../core/scan.js";
import { getChangedFiles, getStagedFiles } from "../../utils/git.js";
import { parseSeverity } from "../../core/severity.js";
import type { OutputFormat } from "../../core/types.js";
import { detectorIds } from "../../detectors/index.js";
import { renderReport } from "../../reporters/index.js";
import {
  formatProfileReport,
  getGitHubSourceUrlBase,
  normalizeOptionalLimit,
  parseCommaList,
  parseConfidence,
  parseFormat,
  parseGroupBy,
  parseInteger,
  parseOptionalInteger,
  parseRuleList,
  parseThresholds,
} from "../parse.js";
import {
  enrichIssuesWithBlameAge,
  loadConfiguredPlugins,
  resolveFailOn,
  resolveFailOnConfidence,
  resolveReportedIssues,
  shouldFailOnIssue,
  shouldFailOnRegression,
} from "../scanPipeline.js";
import { buildZeroFilesScannedWarning } from "../scanWarnings.js";

export interface ScanCommandResult {
  report: string;
  exitCode: number;
  stderr: string;
}

export function registerScanCommand(program: Command): void {
  program.command("scan")
    .description("Scan a project, directory, or file for maintainability debt.")
    .argument("[target]", "directory or file to scan", ".")
    .option("-i, --include <patterns>", "comma-separated glob patterns to include")
    .option("-x, --exclude <patterns>", "comma-separated glob patterns to exclude")
    .option("--min-severity <severity>", "info, low, medium, or high", "low")
    .option("--pack <pack>", `built-in rule pack preset (${RULE_PACK_IDS.join(", ")})`)
    .option("--rules <rules>", `comma-separated rule ids. Available: ${detectorIds.join(", ")}`)
    .option("--threshold <thresholds>", "comma-separated key=value threshold overrides")
    .option("--max-files <count>", "maximum files to scan", parseInteger)
    .option("--format <format>", "terminal, json, markdown, pr-comment, sarif, html, or junit", "terminal")
    .option("-o, --output <path>", "write the report to a file instead of stdout")
    .option("--fail-on <severity>", "exit with code 1 when any issue meets this severity")
    .option("--fail-on-confidence <0-1>", "with --fail-on, require at least this confidence to fail", parseConfidence)
    .option("--fail-on-regression", "exit with code 1 when counts increase versus --baseline or --diff-base")
    .option("--baseline <path>", "report only issues absent from this baseline file")
    .option("--diff-base <ref>", "report only findings introduced since this git ref")
    .option("--write-baseline [path]", "write current issues to a baseline file and exit")
    .option("--changed [ref]", "scan only files changed vs HEAD (or vs <ref> if given)")
    .option("--staged", "scan only files staged in git")
    .option("--respect-gitignore", "skip files ignored by git")
    .option("--config <path>", "path to debtlens.config.json")
    .option("--cwd <path>", "working directory", process.cwd())
    .option("--package <name>", "scan a single workspace package by name")
    .option("--no-color", "disable ANSI color in terminal output")
    .option("-q, --quiet", "print only the summary line, suppress individual findings")
    .option("--profile", "print per-rule timing without changing findings")
    .option("--cache [path]", "reuse unchanged scan results from a content-hash cache")
    .option("--parallel", "run detectors concurrently after source loading")
    .option("--batch-size <count>", "load source files in bounded batches", parseInteger)
    .option("--blame-age", "add introducedDaysAgo metadata to JSON issues using git blame")
    .option("--group-by <group>", "terminal grouping: severity, rule, or file", "severity")
    .option("--sarif-compact", "with --format sarif, emit only rules referenced by findings")
    .option("--markdown-heatmap [limit]", "with --format markdown, append a debt heatmap table", parseOptionalInteger)
    .action(async (target: string, rawOptions: Record<string, unknown>) => {
      try {
        const result = await runScanCommand(target, rawOptions);
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.report) {
          if (rawOptions.output) {
            const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
            const outputPath = resolve(cwd, String(rawOptions.output));
            mkdirSync(dirname(outputPath), { recursive: true });
            writeFileSync(outputPath, result.report, "utf8");
          } else {
            process.stdout.write(result.report);
          }
        }
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

export async function runScanCommand(target: string, rawOptions: Record<string, unknown>): Promise<ScanCommandResult> {
  const stderrChunks: string[] = [];
  const writeStderr = (text: string) => {
    stderrChunks.push(text);
  };

  const format = parseFormat(String(rawOptions.format ?? "terminal"));
  const groupBy = parseGroupBy(String(rawOptions.groupBy ?? "severity"));
  const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
  let scanTarget = target;
  let packageDirectory: string | undefined;
  if (rawOptions.package) {
    const workspacePackage = resolveWorkspacePackage(cwd, String(rawOptions.package));
    scanTarget = workspacePackage.directory;
    packageDirectory = workspacePackage.directory;
  }
  const effectiveConfig = loadEffectiveConfig(cwd, rawOptions.config ? String(rawOptions.config) : undefined, packageDirectory);
  const fileConfig = effectiveConfig.config;
  const pluginContribution = await loadConfiguredPlugins(cwd, rawOptions, fileConfig, effectiveConfig.pluginConfigDir, writeStderr);
  const minSeverity = parseSeverity(String(rawOptions.minSeverity ?? "low"), "low");
  const failOn = resolveFailOn(rawOptions, fileConfig);
  const failOnConfidence = resolveFailOnConfidence(rawOptions, fileConfig);

  let changedFiles: string[] | undefined;
  let fileContents: Record<string, string> | undefined;
  if (rawOptions.staged === true && rawOptions.changed !== undefined) {
    throw new Error("Use either --staged or --changed, not both.");
  }

  if (rawOptions.changed) {
    const base = rawOptions.changed === true ? undefined : String(rawOptions.changed);
    const changed = getChangedFiles(cwd, base);
    if (changed === null) {
      writeStderr("DebtLens: --changed ignored (not a git repository).\n");
    } else {
      changedFiles = changed.files;
    }
  } else if (rawOptions.staged === true) {
    const staged = getStagedFiles(cwd);
    if (staged === null) {
      writeStderr("DebtLens: --staged ignored (not a git repository).\n");
    } else {
      changedFiles = staged.files;
      fileContents = staged.contents;
    }
  }

  const options = mergeConfig(scanTarget, fileConfig, {
    cwd,
    include: parseCommaList(rawOptions.include as string | undefined),
    exclude: parseCommaList(rawOptions.exclude as string | undefined),
    rules: parseRuleList(rawOptions.rules as string | undefined),
    pack: rawOptions.pack ? String(rawOptions.pack) : undefined,
    thresholds: parseThresholds(rawOptions.threshold as string | undefined),
    minSeverity,
    maxFiles: rawOptions.maxFiles as number | undefined,
    cache: rawOptions.cache !== undefined ? true : undefined,
    cachePath: typeof rawOptions.cache === "string" ? rawOptions.cache : undefined,
    parallel: rawOptions.parallel === true ? true : undefined,
    batchSize: rawOptions.batchSize as number | undefined,
    respectGitignore: rawOptions.respectGitignore === true ? true : undefined,
    changedFiles,
    fileContents,
    profile: rawOptions.profile === true,
    pluginDetectors: pluginContribution?.detectors,
    pluginThresholds: pluginContribution?.thresholds,
    pluginVocabulary: pluginContribution?.vocabulary,
  });

  if (rawOptions.writeBaseline && rawOptions.baseline) {
    throw new Error("Use either --write-baseline or --baseline, not both.");
  }
  if (rawOptions.diffBase && rawOptions.baseline) {
    throw new Error("Use either --diff-base or --baseline, not both.");
  }
  if (rawOptions.failOnRegression === true && !rawOptions.baseline && !rawOptions.diffBase) {
    throw new Error("Use --fail-on-regression with --baseline or --diff-base.");
  }

  const result = await scan(options);

  if (result.summary.filesScanned === 0) {
    writeStderr(buildZeroFilesScannedWarning(options.target, options.include, rawOptions.changed !== undefined || rawOptions.staged === true));
  }

  if (result.summary.warnings?.length) {
    for (const warning of result.summary.warnings) {
      writeStderr(`DebtLens warning: ${warning}\n`);
    }
  }

  if (rawOptions.profile === true && result.summary.profile) {
    writeStderr(formatProfileReport(result.summary.profile.ruleTimingsMs));
  }

  if (rawOptions.writeBaseline) {
    const baselinePath = rawOptions.writeBaseline === true
      ? DEFAULT_BASELINE_FILENAME
      : String(rawOptions.writeBaseline);
    const written = writeBaseline(cwd, baselinePath, createBaseline(result.issues));
    return {
      report: `Wrote baseline with ${result.issues.length} issues to ${written}\n`,
      exitCode: 0,
      stderr: stderrChunks.join(""),
    };
  }

  const reported = await resolveReportedIssues(result, {
    cwd,
    baselinePath: rawOptions.baseline ? String(rawOptions.baseline) : undefined,
    diffBase: rawOptions.diffBase ? String(rawOptions.diffBase) : undefined,
    scanOptions: options,
  });
  if (rawOptions.blameAge === true) {
    enrichIssuesWithBlameAge(cwd, options, reported);
  }

  const report = renderReport(reported, format, {
    color: rawOptions.color !== false && format === "terminal" && process.stdout.isTTY === true,
    quiet: rawOptions.quiet === true,
    sourceUrlBase: format === "pr-comment" ? getGitHubSourceUrlBase(process.env) : undefined,
    groupBy,
    sarifCompact: rawOptions.sarifCompact === true,
    markdownHeatmapLimit: normalizeOptionalLimit(rawOptions.markdownHeatmap, 10),
  });

  let exitCode = 0;
  if (failOn && reported.issues.some((issue) => shouldFailOnIssue(issue, failOn, failOnConfidence))) {
    exitCode = 1;
  }
  if (rawOptions.failOnRegression === true && shouldFailOnRegression(reported)) {
    exitCode = 1;
  }

  return {
    report,
    exitCode,
    stderr: stderrChunks.join(""),
  };
}

export async function runScanForMcp(
  target: string,
  args: Record<string, unknown>,
  options?: { format?: OutputFormat },
): Promise<ScanCommandResult> {
  return runScanCommand(target, {
    ...args,
    format: options?.format ?? args.format ?? "json",
    cwd: args.cwd ?? process.cwd(),
  });
}
