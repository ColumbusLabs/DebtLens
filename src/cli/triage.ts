import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { loadEffectiveConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  const processedIndexes = new Set<number>();
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
      if (processedIndexes.has(index)) continue;
      const issue = issues[index];
      if (!issue) continue;
      const rendered = formatIssue(issue, index + 1, issues.length);
      output.write(`\n${rendered}\n`);
      const rawAnswer = (await ask("Action [k]eep [b]aseline [s]uppress [o]pen [n]ext [q]uit [B]atch rule: ")).trim();
      const answer = rawAnswer.toLowerCase();

      if (answer === "q" || answer === "quit") break;
      if (answer === "n" || answer === "next" || answer === "") {
        counts.skipped += 1;
        continue;
      }
      if (answer === "o" || answer === "open") {
        output.write(`\n${formatIssueCreationSnippet(issue)}\n`);
        counts.kept += 1;
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
            applySuppression: (directive) => applyInlineSuppression(cwd, options.target, candidate, directive, issues),
          });
          processedIndexes.add(cursor);
        }
        continue;
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
        applySuppression: (directive) => applyInlineSuppression(cwd, options.target, issue, directive, issues),
      });
    }
  } finally {
    rl?.close();
  }

  if (!input.dryRun) {
    writeBaseline(cwd, baselinePath, baseline);
    if (suppressions.length > 0) {
      output.write("\nApplied suppression directives:\n");
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
    applySuppression: (directive: string) => void;
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
    const directive = runSuppress({ ruleId: issue.ruleId, reason });
    context.suppressions.push(directive);
    if (!context.dryRun) context.applySuppression(directive);
    context.counts.suppressed += 1;
    return;
  }
  context.counts.kept += 1;
}

function applyInlineSuppression(
  cwd: string,
  target: string,
  issue: DebtIssue,
  directive: string,
  issues: DebtIssue[],
): void {
  const line = issue.location?.startLine;
  if (!line) throw new Error(`Cannot suppress ${issue.ruleId} in ${issue.file}: finding has no line location.`);

  const filePath = resolveIssueFile(cwd, target, issue.file);
  const content = readFileSync(filePath, "utf8");
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const insertionIndex = line - 1;
  const targetLine = lines[insertionIndex];
  if (targetLine === undefined) {
    throw new Error(`Cannot suppress ${issue.ruleId} in ${issue.file}:${line}: line is outside the file.`);
  }

  const indent = targetLine.match(/^\s*/)?.[0] ?? "";
  const comment = suppressionCommentForFile(filePath, directive.trim());
  lines.splice(insertionIndex, 0, `${indent}${comment}`);
  writeFileSync(filePath, lines.join(newline), "utf8");

  for (const candidate of issues) {
    if (candidate.file !== issue.file || !candidate.location || candidate.location.startLine < line) continue;
    candidate.location.startLine += 1;
    if (candidate.location.endLine !== undefined) candidate.location.endLine += 1;
  }
}

function resolveIssueFile(cwd: string, target: string, issueFile: string): string {
  const resolvedTarget = resolve(cwd, target);
  if (existsSync(resolvedTarget) && statSync(resolvedTarget).isFile()) return resolvedTarget;
  return resolve(resolvedTarget, issueFile);
}

function suppressionCommentForFile(filePath: string, directive: string): string {
  return /\.(?:py|rb)$/i.test(filePath) ? directive.replace(/^\/\//, "#") : directive;
}

function formatIssueCreationSnippet(issue: DebtIssue): string {
  const location = issue.location ? `${issue.file}:${issue.location.startLine}` : issue.file;
  return [
    "Issue creation snippet:",
    `Title: Address ${issue.ruleName} in ${issue.file}`,
    `Body: DebtLens reported \`${issue.ruleId}\` at \`${location}\`. ${issue.message}`,
    ...(issue.suggestion ? [`Suggested remediation: ${issue.suggestion}`] : []),
  ].join("\n");
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
