import { suggestClosest } from "../utils/didYouMean.js";
import type { DebtIssue, InlineSuppressionAudit, SourceFileInfo, SuppressionDirectiveAudit } from "./types.js";

const disableNextLinePattern = /debtlens-disable-next-line\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;
const disableFilePattern = /debtlens-disable-file\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;

interface FileSuppressionRules {
  fileRules: Map<string, SuppressionDirective>;
  nextLineRules: Map<number, Map<string, SuppressionDirective>>;
  directives: SuppressionDirective[];
}

interface SuppressionDirective {
  id: string;
  file: string;
  ruleId: string;
  kind: "next-line" | "file";
  reason: string;
  directiveLine: number;
  targetLine?: number;
}

export interface SuppressionResult {
  issues: DebtIssue[];
  suppressions: InlineSuppressionAudit[];
  suppressionDirectives: SuppressionDirectiveAudit[];
  suppressedByInline: number;
  warnings: string[];
}

export function applyInlineSuppressions(
  issues: DebtIssue[],
  files: SourceFileInfo[],
  validRuleIds: ReadonlySet<string>,
  evaluatedRuleIds: ReadonlySet<string> = validRuleIds,
): SuppressionResult {
  const rulesByFile = new Map<string, FileSuppressionRules>();
  const warnings: string[] = [];

  for (const file of files) {
    rulesByFile.set(file.relativePath, parseFileSuppressions(file, validRuleIds, warnings));
  }

  let suppressedByInline = 0;
  const kept: DebtIssue[] = [];
  const suppressions: InlineSuppressionAudit[] = [];
  const directiveAudits = new Map<string, SuppressionDirectiveAudit>();

  for (const rules of rulesByFile.values()) {
    for (const directive of rules.directives) {
      directiveAudits.set(
        directive.id,
        evaluatedRuleIds.has(directive.ruleId)
          ? buildDirectiveAudit(directive, {
            status: "unused",
            recommendedAction: "Remove this suppression if the finding no longer exists.",
          })
          : buildDirectiveAudit(directive, {
            status: "not-evaluated",
            recommendedAction: "Run this rule in the audit scan before deciding whether this suppression is stale.",
          }),
      );
    }
  }

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
    const audit = directiveAudits.get(directive.id);
    if (audit) {
      audit.status = "used";
      audit.suppressedIssueCount += 1;
      audit.recommendedAction = getUsedRecommendation(audit.kind, audit.suppressedIssueCount);
    }
  }

  return {
    issues: kept,
    suppressions,
    suppressionDirectives: [...directiveAudits.values()].sort(compareDirectiveAudits),
    suppressedByInline,
    warnings,
  };
}

function parseFileSuppressions(
  file: SourceFileInfo,
  validRuleIds: ReadonlySet<string>,
  warnings: string[],
): FileSuppressionRules {
  const fileRules = new Map<string, SuppressionDirective>();
  const nextLineRules = new Map<number, Map<string, SuppressionDirective>>();
  const directives: SuppressionDirective[] = [];
  const lines = file.content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const commentText = extractSuppressionComment(line);
    if (!commentText) continue;

    const fileMatch = commentText.match(disableFilePattern);
    if (fileMatch) {
      registerSuppression(file.relativePath, fileMatch[1], fileMatch[2], validRuleIds, warnings, (ruleId, reason) => {
        const directive = {
          id: buildDirectiveId(file.relativePath, index + 1, "file", ruleId),
          file: file.relativePath,
          ruleId,
          kind: "file",
          reason,
          directiveLine: index + 1,
        } satisfies SuppressionDirective;
        fileRules.set(ruleId, directive);
        directives.push(directive);
      });
      continue;
    }

    const nextLineMatch = commentText.match(disableNextLinePattern);
    if (!nextLineMatch) continue;

    registerSuppression(file.relativePath, nextLineMatch[1], nextLineMatch[2], validRuleIds, warnings, (ruleId, reason) => {
      const targetLine = index + 2;
      const rules = nextLineRules.get(targetLine) ?? new Map<string, SuppressionDirective>();
      const directive = {
        id: buildDirectiveId(file.relativePath, index + 1, "next-line", ruleId),
        file: file.relativePath,
        ruleId,
        kind: "next-line",
        reason,
        directiveLine: index + 1,
        targetLine,
      } satisfies SuppressionDirective;
      rules.set(ruleId, directive);
      nextLineRules.set(targetLine, rules);
      directives.push(directive);
    });
  }

  return { fileRules, nextLineRules, directives };
}

function extractSuppressionComment(line: string): string | undefined {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//")) return trimmed.slice(2);
  if (trimmed.startsWith("#")) return trimmed.slice(1);
  if (trimmed.startsWith("/*")) return trimmed.replace(/^\/\*+/, "").replace(/\*\/\s*$/, "");
  if (trimmed.startsWith("*")) return trimmed.slice(1);
  if (trimmed.startsWith("<!--")) return trimmed.slice(4).replace(/-->\s*$/, "");
  return undefined;
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

function buildDirectiveAudit(
  directive: SuppressionDirective,
  outcome: Pick<SuppressionDirectiveAudit, "recommendedAction" | "status">,
): SuppressionDirectiveAudit {
  return {
    ruleId: directive.ruleId,
    file: directive.file,
    kind: directive.kind,
    reason: directive.reason,
    directiveLine: directive.directiveLine,
    ...(directive.targetLine ? { targetLine: directive.targetLine } : {}),
    status: outcome.status,
    suppressedIssueCount: 0,
    recommendedAction: outcome.recommendedAction,
  };
}

function getUsedRecommendation(kind: SuppressionDirectiveAudit["kind"], suppressedIssueCount: number): string {
  if (kind === "file") {
    return suppressedIssueCount > 1
      ? "Review whether this file-wide suppression can be narrowed to specific next-line suppressions."
      : "Review whether this file-wide suppression can be narrowed to a next-line suppression.";
  }
  return "Keep this suppression only while the documented exception remains valid.";
}

function buildDirectiveId(file: string, directiveLine: number, kind: SuppressionDirective["kind"], ruleId: string): string {
  return `${file}:${directiveLine}:${kind}:${ruleId}`;
}

function compareDirectiveAudits(left: SuppressionDirectiveAudit, right: SuppressionDirectiveAudit): number {
  const byFile = left.file.localeCompare(right.file);
  if (byFile !== 0) return byFile;
  return left.directiveLine - right.directiveLine;
}
