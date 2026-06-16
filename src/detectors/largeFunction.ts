import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes, countBranches, getFunctionBody } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

interface FunctionCandidate {
  name: string;
  body: MorphNode;
  file: string;
}

export const largeFunctionDetector: Detector = {
  id: "large-function",
  name: "Large function",
  description: "Flags non-component functions that exceed line or branch budgets.",
  defaultSeverity: "medium",
  tags: ["complexity", "maintainability", "function-design"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxLines = context.getThreshold("large-function.maxLines", 120);
    const maxBranches = context.getThreshold("large-function.maxBranches", 12);

    for (const file of context.files) {
      for (const fn of collectFunctionLikes(file)) {
        if (fn.classification === "component") continue;

        const body = getFunctionBody(fn.node);
        if (!body) continue;

        maybePushIssue(issues, { name: fn.name, body, file: file.relativePath }, maxLines, maxBranches);
      }

      for (const candidate of collectMethodCandidates(file.relativePath, file.sourceFile)) {
        maybePushIssue(issues, candidate, maxLines, maxBranches);
      }
    }

    return issues;
  },
};

function maybePushIssue(
  issues: DebtIssue[],
  candidate: FunctionCandidate,
  maxLines: number,
  maxBranches: number,
): void {
  const span = nodeLineSpan(candidate.body);
  const branchCount = countBranches(candidate.body);
  const overLineBudget = span.lines >= maxLines;
  const overBranchBudget = branchCount >= maxBranches;
  if (!overLineBudget && !overBranchBudget) return;

  issues.push(createIssue({
    detector: largeFunctionDetector,
    severity: overLineBudget && overBranchBudget ? "high" : "medium",
    confidence: overLineBudget ? 0.82 : 0.76,
    file: candidate.file,
    location: { startLine: span.startLine, endLine: span.endLine },
    message: `${candidate.name} is large enough to hide multiple responsibilities. It spans ${span.lines} lines and contains ${branchCount} branch points.`,
    evidence: [
      `Lines: ${span.lines} / ${maxLines}`,
      `Branch points: ${branchCount} / ${maxBranches}`,
    ],
    suggestion: "Split unrelated branches or phases into named helpers so each function has a single reviewable responsibility.",
  }));
}

function collectMethodCandidates(file: string, sourceFile: MorphNode): FunctionCandidate[] {
  const candidates: FunctionCandidate[] = [];
  for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    const body = method.getBody();
    if (!body) continue;
    candidates.push({ name: method.getName(), body, file });
  }
  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const initializer = assignment.getInitializer();
    if (!initializer || (!Node.isFunctionExpression(initializer) && !Node.isArrowFunction(initializer))) continue;
    const body = initializer.getBody();
    if (!body) continue;
    candidates.push({ name: assignment.getName(), body, file });
  }
  return candidates;
}
