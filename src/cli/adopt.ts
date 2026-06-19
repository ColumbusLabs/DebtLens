import { loadConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { resolveWorkspacePackage } from "../config/workspaces.js";
import { DEFAULT_BASELINE_FILENAME, createBaseline, writeBaseline } from "../core/baseline.js";
import { scan } from "../core/scan.js";
import { severities } from "../core/severity.js";
import type { CliOptions, ScanResult, Severity } from "../core/types.js";
import { isGitRepo } from "../utils/git.js";
import { buildThresholdSuggestions, type ThresholdSuggestion } from "./adoptionThresholds.js";
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
  packageName?: string;
  writeBaseline?: boolean | string;
  format?: "terminal" | "markdown";
}

export interface AdoptResult {
  text: string;
  scan: ScanResult;
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
  ];
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
  ];
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

  const recommended = recommendMinSeverity(result.summary.bySeverity, result.summary.totalIssues);
  const thresholdSuggestions = buildThresholdSuggestions(result, options);
  const rolloutPlan = buildRolloutPlan(input, result, recommended);
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
    ? formatAdoptMarkdownReport(result, recommended, thresholdSuggestions, rolloutPlan)
    : formatAdoptReport(result, recommended, thresholdSuggestions, rolloutPlan)).trimEnd());

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
): RolloutPlanStep[] {
  const baseScanArgs = buildScopedCommandArgs("scan", input);
  const baseAdoptArgs = buildScopedCommandArgs("adopt", input);
  const hasLegacyDebt = scanResult.summary.totalIssues > 0;
  const packageScope = input.packageName ? `package "${input.packageName}"` : "the current scan target";
  const selectedPack = input.cliOptions.pack ?? input.pack;
  const hasExplicitRules = (input.cliOptions.rules?.length ?? 0) > 0;
  const recommendedPack = selectedPack ?? "core";
  const gitAvailable = isGitRepo(input.cwd);
  const firstScopeRationale = [
    input.packageName
      ? `Keep the first rollout scoped to ${packageScope} so one workspace can tune signal before expanding.`
      : "Keep the first rollout scoped to the target that was just scanned so the team can review a concrete result.",
    selectedPack
      ? `Recommended first pack: ${selectedPack}.`
      : hasExplicitRules
        ? "Recommended first pack: core once the rule-scoped dry run looks credible."
        : `Recommended first pack: ${recommendedPack}.`,
  ].join(" ");
  const plan: RolloutPlanStep[] = [
    {
      title: input.packageName ? "Start with a package-scoped dry run" : "Start with a focused dry run",
      commands: [formatCommand(baseAdoptArgs)],
      rationale: firstScopeRationale,
    },
  ];

  if (hasLegacyDebt) {
    plan.push({
      title: "Baseline current debt before enforcing CI",
      commands: [formatCommand([...baseScanArgs, "--write-baseline", DEFAULT_BASELINE_FILENAME])],
      rationale: `${scanResult.summary.totalIssues} existing ${plural(scanResult.summary.totalIssues, "issue")} should stay visible without blocking every pull request. Commit the reviewed baseline, then gate only findings outside it.`,
    });
  } else {
    plan.push({
      title: "Skip the baseline unless legacy debt appears",
      commands: [formatCommand([...baseScanArgs, "--min-severity", recommendedMinSeverity, "--fail-on", "high"])],
      rationale: "No issues were found in this scan, so a direct high-severity gate is simpler than committing an empty baseline.",
    });
  }

  plan.push({
    title: hasLegacyDebt ? "Gate new code in CI" : "Keep CI focused on changed code",
    commands: hasLegacyDebt
      ? [
          formatCommand([...baseScanArgs, "--baseline", DEFAULT_BASELINE_FILENAME, "--min-severity", recommendedMinSeverity, "--fail-on", "high"]),
          formatCommand([...baseScanArgs, "--diff-base", "origin/main", "--min-severity", recommendedMinSeverity, "--fail-on", "high"]),
        ]
      : [formatCommand([...baseScanArgs, "--diff-base", "origin/main", "--min-severity", recommendedMinSeverity, "--fail-on", "high"])],
    rationale: hasLegacyDebt
      ? "Use the baseline for mature branches and --diff-base in pull-request CI when a target branch ref is available; both patterns focus review on new or changed debt."
      : "Use --diff-base in pull-request CI when a target branch ref is available so clean repositories stay clean without rescanning every historical finding.",
  });

  plan.push({
    title: "Use changed and staged scans while tuning locally",
    commands: [
      formatCommand([...baseScanArgs, "--changed", "origin/main", "--min-severity", recommendedMinSeverity]),
      formatCommand([...baseScanArgs, "--staged", "--min-severity", recommendedMinSeverity, "--fail-on", "high", "--fail-on-confidence", "0.8"]),
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

function buildScopedCommandArgs(command: "adopt" | "scan", input: AdoptInput): string[] {
  const args = ["debtlens", command, input.target];
  const selectedPack = input.cliOptions.pack ?? input.pack;
  const hasExplicitRules = (input.cliOptions.rules?.length ?? 0) > 0;
  addStringArg(args, "--cwd", input.cwd === process.cwd() ? undefined : input.cwd);
  addStringArg(args, "--config", input.configPath);
  addStringArg(args, "--package", input.packageName);
  addStringArg(args, "--pack", selectedPack ?? (hasExplicitRules ? undefined : "core"));
  addListArg(args, "--rules", input.cliOptions.rules);
  addListArg(args, "--include", input.cliOptions.include);
  addListArg(args, "--exclude", input.cliOptions.exclude);
  addThresholdArg(args, input.cliOptions.thresholds);
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

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function plural(count: number, word: string): string {
  return `${word}${count === 1 ? "" : "s"}`;
}
