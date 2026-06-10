import { suggestClosest } from "../utils/didYouMean.js";
import type { DebtIssue, SourceFileInfo } from "./types.js";

const disableNextLinePattern = /debtlens-disable-next-line\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;
const disableFilePattern = /debtlens-disable-file\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;

interface FileSuppressionRules {
  fileRules: Set<string>;
  nextLineRules: Map<number, Set<string>>;
}

export interface SuppressionResult {
  issues: DebtIssue[];
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

  for (const issue of issues) {
    const rules = rulesByFile.get(issue.file);
    if (!rules || !shouldSuppressIssue(issue, rules)) {
      kept.push(issue);
      continue;
    }
    suppressedByInline += 1;
  }

  return { issues: kept, suppressedByInline, warnings };
}

function parseFileSuppressions(
  file: SourceFileInfo,
  validRuleIds: ReadonlySet<string>,
  warnings: string[],
): FileSuppressionRules {
  const fileRules = new Set<string>();
  const nextLineRules = new Map<number, Set<string>>();
  const lines = file.content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fileMatch = line.match(disableFilePattern);
    if (fileMatch) {
      registerSuppression(file.relativePath, fileMatch[1], fileMatch[2], validRuleIds, warnings, () => {
        fileRules.add(fileMatch[1]!.toLowerCase());
      });
      continue;
    }

    const nextLineMatch = line.match(disableNextLinePattern);
    if (!nextLineMatch) continue;

    registerSuppression(file.relativePath, nextLineMatch[1], nextLineMatch[2], validRuleIds, warnings, () => {
      const targetLine = index + 2;
      const rules = nextLineRules.get(targetLine) ?? new Set<string>();
      rules.add(nextLineMatch[1]!.toLowerCase());
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
  apply: () => void,
): void {
  if (!ruleId) return;

  const normalizedRuleId = ruleId.toLowerCase();
  if (!validRuleIds.has(normalizedRuleId)) {
    const suggestion = suggestClosest(normalizedRuleId, [...validRuleIds]);
    const hint = suggestion ? ` (did you mean "${suggestion}"?)` : "";
    addWarning(warnings, `${file}: unknown suppression rule "${normalizedRuleId}"${hint}`);
    return;
  }

  if (!reason?.trim()) {
    addWarning(warnings, `${file}: suppression for "${normalizedRuleId}" ignored because reason is missing after "--"`);
    return;
  }

  apply();
}

function shouldSuppressIssue(issue: DebtIssue, rules: FileSuppressionRules): boolean {
  const ruleId = issue.ruleId.toLowerCase();
  if (rules.fileRules.has(ruleId)) return true;

  const line = issue.location?.startLine;
  if (!line) return false;
  return rules.nextLineRules.get(line)?.has(ruleId) ?? false;
}

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}
