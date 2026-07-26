import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Command } from "commander";
import { loadEffectiveConfig } from "../../config/loadConfig.js";
import { mergeConfig } from "../../config/mergeConfig.js";
import { RULE_PACK_IDS } from "../../config/packs.js";
import { resolveWorkspacePackage } from "../../config/workspaces.js";
import { DEFAULT_BASELINE_FILENAME, createBaseline, writeBaseline } from "../../core/baseline.js";
import { evaluateBudgets, renderBudgetReport, type BudgetEvaluation } from "../../core/budgets.js";
import { buildOwnershipReport, renderOwnershipReportTerminal } from "../../core/ownershipReport.js";
import { enrichIssuesWithPayoffScores, selectTopPayoffResult, sortIssuesByPayoff, topPayoffIssues } from "../../core/priority.js";
import { buildGitChurnHotspots } from "../../core/hotspots.js";
import { buildOwnershipSummary, loadCodeowners } from "../../core/ownership.js";
import { scan } from "../../core/scan.js";
import { canonicalizePath, getChangedFiles, getFileChurn, getStagedFiles } from "../../utils/git.js";
import { parseSeverity } from "../../core/severity.js";
import type { DebtIssue, DebtLensConfig, OutputFormat, ScanOptions, ScanResult, Severity, TerminalGroupBy } from "../../core/types.js";
import { detectorIds } from "../../detectors/index.js";
import { renderReport } from "../../reporters/index.js";
import { renderBadgeEndpoint, parseBadgeThresholds } from "../../reporters/badgeReporter.js";
import { applyGatePresetDefaults, gatePresets } from "../../core/gatePresets.js";
import {
  formatProfileReport,
  getGitHubSourceUrlBase,
  normalizeOptionalLimit,
  parseCommaList,
  parseConfidence,
  parseFormat,
  parseGroupBy,
  parseInteger,
  parseNonNegativeInteger,
  parseOptionalInteger,
  parseRuleList,
  parseThresholds,
} from "../parse.js";
import {
  enrichIssuesWithBlameAge,
  loadConfiguredPlugins,
  type PluginContribution,
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

interface PreparedScanCommandContext {
  rawOptions: Record<string, unknown>;
  format: OutputFormat;
  groupBy: TerminalGroupBy;
  junitFailOn?: Severity;
  cwd: string;
  scanTarget: string;
  fileConfig: DebtLensConfig;
  minSeverity: Severity;
  failOn?: Severity;
  failOnConfidence?: number;
  pluginContribution?: PluginContribution;
}

interface GitScanScope {
  changedFiles?: string[];
  fileContents?: Record<string, string>;
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
    .option("--format <format>", "terminal, json, markdown, pr-comment, sarif, html, junit, gitlab-codequality, or badge", "terminal")
    .option("-o, --output <path>", "write the report to a file instead of stdout")
    .option("--fail-on <severity>", "exit with code 1 when any issue meets this severity")
    .option("--fail-on-confidence <0-1>", "with --fail-on, require at least this confidence to fail", parseConfidence)
    .option("--gate <preset>", `named quality gate preset (${gatePresets.join(", ")})`)
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
    .option("--audit-suppressions", "include used and unused inline suppression directives in scan output")
    .option("--cache [path]", "reuse unchanged scan results from a content-hash cache")
    .option("--parallel", "run detectors concurrently after source loading")
    .option("--concurrency <count>", "maximum concurrent detector runs for large scans (1 disables)", parseInteger)
    .option("--cache-dir <path>", "shared cache directory for CI artifact restore")
    .option("--batch-size <count>", "load source files in bounded batches", parseInteger)
    .option("--blame-age", "add introducedDaysAgo metadata to JSON issues using git blame")
    .option("--hotspots [limit]", "rank files by current findings plus recent git churn", parseOptionalInteger)
    .option("--churn-days <count>", "with --hotspots, look back this many days", parseInteger)
    .option("--churn-range <range>", "with --hotspots, use this git revision range instead of --churn-days")
    .option("--ownership-report", "render CODEOWNERS ownership scorecards instead of a scan report")
    .option("--owner <pattern>", "with --ownership-report, filter to one owner team")
    .option("--ownership", "attach CODEOWNERS-based ownership summaries to reports")
    .option("--codeowners <path>", "with --ownership, read ownership rules from this CODEOWNERS file")
    .option("--group-by <group>", "terminal grouping: severity, rule, or file", "severity")
    .option("--sarif-compact", "with --format sarif, emit only rules referenced by findings")
    .option("--sarif-category <category>", "with --format sarif, set runs[].automationDetails.id for separated code scanning runs")
    .option("--junit-fail-on <severity>", "with --format junit, mark findings at or above this severity as failed testcases")
    .option("--markdown-heatmap [limit]", "with --format markdown, append a debt heatmap table", parseOptionalInteger)
    .option("--pr-comment-max-findings <count>", "with --format pr-comment, cap detailed findings and summarize omitted findings", parseNonNegativeInteger)
    .option("--pr-comment-max-bytes <count>", "with --format pr-comment, cap the rendered comment body in bytes", parseInteger)
    .option("--pr-comment-full-report-url <url>", "with --format pr-comment, link omitted findings to a full report artifact")
    .option("--budget-report", "print per-area budget usage without failing the gate")
    .option("--sort <field>", "sort findings by severity or payoff")
    .option("--top <count>", "show only the top N payoff-ranked findings while evaluating the full scan", parseInteger)
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

  const context = await prepareScanCommandContext(target, rawOptions, writeStderr);
  rawOptions = context.rawOptions;
  const { cwd, failOn, failOnConfidence, fileConfig, format, groupBy, junitFailOn } = context;
  const gitScope = resolveGitScanScope(context.cwd, rawOptions, writeStderr);
  const options = buildMergedScanOptions(context, gitScope);

  validateScanModes(rawOptions);

  const result = await scan(options);

  emitScanDiagnostics(result, options, rawOptions, writeStderr);

  if (rawOptions.writeBaseline) {
    return {
      report: writeBaselineReport(cwd, rawOptions.writeBaseline, result),
      exitCode: 0,
      stderr: stderrChunks.join(""),
    };
  }

  const reported = await prepareReportedScanResult({
    cwd,
    fileConfig,
    options,
    rawOptions,
    result,
    writeStderr,
  });

  const budgetEvaluation = evaluateBudgets(reported, options.budgets);
  const budgetReportOnly = rawOptions.budgetReport === true;

  if (budgetReportOnly && budgetEvaluation) {
    return {
      report: renderBudgetReport(budgetEvaluation),
      exitCode: 0,
      stderr: stderrChunks.join(""),
    };
  }

  if (rawOptions.ownershipReport === true) {
    enrichIssuesWithPayoffScores(reported.issues, {
      hotspots: reported.summary.hotspots,
      weights: fileConfig.priority,
    });
    const ownershipReport = buildOwnershipReport({
      result: reported,
      cwd,
      codeownersPath: typeof rawOptions.codeowners === "string" ? rawOptions.codeowners : undefined,
      ownerFilter: typeof rawOptions.owner === "string" ? rawOptions.owner : undefined,
    });
    if (!ownershipReport) {
      writeStderr("DebtLens: --ownership-report ignored (CODEOWNERS not found).\n");
      return { report: "", exitCode: 1, stderr: stderrChunks.join("") };
    }
    return {
      report: renderOwnershipReportTerminal(ownershipReport),
      exitCode: 0,
      stderr: stderrChunks.join(""),
    };
  }

  const badgeThresholds = parseBadgeThresholds(fileConfig.badge);

  const displayed = typeof rawOptions.top === "number"
    ? selectTopPayoffResult(reported, rawOptions.top)
    : reported;

  let report = renderReport(displayed, format, {
    color: rawOptions.color !== false && format === "terminal" && process.stdout.isTTY === true,
    quiet: rawOptions.quiet === true,
    sourceUrlBase: format === "pr-comment" ? getGitHubSourceUrlBase(process.env) : undefined,
    groupBy,
    sarifCompact: rawOptions.sarifCompact === true,
    sarifCategory: rawOptions.sarifCategory ? String(rawOptions.sarifCategory) : undefined,
    junitFailOn,
    markdownHeatmapLimit: normalizeOptionalLimit(rawOptions.markdownHeatmap, 10),
    prCommentMaxFindings: rawOptions.prCommentMaxFindings as number | undefined,
    prCommentMaxBytes: rawOptions.prCommentMaxBytes as number | undefined,
    prCommentArtifactLink: rawOptions.prCommentFullReportUrl ? String(rawOptions.prCommentFullReportUrl) : undefined,
    badgeThresholds,
  });

  if (format === "badge" && rawOptions.output) {
    const outputPath = resolve(cwd, String(rawOptions.output));
    const endpoint = renderBadgeEndpoint(reported, { thresholds: badgeThresholds });
    if (outputPath.endsWith(".json")) {
      report = endpoint;
    } else {
      const jsonPath = outputPath.endsWith(".svg")
        ? outputPath.replace(/\.svg$/, ".json")
        : `${outputPath.replace(/\.(svg|json)$/i, "")}.json`;
      mkdirSync(dirname(jsonPath), { recursive: true });
      writeFileSync(jsonPath, endpoint, "utf8");
    }
  }

  const exitCode = computeScanExitCode({
    budgetEvaluation,
    budgetReportOnly,
    failOn,
    failOnConfidence,
    rawOptions,
    reported,
    writeStderr,
  });

  return {
    report,
    exitCode,
    stderr: stderrChunks.join(""),
  };
}

async function prepareScanCommandContext(
  target: string,
  rawOptions: Record<string, unknown>,
  writeStderr: (text: string) => void,
): Promise<PreparedScanCommandContext> {
  const format = parseFormat(String(rawOptions.format ?? "terminal"));
  const groupBy = parseGroupBy(String(rawOptions.groupBy ?? "severity"));
  const junitFailOn = rawOptions.junitFailOn !== undefined ? parseSeverity(String(rawOptions.junitFailOn), "info") : undefined;
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
  const gate = applyGatePresetDefaults(rawOptions, fileConfig);
  const gatedOptions = gate.rawOptions;
  const pluginContribution = await loadConfiguredPlugins(
    cwd,
    gatedOptions,
    fileConfig,
    effectiveConfig.pluginConfigDir,
    writeStderr,
  );

  return {
    rawOptions: gatedOptions,
    format,
    groupBy,
    junitFailOn,
    cwd,
    scanTarget,
    fileConfig,
    minSeverity: parseSeverity(String(gatedOptions.minSeverity ?? "low"), "low"),
    failOn: resolveFailOn(gatedOptions, fileConfig),
    failOnConfidence: resolveFailOnConfidence(gatedOptions, fileConfig),
    pluginContribution,
  };
}

function resolveGitScanScope(
  cwd: string,
  rawOptions: Record<string, unknown>,
  writeStderr: (text: string) => void,
): GitScanScope {
  if (rawOptions.staged === true && rawOptions.changed !== undefined) {
    throw new Error("Use either --staged or --changed, not both.");
  }

  if (rawOptions.changed) {
    const base = rawOptions.changed === true ? undefined : String(rawOptions.changed);
    const changed = getChangedFiles(cwd, base);
    if (changed === null) {
      writeStderr("DebtLens: --changed ignored (not a git repository).\n");
      return {};
    }
    return { changedFiles: changed.files };
  }

  if (rawOptions.staged === true) {
    const staged = getStagedFiles(cwd);
    if (staged === null) {
      writeStderr("DebtLens: --staged ignored (not a git repository).\n");
      return {};
    }
    return {
      changedFiles: staged.files,
      fileContents: staged.contents,
    };
  }

  return {};
}

function buildMergedScanOptions(
  context: PreparedScanCommandContext,
  gitScope: GitScanScope,
): ScanOptions {
  const rawOptions = context.rawOptions;
  return mergeConfig(context.scanTarget, context.fileConfig, {
    cwd: context.cwd,
    include: parseCommaList(rawOptions.include as string | undefined),
    exclude: parseCommaList(rawOptions.exclude as string | undefined),
    rules: parseRuleList(rawOptions.rules as string | undefined),
    pack: rawOptions.pack ? String(rawOptions.pack) : undefined,
    thresholds: parseThresholds(rawOptions.threshold as string | undefined),
    minSeverity: context.minSeverity,
    maxFiles: rawOptions.maxFiles as number | undefined,
    cache: rawOptions.cache !== undefined || rawOptions.cacheDir !== undefined ? true : undefined,
    cachePath: typeof rawOptions.cache === "string" ? rawOptions.cache : undefined,
    parallel: rawOptions.parallel === true ? true : undefined,
    concurrency: rawOptions.concurrency as number | undefined,
    cacheDir: typeof rawOptions.cacheDir === "string" ? rawOptions.cacheDir : undefined,
    batchSize: rawOptions.batchSize as number | undefined,
    respectGitignore: rawOptions.respectGitignore === true ? true : undefined,
    changedFiles: gitScope.changedFiles,
    fileContents: gitScope.fileContents,
    profile: rawOptions.profile === true,
    auditSuppressions: rawOptions.auditSuppressions === true,
    pluginDetectors: context.pluginContribution?.detectors,
    pluginThresholds: context.pluginContribution?.thresholds,
    pluginVocabulary: context.pluginContribution?.vocabulary,
  });
}

function validateScanModes(rawOptions: Record<string, unknown>): void {
  if (rawOptions.writeBaseline && rawOptions.baseline) {
    throw new Error("Use either --write-baseline or --baseline, not both.");
  }
  if (rawOptions.diffBase && rawOptions.baseline) {
    throw new Error("Use either --diff-base or --baseline, not both.");
  }
  if (rawOptions.failOnRegression === true && !rawOptions.baseline && !rawOptions.diffBase) {
    throw new Error("Use --fail-on-regression with --baseline or --diff-base.");
  }
  if (rawOptions.top !== undefined) {
    const format = String(rawOptions.format ?? "terminal");
    if (!["terminal", "markdown", "json", "pr-comment"].includes(format)) {
      throw new Error(`Use --top with terminal, markdown, json, or pr-comment output, not ${format}.`);
    }
  }
}

function emitScanDiagnostics(
  result: ScanResult,
  options: ScanOptions,
  rawOptions: Record<string, unknown>,
  writeStderr: (text: string) => void,
): void {
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
}

function writeBaselineReport(cwd: string, rawWriteBaseline: unknown, result: ScanResult): string {
  const baselinePath = rawWriteBaseline === true
    ? DEFAULT_BASELINE_FILENAME
    : String(rawWriteBaseline);
  const written = writeBaseline(cwd, baselinePath, createBaseline(result.issues));
  return `Wrote baseline with ${result.issues.length} issues to ${written}\n`;
}

async function prepareReportedScanResult(input: {
  cwd: string;
  fileConfig: DebtLensConfig;
  options: ScanOptions;
  rawOptions: Record<string, unknown>;
  result: ScanResult;
  writeStderr: (text: string) => void;
}): Promise<ScanResult> {
  const reported = await resolveReportedIssues(input.result, {
    cwd: input.cwd,
    baselinePath: input.rawOptions.baseline ? String(input.rawOptions.baseline) : undefined,
    diffBase: input.rawOptions.diffBase ? String(input.rawOptions.diffBase) : undefined,
    scanOptions: input.options,
  });

  if (input.rawOptions.blameAge === true) {
    enrichIssuesWithBlameAge(input.cwd, input.options, reported);
  }
  enrichWithHotspots(input.cwd, input.options, reported, input.rawOptions, input.writeStderr);
  enrichWithOwnership(input.cwd, input.options, reported, input.rawOptions, input.writeStderr);
  enrichPayoffScores(reported, input.rawOptions, input.fileConfig);

  return reported;
}

function enrichPayoffScores(
  reported: ScanResult,
  rawOptions: Record<string, unknown>,
  fileConfig: DebtLensConfig,
): void {
  if (rawOptions.sort === "payoff" || rawOptions.top !== undefined) {
    enrichIssuesWithPayoffScores(reported.issues, {
      hotspots: reported.summary.hotspots,
      weights: fileConfig.priority,
    });
    if (rawOptions.sort === "payoff") {
      reported.issues = sortIssuesByPayoff(reported.issues);
    }
  } else if (rawOptions.blameAge === true || reported.summary.hotspots) {
    enrichIssuesWithPayoffScores(reported.issues, {
      hotspots: reported.summary.hotspots,
      weights: fileConfig.priority,
    });
  }
  if (reported.issues.some((issue) => issue.payoffScore !== undefined)) {
    const requestedLimit = typeof rawOptions.top === "number" ? rawOptions.top : 10;
    reported.summary.topPayoffTargets = topPayoffIssues(reported.issues, Math.min(requestedLimit, 10)).map((issue) => ({
      id: issue.id,
      fingerprint: issue.fingerprint,
      ruleId: issue.ruleId,
      file: issue.file,
      severity: issue.severity,
      payoffScore: issue.payoffScore ?? 0,
      ...(issue.location ? { location: issue.location } : {}),
    }));
  }
}

function computeScanExitCode(input: {
  budgetEvaluation?: BudgetEvaluation;
  budgetReportOnly: boolean;
  failOn?: Severity;
  failOnConfidence?: number;
  rawOptions: Record<string, unknown>;
  reported: ScanResult;
  writeStderr: (text: string) => void;
}): number {
  let exitCode = 0;
  const failOn = input.failOn;
  if (failOn && input.reported.issues.some((issue) => shouldFailOnIssue(issue, failOn, input.failOnConfidence))) {
    exitCode = 1;
  }
  if (input.rawOptions.failOnRegression === true && shouldFailOnRegression(input.reported)) {
    exitCode = 1;
  }
  if (input.budgetEvaluation?.breached && !input.budgetReportOnly) {
    for (const message of input.budgetEvaluation.messages) {
      input.writeStderr(`DebtLens budget breach: ${message}\n`);
    }
    exitCode = 1;
  }
  return exitCode;
}

function enrichWithHotspots(
  cwd: string,
  options: ScanOptions,
  result: ScanResult,
  rawOptions: Record<string, unknown>,
  writeStderr: (text: string) => void,
): void {
  if (!shouldBuildHotspots(rawOptions) || result.issues.length === 0) return;

  const churnDays = rawOptions.churnDays !== undefined ? Number(rawOptions.churnDays) : 90;
  const churnRange = typeof rawOptions.churnRange === "string" && rawOptions.churnRange.length > 0
    ? rawOptions.churnRange
    : undefined;
  if (churnRange && rawOptions.churnDays !== undefined) {
    throw new Error("Use either --churn-days or --churn-range, not both.");
  }
  const paths = buildIssuePathMaps(options, result.issues);
  const churn = getFileChurn(cwd, [...paths.absoluteByFile.values()], churnRange ? { range: churnRange } : { days: churnDays });
  if (churn === null) {
    writeStderr("DebtLens: --hotspots ignored (not a git repository).\n");
    return;
  }

  const fileToRepositoryPath = new Map<string, string>();
  for (const [file, absolutePath] of paths.absoluteByFile.entries()) {
    const repositoryPath = relative(churn.root, canonicalizePath(absolutePath)).replaceAll("\\", "/");
    if (repositoryPath && !repositoryPath.startsWith("..")) {
      fileToRepositoryPath.set(file, repositoryPath);
    }
  }

  const hotspots = buildGitChurnHotspots({
    issues: result.issues,
    churn: churn.files,
    window: churn.window,
    fileToRepositoryPath,
    limit: normalizeOptionalLimit(rawOptions.hotspots, 5),
  });
  if (hotspots) {
    result.summary.hotspots = hotspots;
  }
}

function shouldBuildHotspots(rawOptions: Record<string, unknown>): boolean {
  if (rawOptions.hotspots === true || typeof rawOptions.hotspots === "number") return true;
  if (typeof rawOptions.hotspots === "string" && rawOptions.hotspots.trim().length > 0) return true;
  if (rawOptions.churnDays !== undefined) return true;
  return typeof rawOptions.churnRange === "string" && rawOptions.churnRange.trim().length > 0;
}

function enrichWithOwnership(
  cwd: string,
  options: ScanOptions,
  result: ScanResult,
  rawOptions: Record<string, unknown>,
  writeStderr: (text: string) => void,
): void {
  if (!shouldBuildOwnership(rawOptions)) return;

  const explicitPath = typeof rawOptions.codeowners === "string" && rawOptions.codeowners.trim().length > 0
    ? rawOptions.codeowners
    : undefined;
  const codeowners = loadCodeowners(cwd, explicitPath);
  if (!codeowners) {
    writeStderr("DebtLens: --ownership ignored (CODEOWNERS not found).\n");
    return;
  }
  if (result.issues.length === 0) return;

  const paths = buildIssuePathMaps(options, result.issues);
  const fileToRepositoryPath = new Map<string, string>();
  for (const [file, absolutePath] of paths.absoluteByFile.entries()) {
    const repositoryPath = relative(codeowners.root, canonicalizePath(absolutePath)).replaceAll("\\", "/");
    if (repositoryPath && !repositoryPath.startsWith("..")) {
      fileToRepositoryPath.set(file, repositoryPath);
    }
  }

  const ownership = buildOwnershipSummary({
    issues: result.issues,
    codeowners,
    fileToRepositoryPath,
    hotspots: result.summary.hotspots?.ranking,
    duplicateClusters: result.summary.duplicateClusters,
  });
  if (ownership) {
    result.summary.ownership = ownership;
  }
}

function shouldBuildOwnership(rawOptions: Record<string, unknown>): boolean {
  return rawOptions.ownership === true
    || (typeof rawOptions.codeowners === "string" && rawOptions.codeowners.trim().length > 0);
}

function buildIssuePathMaps(options: ScanOptions, issues: DebtIssue[]): { absoluteByFile: Map<string, string> } {
  const base = scanTargetBase(options.target);
  const absoluteByFile = new Map<string, string>();
  for (const issue of issues) {
    if (!absoluteByFile.has(issue.file)) {
      absoluteByFile.set(issue.file, resolve(base, issue.file));
    }
  }
  return { absoluteByFile };
}

function scanTargetBase(target: string): string {
  try {
    if (existsSync(target) && statSync(target).isFile()) return dirname(target);
  } catch {
    return target;
  }
  return target;
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
