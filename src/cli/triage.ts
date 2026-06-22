import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { loadEffectiveConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { DEFAULT_BASELINE_FILENAME, createBaseline, loadBaseline, writeBaseline } from "../core/baseline.js";
import { scan } from "../core/scan.js";
import type { DebtIssue, ScanOptions } from "../core/types.js";
import { loadConfiguredPlugins } from "./scanPipeline.js";
import { runSuppress } from "./suppress.js";
import { parseCommaList, parseRuleList, parseThresholds } from "./parse.js";
import { parseSeverity } from "../core/severity.js";

export interface TriageInput {
  target: string;
  cwd: string;
  configPath?: string;
  baselinePath?: string;
  dryRun?: boolean;
  cliOptions?: Record<string, unknown>;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export interface TriageActionResult {
  kept: number;
  baselined: number;
  suppressed: number;
  skipped: number;
}

export async function runTriage(input: TriageInput): Promise<TriageActionResult> {
  if (input.input && "isTTY" in input.input && input.input.isTTY === false) {
    throw new Error("debtlens triage requires an interactive terminal.");
  }
  const cwd = resolve(input.cwd);
  const effectiveConfig = loadEffectiveConfig(cwd, input.configPath);
  const pluginContribution = await loadConfiguredPlugins(cwd, input.cliOptions ?? {}, effectiveConfig.config, effectiveConfig.pluginConfigDir);
  const options = mergeConfig(input.target, effectiveConfig.config, {
    cwd,
    include: parseCommaList(input.cliOptions?.include as string | undefined),
    exclude: parseCommaList(input.cliOptions?.exclude as string | undefined),
    rules: parseRuleList(input.cliOptions?.rules as string | undefined),
    pack: input.cliOptions?.pack ? String(input.cliOptions.pack) : undefined,
    thresholds: parseThresholds(input.cliOptions?.threshold as string | undefined),
    minSeverity: parseSeverity(String(input.cliOptions?.minSeverity ?? "low"), "low"),
    pluginDetectors: pluginContribution?.detectors,
    pluginThresholds: pluginContribution?.thresholds,
    pluginVocabulary: pluginContribution?.vocabulary,
  });
  const result = await scan(options);
  const issues = [...result.issues];
  const baselinePath = resolve(cwd, input.baselinePath ?? DEFAULT_BASELINE_FILENAME);
  const baseline = loadBaseline(cwd, baselinePath);
  const fingerprints = new Set(Object.keys(baseline.fingerprints));
  const suppressions: string[] = [];
  const counts: TriageActionResult = { kept: 0, baselined: 0, suppressed: 0, skipped: 0 };

  const rl = createInterface({
    input: input.input ?? process.stdin,
    output: input.output ?? process.stdout,
  });

  try {
    for (let index = 0; index < issues.length; index += 1) {
      const issue = issues[index];
      if (!issue) continue;
      const rendered = formatIssue(issue, index + 1, issues.length);
      process.stdout.write(`\n${rendered}\n`);
      const answer = (await rl.question("Action [k]eep [b]aseline [s]uppress [n]ext [q]uit [B]atch rule: ")).trim().toLowerCase();

      if (answer === "q" || answer === "quit") break;
      if (answer === "n" || answer === "next" || answer === "") {
        counts.skipped += 1;
        continue;
      }
      if (answer === "batch" || answer === "b-rule") {
        const batchAction = (await rl.question("Apply to all remaining findings of this rule with [k]eep [b]aseline [s]uppress? ")).trim().toLowerCase();
        for (let cursor = index; cursor < issues.length; cursor += 1) {
          const candidate = issues[cursor];
          if (!candidate || candidate.ruleId !== issue.ruleId) continue;
          applyTriageAction(candidate, batchAction, {
            dryRun: input.dryRun,
            baseline,
            fingerprints,
            suppressions,
            counts,
          });
        }
        break;
      }

      applyTriageAction(issue, answer, {
        dryRun: input.dryRun,
        baseline,
        fingerprints,
        suppressions,
        counts,
      });
    }
  } finally {
    rl.close();
  }

  if (!input.dryRun) {
    writeBaseline(cwd, baselinePath, baseline);
    if (suppressions.length > 0) {
      process.stdout.write("\nSuggested suppression directives:\n");
      for (const directive of suppressions) process.stdout.write(directive);
    }
  }

  return counts;
}

function applyTriageAction(
  issue: DebtIssue,
  action: string,
  context: {
    dryRun?: boolean;
    baseline: ReturnType<typeof loadBaseline>;
    fingerprints: Set<string>;
    suppressions: string[];
    counts: TriageActionResult;
  },
): void {
  const fingerprint = issue.fingerprint ?? issue.id;
  if (action === "b" || action === "baseline") {
    context.baseline.fingerprints[fingerprint] = (context.baseline.fingerprints[fingerprint] ?? 0) + 1;
    context.fingerprints.add(fingerprint);
    context.counts.baselined += 1;
    return;
  }
  if (action === "s" || action === "suppress") {
    const reason = "triaged via debtlens triage";
    context.suppressions.push(runSuppress({ ruleId: issue.ruleId, reason }));
    context.counts.suppressed += 1;
    return;
  }
  context.counts.kept += 1;
}

function formatIssue(issue: DebtIssue, index: number, total: number): string {
  const location = issue.location ? `${issue.file}:${issue.location.startLine}` : issue.file;
  return [
    `[${index}/${total}] ${issue.severity.toUpperCase()} ${issue.ruleName} (${issue.ruleId})`,
    location,
    issue.message,
    ...(issue.suggestion ? [`Suggestion: ${issue.suggestion}`] : []),
  ].join("\n");
}
