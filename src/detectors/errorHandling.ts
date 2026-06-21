import { Node, SyntaxKind } from "ts-morph";
import type { CatchClause, Node as MorphNode, Statement } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

const MAX_FINDINGS_PER_FILE = 12;
const disableNextLinePattern = /debtlens-disable-next-line\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;
const disableFilePattern = /debtlens-disable-file\s+([a-z0-9-]+)(?:\s+--\s+(.+))?/i;

export const emptyCatchDetector: Detector = {
  id: "empty-catch",
  name: "Empty catch block",
  description: "Flags catch blocks that silently ignore errors without handling or rethrowing.",
  defaultSeverity: "medium",
  tags: ["error-handling", "maintainability", "review"],
  detect(context: DetectorContext): DebtIssue[] {
    const allowCommentOnly = context.getThreshold("empty-catch.allowCommentOnly", 0) >= 1;
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      let countForFile = 0;
      const suppressedRules = parseFileSuppressions(file.content);

      for (const tryStatement of file.sourceFile.getDescendantsOfKind(SyntaxKind.TryStatement)) {
        const catchClause = tryStatement.getCatchClause();
        if (!catchClause) continue;

        const span = nodeLineSpan(catchClause);
        if (isSuppressed(suppressedRules, "empty-catch", span.startLine)) continue;

        const classification = classifyCatchBody(catchClause);
        if (classification === "handled") continue;
        if (classification === "comment-only" && allowCommentOnly) continue;

        issues.push(createEmptyCatchIssue(file.relativePath, catchClause, classification));
        countForFile += 1;
        if (countForFile >= MAX_FINDINGS_PER_FILE) break;
      }
    }

    return issues;
  },
};

export const swallowedErrorDetector: Detector = {
  id: "swallowed-error",
  name: "Swallowed error",
  description: "Flags catch blocks that only log an error without rethrowing, returning, or otherwise handling it.",
  defaultSeverity: "medium",
  tags: ["error-handling", "maintainability", "review"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      let countForFile = 0;
      const suppressedRules = parseFileSuppressions(file.content);

      for (const tryStatement of file.sourceFile.getDescendantsOfKind(SyntaxKind.TryStatement)) {
        const catchClause = tryStatement.getCatchClause();
        if (!catchClause) continue;

        const span = nodeLineSpan(catchClause);
        if (isSuppressed(suppressedRules, "swallowed-error", span.startLine)) continue;
        if (!isSwallowedErrorCatch(catchClause)) continue;

        issues.push(createSwallowedErrorIssue(file.relativePath, catchClause));
        countForFile += 1;
        if (countForFile >= MAX_FINDINGS_PER_FILE) break;
      }
    }

    return issues;
  },
};

type CatchBodyClassification = "empty" | "comment-only" | "handled";

function classifyCatchBody(catchClause: CatchClause): CatchBodyClassification {
  const block = catchClause.getBlock();
  const statements = block.getStatements();
  const meaningfulStatements = statements.filter((statement) => !Node.isEmptyStatement(statement));
  if (meaningfulStatements.length > 0) return "handled";

  if (statements.length === 0 && !blockHasComments(block)) return "empty";
  if (statements.every((statement) => Node.isEmptyStatement(statement)) && !blockHasComments(block)) {
    return "empty";
  }

  return "comment-only";
}

function blockHasComments(block: MorphNode): boolean {
  const text = block.getText().replace(/^\{|\}$/g, "").trim();
  if (!text) return false;
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n\r]*/g, "")
    .trim();
  return withoutComments.length === 0;
}

function isSwallowedErrorCatch(catchClause: CatchClause): boolean {
  const block = catchClause.getBlock();
  const meaningfulStatements = block.getStatements().filter((statement) => !Node.isEmptyStatement(statement));
  if (meaningfulStatements.length === 0) return false;
  if (meaningfulStatements.some((statement) => Node.isThrowStatement(statement))) return false;
  if (meaningfulStatements.some((statement) => Node.isReturnStatement(statement))) return false;
  if (!meaningfulStatements.every((statement) => isLoggingStatement(statement))) return false;
  if (usesCatchBindingBeyondLogArgs(catchClause, meaningfulStatements)) return false;
  return true;
}

function isLoggingStatement(statement: Statement): boolean {
  if (!Node.isExpressionStatement(statement)) return false;
  const expression = statement.getExpression();
  if (!Node.isCallExpression(expression)) return false;
  return isLoggingCallExpression(expression);
}

function isLoggingCallExpression(call: MorphNode): boolean {
  if (!Node.isCallExpression(call)) return false;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;

  const target = callee.getExpression().getText();
  const method = callee.getName();
  if (target === "console") return method === "error" || method === "warn" || method === "log";
  if (target === "logger") return true;
  return false;
}

function usesCatchBindingBeyondLogArgs(catchClause: CatchClause, statements: Statement[]): boolean {
  const bindingName = catchClause.getVariableDeclaration()?.getName();
  if (!bindingName) return false;

  const logCalls = statements.flatMap((statement) =>
    statement.getDescendantsOfKind(SyntaxKind.CallExpression).filter(isLoggingCallExpression),
  );

  for (const statement of statements) {
    for (const identifier of statement.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (identifier.getText() !== bindingName) continue;
      if (isLoggingCalleeIdentifier(identifier)) continue;
      if (!isWithinLoggingCallArgument(identifier, logCalls)) return true;
    }
  }

  return false;
}

function isLoggingCalleeIdentifier(identifier: MorphNode): boolean {
  const parent = identifier.getParent();
  return Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier;
}

function isWithinLoggingCallArgument(identifier: MorphNode, logCalls: MorphNode[]): boolean {
  for (const logCall of logCalls) {
    if (!Node.isCallExpression(logCall)) continue;
    for (const argument of logCall.getArguments()) {
      if (argument === identifier) return true;
      if (identifier.getAncestors().some((ancestor) => ancestor === argument)) return true;
    }
  }
  return false;
}

interface FileSuppressionRules {
  fileRules: Set<string>;
  nextLineRules: Map<number, Set<string>>;
  inlineLineRules: Map<number, Set<string>>;
}

function parseFileSuppressions(content: string): FileSuppressionRules {
  const fileRules = new Set<string>();
  const nextLineRules = new Map<number, Set<string>>();
  const inlineLineRules = new Map<number, Set<string>>();
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;

    const fileMatch = line.match(disableFilePattern);
    if (fileMatch?.[1] && fileMatch[2]?.trim()) {
      fileRules.add(fileMatch[1].toLowerCase());
      inlineLineRules.set(lineNumber, addRule(inlineLineRules.get(lineNumber), fileMatch[1]));
      continue;
    }

    const nextLineMatch = line.match(disableNextLinePattern);
    if (!nextLineMatch?.[1] || !nextLineMatch[2]?.trim()) continue;

    const ruleId = nextLineMatch[1].toLowerCase();
    inlineLineRules.set(lineNumber, addRule(inlineLineRules.get(lineNumber), ruleId));
    nextLineRules.set(lineNumber + 1, addRule(nextLineRules.get(lineNumber + 1), ruleId));
  }

  return { fileRules, nextLineRules, inlineLineRules };
}

function addRule(existing: Set<string> | undefined, ruleId: string): Set<string> {
  const rules = existing ?? new Set<string>();
  rules.add(ruleId.toLowerCase());
  return rules;
}

function isSuppressed(rules: FileSuppressionRules, ruleId: string, line: number): boolean {
  const normalizedRuleId = ruleId.toLowerCase();
  if (rules.fileRules.has(normalizedRuleId)) return true;
  if (rules.nextLineRules.get(line)?.has(normalizedRuleId)) return true;
  if (rules.inlineLineRules.get(line)?.has(normalizedRuleId)) return true;
  return false;
}

function createEmptyCatchIssue(
  file: string,
  catchClause: CatchClause,
  classification: CatchBodyClassification,
): DebtIssue {
  const span = nodeLineSpan(catchClause);
  const detail = classification === "comment-only"
    ? "contains only comments"
    : classification === "empty"
      ? "is empty"
      : "ignores errors";

  return createIssue({
    detector: emptyCatchDetector,
    severity: "medium",
    confidence: 0.88,
    file,
    location: { startLine: span.startLine, endLine: span.endLine },
    message: `Catch block ${detail} and silently ignores errors.`,
    evidence: [
      `Catch body: ${classification}`,
      catchClause.getBlock().getText().trim().slice(0, 220),
    ],
    suggestion: "Handle the error explicitly, rethrow it, or document why ignoring it is safe.",
  });
}

function createSwallowedErrorIssue(file: string, catchClause: CatchClause): DebtIssue {
  const span = nodeLineSpan(catchClause);
  return createIssue({
    detector: swallowedErrorDetector,
    severity: "medium",
    confidence: 0.72,
    file,
    location: { startLine: span.startLine, endLine: span.endLine },
    message: "Catch block only logs the error without rethrowing or returning a handled result.",
    evidence: [
      catchClause.getBlock().getText().trim().slice(0, 220),
    ],
    suggestion: "Rethrow, return a typed error result, or escalate to monitoring instead of logging alone.",
  });
}
