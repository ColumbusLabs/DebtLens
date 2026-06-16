import { suggestClosest } from "../utils/didYouMean.js";
import type { DebtIssue, InlineSuppressionAudit, SourceFileInfo } from "./types.js";

const disableNextLinePattern = /debtlens-disable-next-line\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;
const disableFilePattern = /debtlens-disable-file\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;

interface FileSuppressionRules {
  fileRules: Map<string, SuppressionDirective>;
  nextLineRules: Map<number, Map<string, SuppressionDirective>>;
}

interface SuppressionDirective {
  ruleId: string;
  kind: "next-line" | "file";
  reason: string;
  directiveLine: number;
  targetLine?: number;
}

export interface SuppressionResult {
  issues: DebtIssue[];
  suppressions: InlineSuppressionAudit[];
  suppressedByInline: number;
  warnings: string[];
}

export function applyInlineSuppressions(
  issues: DebtIssue[],
  files: SourceFileInfo[],
  validRuleIds: ReadonlySet<string>,
): SuppressionResult {
  const rulesByFile = new Map<string, FileSuppressionRules>();
  const warnings: string[] = [];

  for (const file of files) {
    rulesByFile.set(file.relativePath, parseFileSuppressions(file, validRuleIds, warnings));
  }

  let suppressedByInline = 0;
  const kept: DebtIssue[] = [];
  const suppressions: InlineSuppressionAudit[] = [];

  for (const issue of issues) {
    const rules = rulesByFile.get(issue.file);
    const directive = rules ? getSuppressionDirective(issue, rules) : undefined;
    if (!directive) {
      kept.push(issue);
      continue;
    }
    suppressedByInline += 1;
    suppressions.push({
      ruleId: issue.ruleId,
      file: issue.file,
      kind: directive.kind,
      reason: directive.reason,
      directiveLine: directive.directiveLine,
      ...(directive.targetLine ? { targetLine: directive.targetLine } : {}),
      issue,
    });
  }

  return { issues: kept, suppressions, suppressedByInline, warnings };
}

function parseFileSuppressions(
  file: SourceFileInfo,
  validRuleIds: ReadonlySet<string>,
  warnings: string[],
): FileSuppressionRules {
  const fileRules = new Map<string, SuppressionDirective>();
  const nextLineRules = new Map<number, Map<string, SuppressionDirective>>();
  const lines = file.content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fileMatch = line.match(disableFilePattern);
    if (fileMatch) {
      registerSuppression(file.relativePath, fileMatch[1], fileMatch[2], validRuleIds, warnings, (ruleId, reason) => {
        fileRules.set(ruleId, {
          ruleId,
          kind: "file",
          reason,
          directiveLine: index + 1,
        });
      });
      continue;
    }

    const nextLineMatch = line.match(disableNextLinePattern);
    if (!nextLineMatch) continue;

    registerSuppression(file.relativePath, nextLineMatch[1], nextLineMatch[2], validRuleIds, warnings, (ruleId, reason) => {
      const targetLine = index + 2;
      const rules = nextLineRules.get(targetLine) ?? new Map<string, SuppressionDirective>();
      rules.set(ruleId, {
        ruleId,
        kind: "next-line",
        reason,
        directiveLine: index + 1,
        targetLine,
      });
      nextLineRules.set(targetLine, rules);
    });
  }

  return { fileRules, nextLineRules };
}

function registerSuppression(
  file: string,
  ruleId: string | undefined,
  reason: string | undefined,
  validRuleIds: ReadonlySet<string>,
  warnings: string[],
  apply: (ruleId: string, reason: string) => void,
): void {
  if (!ruleId) return;

  const normalizedRuleId = ruleId.toLowerCase();
  if (!validRuleIds.has(normalizedRuleId)) {
    const suggestion = suggestClosest(normalizedRuleId, [...validRuleIds]);
    const hint = suggestion ? ` (did you mean "${suggestion}"?)` : "";
    addWarning(warnings, `${file}: unknown suppression rule "${normalizedRuleId}"${hint}`);
    return;
  }

  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    addWarning(warnings, `${file}: suppression for "${normalizedRuleId}" ignored because reason is missing after "--"`);
    return;
  }

  apply(normalizedRuleId, trimmedReason);
}

function getSuppressionDirective(issue: DebtIssue, rules: FileSuppressionRules): SuppressionDirective | undefined {
  const ruleId = issue.ruleId.toLowerCase();
  const fileDirective = rules.fileRules.get(ruleId);
  if (fileDirective) return fileDirective;

  const line = issue.location?.startLine;
  if (!line) return undefined;
  return rules.nextLineRules.get(line)?.get(ruleId);
}

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}
