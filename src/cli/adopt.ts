import { isAbsolute, relative, resolve } from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { findWorkspaceRoot, listWorkspacePackages, resolveWorkspacePackage, type WorkspacePackage } from "../config/workspaces.js";
import { DEFAULT_BASELINE_FILENAME, createBaseline, writeBaseline } from "../core/baseline.js";
import { scan } from "../core/scan.js";
import { severities } from "../core/severity.js";
import type { CliOptions, DebtIssue, DebtLensConfig, ScanResult, Severity } from "../core/types.js";
import { isGitRepo } from "../utils/git.js";
import { enrichIssuesWithPayoffScores, topPayoffIssues } from "../core/priority.js";
import { buildThresholdSuggestions, type ThresholdSuggestion } from "./adoptionThresholds.js";
import {
  formatGatePresetDefaults,
  formatGatePresetSummary,
  resolveGatePreset,
  type GatePreset,
} from "../core/gatePresets.js";
import { runInit } from "./init.js";
import { buildZeroFilesScannedWarning } from "./scanWarnings.js";

export interface AdoptInput {
  target: string;
  cwd: string;
  configPath?: string;
  cliOptions: CliOptions;
  writeConfig?: boolean;
  force?: boolean;
  pack?: string;
  gatePreset?: GatePreset;
  packageName?: string;
  writeBaseline?: boolean | string;
  format?: "terminal" | "markdown";
  topFindings?: number;
}

export interface AdoptResult {
  text: string;
  scan: ScanResult;
  recommendedMinSeverity: Severity;
  thresholdSuggestions: ThresholdSuggestion[];
  rolloutPlan: RolloutPlanStep[];
  configWritten?: string;
  baselineWritten?: string;
  baselineSkipped?: boolean;
}

export interface RolloutPlanStep {
  title: string;
  commands: string[];
  rationale: string;
}

export function recommendMinSeverity(bySeverity: Record<Severity, number>, total: number): Severity {
  if (total === 0) return "low";

  const lowNoise = bySeverity.info + bySeverity.low;
  if (total >= 10 && lowNoise / total >= 0.7) return "medium";
  if (total >= 20 && lowNoise / total >= 0.5) return "medium";

  return "low";
}

export function formatAdoptReport(
  scanResult: ScanResult,
  recommendedMinSeverity: Severity,
  thresholdSuggestions: ThresholdSuggestion[] = [],
  rolloutPlan: RolloutPlanStep[] = [],
  gatePreset?: GatePreset,
  topIssues: DebtIssue[] = [],
): string {
  const { summary } = scanResult;
  const topRules = Object.entries(summary.byRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const lines = [
    "DebtLens Adoption Report",
    "========================",
    `Files scanned: ${summary.filesScanned}`,
    `Total issues: ${summary.totalIssues}`,
    "",
    "By severity:",
    ...severities.map((severity) => `  ${severity}: ${summary.bySeverity[severity]}`),
    "",
    "Top rules:",
    ...(topRules.length > 0
      ? topRules.map(([rule, count]) => `  ${rule}: ${count}`)
      : ["  (none)"]),
    "",
    `Recommended minSeverity: ${recommendedMinSeverity}`,
    `Gate preset: ${formatGatePresetSummary(gatePreset)}`,
  ];
  renderTopFindingsTerminal(lines, topIssues, summary.totalIssues);
  if (thresholdSuggestions.length > 0) {
    lines.push("", "Suggested threshold tuning:");
    for (const suggestion of thresholdSuggestions) {
      lines.push(`  ${suggestion.key}: ${suggestion.current} -> ${suggestion.suggested} (p90 observed ${suggestion.observedP90}, ${suggestion.samples} sample${suggestion.samples === 1 ? "" : "s"})`);
    }
  }
  if (rolloutPlan.length > 0) {
    lines.push("", "Rollout plan:");
    for (const [index, step] of rolloutPlan.entries()) {
      lines.push(`  ${index + 1}. ${step.title}`);
      lines.push(step.commands.length === 1 ? "     Command:" : "     Commands:");
      for (const command of step.commands) {
        lines.push(`       ${command}`);
      }
      lines.push(`     Rationale: ${step.rationale}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatAdoptMarkdownReport(
  scanResult: ScanResult,
  recommendedMinSeverity: Severity,
  thresholdSuggestions: ThresholdSuggestion[] = [],
  rolloutPlan: RolloutPlanStep[] = [],
  gatePreset?: GatePreset,
  topIssues: DebtIssue[] = [],
): string {
  const { summary } = scanResult;
  const topRules = Object.entries(summary.byRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const lines = [
    "# DebtLens Adoption Report",
    "",
    `Scanned **${summary.filesScanned}** files and found **${summary.totalIssues}** issues.`,
    "",
    "## Severity Histogram",
    "",
    "| Severity | Issues |",
    "| --- | ---: |",
    ...severities.map((severity) => `| ${severity} | ${summary.bySeverity[severity]} |`),
    "",
    "## Top Rules",
    "",
    "| Rule | Issues |",
    "| --- | ---: |",
    ...(topRules.length > 0
      ? topRules.map(([rule, count]) => `| \`${rule}\` | ${count} |`)
      : ["| None | 0 |"]),
    "",
    `Recommended minSeverity: **${recommendedMinSeverity}**`,
    `Gate preset: **${gatePreset ?? "(none)"}**${gatePreset ? ` - ${formatGatePresetDefaults(gatePreset) || "advisory only"}` : ""}`,
  ];
  renderTopFindingsMarkdown(lines, topIssues, summary.totalIssues);
  if (thresholdSuggestions.length > 0) {
    lines.push(
      "",
      "## Suggested Threshold Tuning",
      "",
      "| Threshold | Current | Suggested | P90 observed | Samples |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...thresholdSuggestions.map((suggestion) => `| \`${suggestion.key}\` | ${suggestion.current} | ${suggestion.suggested} | ${suggestion.observedP90} | ${suggestion.samples} |`),
    );
  }
  if (rolloutPlan.length > 0) {
    lines.push("", "## Rollout Plan", "");
    for (const [index, step] of rolloutPlan.entries()) {
      lines.push(`${index + 1}. **${step.title}**`);
      for (const command of step.commands) {
        lines.push(`   - Command: \`${command}\``);
      }
      lines.push(`   - Rationale: ${step.rationale}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function runAdopt(input: AdoptInput): Promise<AdoptResult> {
  const fileConfig = loadConfig(input.cwd, input.configPath);
  const target = input.packageName
    ? resolveWorkspacePackage(input.cwd, input.packageName).directory
    : input.target;
  const options = mergeConfig(target, fileConfig, input.cliOptions);
  const result = await scan(options);
  const topIssues = input.topFindings
    ? buildTopAdoptionIssues(result, input.topFindings, fileConfig)
    : [];

  const recommended = recommendMinSeverity(result.summary.bySeverity, result.summary.totalIssues);
  const thresholdSuggestions = buildThresholdSuggestions(result, options);
  const selectedGatePreset = input.gatePreset ?? resolveGatePreset(undefined, fileConfig);
  const rolloutPlan = buildRolloutPlan(input, result, recommended, fileConfig);
  const lines: string[] = [];

  if (result.summary.filesScanned === 0) {
    lines.push(buildZeroFilesScannedWarning(options.target, options.include, false).trimEnd());
    lines.push("");
  }

  if (result.summary.warnings?.length) {
    for (const warning of result.summary.warnings) {
      lines.push(`DebtLens warning: ${warning}`);
    }
    lines.push("");
  }

  lines.push((input.format === "markdown"
    ? formatAdoptMarkdownReport(result, recommended, thresholdSuggestions, rolloutPlan, selectedGatePreset, topIssues)
    : formatAdoptReport(result, recommended, thresholdSuggestions, rolloutPlan, selectedGatePreset, topIssues)).trimEnd());

  let configWritten: string | undefined;
  let baselineWritten: string | undefined;
  let baselineSkipped = false;

  if (input.writeConfig) {
    const initResult = runInit(input.cwd, input.force === true, input.pack, thresholdSuggestionOverrides(thresholdSuggestions));
    configWritten = initResult.path;
    lines.push("");
    lines.push(`${initResult.overwritten ? "Overwrote" : "Created"} ${initResult.path}`);
  }

  if (input.writeBaseline !== undefined && input.writeBaseline !== false) {
    if (result.issues.length === 0) {
      baselineSkipped = true;
      lines.push("");
      lines.push("Skipped baseline write (0 issues found).");
    } else {
      const baselinePath = input.writeBaseline === true
        ? DEFAULT_BASELINE_FILENAME
        : String(input.writeBaseline);
      baselineWritten = writeBaseline(input.cwd, baselinePath, createBaseline(result.issues));
      lines.push("");
      lines.push(`Wrote baseline with ${result.issues.length} issues to ${baselineWritten}`);
    }
  }

  const dryRun = !input.writeConfig && input.writeBaseline === undefined;
  if (dryRun) {
    lines.push("");
    lines.push("Dry run — no files written. Use --write-config --force and/or --write-baseline to apply.");
  }

  return {
    text: `${lines.join("\n")}\n`,
    scan: result,
    recommendedMinSeverity: recommended,
    thresholdSuggestions,
    rolloutPlan,
    configWritten,
    baselineWritten,
    baselineSkipped,
  };
}

export function buildRolloutPlan(
  input: AdoptInput,
  scanResult: ScanResult,
  recommendedMinSeverity: Severity,
  fileConfig: DebtLensConfig = {},
): RolloutPlanStep[] {
  const baseScanArgs = buildScopedCommandArgs("scan", input, fileConfig);
  const baseAdoptArgs = buildScopedCommandArgs("adopt", input, fileConfig);
  const hasLegacyDebt = scanResult.summary.totalIssues > 0;
  const packageScope = input.packageName ? `package "${input.packageName}"` : "the current scan target";
  const selectedPack = input.cliOptions.pack ?? input.pack ?? fileConfig.pack;
  const hasExplicitRules = (input.cliOptions.rules?.length ?? fileConfig.rules?.length ?? 0) > 0;
  const planMinSeverity = input.cliOptions.minSeverity ?? fileConfig.minSeverity ?? recommendedMinSeverity;
  const gitAvailable = isGitRepo(input.cwd);
  const workspacePackages = input.packageName ? [] : listAdoptionWorkspacePackages(input.cwd);
  const firstScopeRationale = [
    input.packageName
      ? `Keep the first rollout scoped to ${packageScope} so one workspace can tune signal before expanding.`
      : "Keep the first rollout scoped to the target that was just scanned so the team can review a concrete result.",
    selectedPack
      ? `Recommended first pack: ${selectedPack}.`
      : hasExplicitRules
        ? "Recommended first pack: core once the rule-scoped dry run looks credible."
        : "Recommended first pack: core if the full dry run is too broad for the first policy gate.",
  ].join(" ");
  const plan: RolloutPlanStep[] = [
    {
      title: input.packageName ? "Start with a package-scoped advisory dry run" : "Start with an advisory dry run",
      commands: [formatCommand(withGatePreset(baseAdoptArgs, "advisory"))],
      rationale: `${firstScopeRationale} The advisory gate preset keeps the first run non-blocking while the team reviews signal quality.`,
    },
  ];

  if (workspacePackages.length > 0) {
    const samplePackage = selectWorkspacePilotPackage(input, workspacePackages);
    plan.push({
      title: "Pilot one workspace package before expanding",
      commands: [formatCommand(withGatePreset(buildScopedCommandArgs("adopt", {
        ...input,
        packageName: samplePackage.name,
      }, fileConfig), "advisory"))],
      rationale: `Detected workspace packages (${formatPackageList(workspacePackages)}). Use --package to tune one package's noise profile before applying the same gate across the whole workspace.`,
    });
  }

  if (hasLegacyDebt) {
    plan.push({
      title: "Baseline current debt before enforcing CI",
      commands: [formatCommand([...baseScanArgs, "--write-baseline", DEFAULT_BASELINE_FILENAME])],
      rationale: `${scanResult.summary.totalIssues} existing ${plural(scanResult.summary.totalIssues, "issue")} should stay visible without blocking every pull request. Commit the reviewed baseline, then gate only findings outside it.`,
    });
  } else {
    plan.push({
      title: "Skip the baseline unless legacy debt appears",
      commands: [formatCommand([...withMinSeverity(baseScanArgs, planMinSeverity), "--fail-on", "high"])],
      rationale: "No issues were found in this scan, so a direct high-severity gate is simpler than committing an empty baseline.",
    });
  }

  plan.push({
    title: hasLegacyDebt ? "Gate new code in CI" : "Keep CI focused on changed code",
    commands: hasLegacyDebt
      ? [
          formatCommand(withGatePreset(withMinSeverity(baseScanArgs, planMinSeverity), "legacy-baseline")),
          formatCommand(withGatePreset(withMinSeverity(baseScanArgs, planMinSeverity), "new-code")),
        ]
      : [formatCommand(withGatePreset(withMinSeverity(baseScanArgs, planMinSeverity), "new-code"))],
    rationale: hasLegacyDebt
      ? "Use legacy-baseline for mature branches and new-code in pull-request CI when a target branch ref is available; both presets focus review on new or changed debt."
      : "Use the new-code preset in pull-request CI when a target branch ref is available so clean repositories stay clean without rescanning every historical finding.",
  });

  plan.push({
    title: "Tighten to a strict new-code gate after signal stabilizes",
    commands: [formatCommand(withGatePreset(withMinSeverity(baseScanArgs, planMinSeverity), "strict-new-code"))],
    rationale: "Move from advisory to new-code first, then strict-new-code once baselines, false-positive tuning, and ownership expectations are accepted by the team.",
  });

  plan.push({
    title: "Use changed and staged scans while tuning locally",
    commands: [
      formatCommand([...withMinSeverity(baseScanArgs, planMinSeverity), "--changed", "origin/main"]),
      formatCommand([...withMinSeverity(baseScanArgs, planMinSeverity), "--staged", "--fail-on", "high", "--fail-on-confidence", "0.8"]),
    ],
    rationale: gitAvailable
      ? "--changed narrows branch review to files changed from the mainline ref; --staged gives developers a pre-commit check before CI."
      : "Run these inside a git checkout or CI job; outside git, DebtLens will ignore changed/staged mode and fall back to the configured target.",
  });

  return plan;
}

function thresholdSuggestionOverrides(suggestions: ThresholdSuggestion[]): Record<string, number> {
  return Object.fromEntries(suggestions.map((suggestion) => [suggestion.key, suggestion.suggested]));
}

function buildScopedCommandArgs(command: "adopt" | "scan", input: AdoptInput, fileConfig: DebtLensConfig): string[] {
  const args = ["debtlens", command, input.target];
  const selectedPack = input.cliOptions.pack ?? input.pack ?? fileConfig.pack;
  addStringArg(args, "--cwd", input.cwd === process.cwd() ? undefined : input.cwd);
  addStringArg(args, "--config", input.configPath);
  addStringArg(args, "--package", input.packageName);
  addStringArg(args, "--pack", selectedPack);
  addStringArg(args, "--min-severity", input.cliOptions.minSeverity ?? fileConfig.minSeverity);
  addListArg(args, "--rules", input.cliOptions.rules);
  addListArg(args, "--include", input.cliOptions.include);
  addListArg(args, "--exclude", input.cliOptions.exclude);
  addThresholdArg(args, input.cliOptions.thresholds);
  if (command === "adopt" && input.topFindings) {
    args.push("--top", String(input.topFindings));
  }
  if (command === "adopt" && input.format === "markdown") {
    args.push("--format", "markdown");
  }
  return args;
}

function addStringArg(args: string[], flag: string, value: string | undefined): void {
  if (value && value.length > 0) args.push(flag, value);
}

function addListArg(args: string[], flag: string, value: string[] | undefined): void {
  if (value?.length) args.push(flag, value.join(","));
}

function addThresholdArg(args: string[], thresholds: CliOptions["thresholds"]): void {
  const entries = Object.entries(thresholds ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length) {
    args.push("--threshold", entries.map(([key, value]) => `${key}=${value}`).join(","));
  }
}

function formatCommand(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function withMinSeverity(args: string[], minSeverity: Severity): string[] {
  return args.includes("--min-severity")
    ? args
    : [...args, "--min-severity", minSeverity];
}

function withGatePreset(args: string[], gatePreset: GatePreset): string[] {
  return args.includes("--gate")
    ? args
    : [...args, "--gate", gatePreset];
}

function listAdoptionWorkspacePackages(cwd: string): WorkspacePackage[] {
  const workspaceRoot = findWorkspaceRoot(cwd);
  return workspaceRoot ? listWorkspacePackages(workspaceRoot) : [];
}

function selectWorkspacePilotPackage(input: AdoptInput, packages: WorkspacePackage[]): WorkspacePackage {
  const targetPath = resolve(input.cwd, input.target);
  return packages.find((workspacePackage) => pathContains(workspacePackage.directory, targetPath)) ?? packages[0]!;
}

function pathContains(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function formatPackageList(packages: WorkspacePackage[]): string {
  const visible = packages.slice(0, 3).map((workspacePackage) => workspacePackage.name);
  const suffix = packages.length > visible.length ? `, +${packages.length - visible.length} more` : "";
  return `${visible.join(", ")}${suffix}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function plural(count: number, word: string): string {
  return `${word}${count === 1 ? "" : "s"}`;
}

function buildTopAdoptionIssues(result: ScanResult, limit: number, fileConfig: DebtLensConfig): DebtIssue[] {
  enrichIssuesWithPayoffScores(result.issues, { weights: fileConfig.priority });
  return topPayoffIssues(result.issues, limit);
}

function renderTopFindingsTerminal(lines: string[], issues: DebtIssue[], totalIssues: number): void {
  if (issues.length === 0) return;
  lines.push("", `Highest-signal findings (${issues.length} of ${totalIssues}):`);
  for (const issue of issues) {
    const location = issue.location ? `${issue.file}:${issue.location.startLine}` : issue.file;
    lines.push(`  ${issue.payoffScore?.toFixed(2)}  [${issue.severity}] ${issue.ruleName} — ${location}`);
    lines.push(`    ${issue.message}`);
  }
}

function renderTopFindingsMarkdown(lines: string[], issues: DebtIssue[], totalIssues: number): void {
  if (issues.length === 0) return;
  lines.push("", `## Highest-signal findings (${issues.length} of ${totalIssues})`, "");
  for (const issue of issues) {
    const location = issue.location ? `${issue.file}:${issue.location.startLine}` : issue.file;
    lines.push(`- **${issue.payoffScore?.toFixed(2)}** [${issue.severity}] \`${issue.ruleId}\` — \`${location}\` — ${issue.message}`);
  }
}
