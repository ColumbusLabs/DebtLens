import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { loadEffectiveConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { existsSync } from "node:fs";
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
  /** Injectable prompt for tests; defaults to readline when omitted. */
  ask?: (message: string) => Promise<string>;
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
  const baseline = existsSync(baselinePath) ? loadBaseline(cwd, baselinePath) : createBaseline([]);
  const fingerprints = new Set(Object.keys(baseline.fingerprints));
  const suppressions: string[] = [];
  const counts: TriageActionResult = { kept: 0, baselined: 0, suppressed: 0, skipped: 0 };

  const output = input.output ?? process.stdout;
  const rl = input.ask
    ? undefined
    : createInterface({
      input: input.input ?? process.stdin,
      output,
    });
  const ask = input.ask ?? ((message: string) => rl!.question(message));

  try {
    for (let index = 0; index < issues.length; index += 1) {
      const issue = issues[index];
      if (!issue) continue;
      const rendered = formatIssue(issue, index + 1, issues.length);
      output.write(`\n${rendered}\n`);
      const rawAnswer = (await ask("Action [k]eep [b]aseline [s]uppress [n]ext [q]uit [B]atch rule: ")).trim();
      const answer = rawAnswer.toLowerCase();

      if (answer === "q" || answer === "quit") break;
      if (answer === "n" || answer === "next" || answer === "") {
        counts.skipped += 1;
        continue;
      }
      if (rawAnswer === "B" || answer === "batch" || answer === "b-rule") {
        const batchAction = (await ask("Apply to all remaining findings of this rule with [k]eep [b]aseline [s]uppress? ")).trim().toLowerCase();
        const suppressReason = isSuppressAction(batchAction)
          ? await promptSuppressReason(ask, output)
          : undefined;
        for (let cursor = index; cursor < issues.length; cursor += 1) {
          const candidate = issues[cursor];
          if (!candidate || candidate.ruleId !== issue.ruleId) continue;
          applyTriageAction(candidate, batchAction, {
            dryRun: input.dryRun,
            baseline,
            fingerprints,
            suppressions,
            counts,
            suppressReason,
          });
        }
        break;
      }

      const suppressReason = isSuppressAction(answer)
        ? await promptSuppressReason(ask, output)
        : undefined;
      applyTriageAction(issue, answer, {
        dryRun: input.dryRun,
        baseline,
        fingerprints,
        suppressions,
        counts,
        suppressReason,
      });
    }
  } finally {
    rl?.close();
  }

  if (!input.dryRun) {
    writeBaseline(cwd, baselinePath, baseline);
    if (suppressions.length > 0) {
      output.write("\nSuggested suppression directives:\n");
      for (const directive of suppressions) output.write(directive);
    }
  } else if (suppressions.length > 0) {
    output.write("\nSuggested suppression directives (dry run):\n");
    for (const directive of suppressions) output.write(directive);
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
    suppressReason?: string;
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
    const reason = context.suppressReason?.trim();
    if (!reason) {
      throw new Error("Suppression reason is required.");
    }
    context.suppressions.push(runSuppress({ ruleId: issue.ruleId, reason }));
    context.counts.suppressed += 1;
    return;
  }
  context.counts.kept += 1;
}

function isSuppressAction(action: string): boolean {
  return action === "s" || action === "suppress";
}

async function promptSuppressReason(
  ask: (message: string) => Promise<string>,
  output: NodeJS.WritableStream,
): Promise<string> {
  while (true) {
    const reason = (await ask("Suppression reason (required): ")).trim();
    if (reason) return reason;
    output.write("A reason is required for suppressions.\n");
  }
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
