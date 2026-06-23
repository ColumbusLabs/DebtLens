import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

export const cognitiveComplexityDetector: Detector = {
  id: "cognitive-complexity",
  name: "Cognitive complexity",
  description: "Flags functions whose nested control flow is hard to read using a Sonar-style cognitive complexity score.",
  defaultSeverity: "medium",
  tags: ["complexity", "maintainability", "readability"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxScore = context.getThreshold("cognitive-complexity.max", 15);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const fn of collectFunctionLikes(file)) {
        maybePushIssue(issues, fn.name, fn.node, file.relativePath, maxScore);
      }
      for (const method of file.sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
        const body = method.getBody();
        if (!body) continue;
        maybePushIssue(issues, method.getName(), body, file.relativePath, maxScore);
      }
    }

    return issues;
  },
};

function maybePushIssue(
  issues: DebtIssue[],
  name: string,
  body: MorphNode,
  file: string,
  maxScore: number,
): void {
  const score = computeCognitiveComplexity(body);
  if (score < maxScore) return;
  const span = nodeLineSpan(body);
  const overage = score / maxScore;
  issues.push(createIssue({
    detector: cognitiveComplexityDetector,
    severity: overage >= 1.5 ? "high" : "medium",
    confidence: Math.min(0.95, 0.66 + (overage - 1) * 0.24),
    file,
    location: { startLine: span.startLine, endLine: span.endLine },
    message: `${name} has cognitive complexity ${score}, which is harder to follow than cyclomatic counts alone suggest.`,
    evidence: [
      `Cognitive complexity: ${score} / ${maxScore}`,
      "Nesting and boolean sequences add extra weight beyond flat branch counts.",
    ],
    suggestion: "Extract nested branches into named helpers or early-return guard clauses so the main path stays linear.",
  }));
}

function computeCognitiveComplexity(node: MorphNode): number {
  return walkNode(node, 0).score;
}

function walkNode(node: MorphNode, nesting: number): { score: number } {
  let score = 0;

  if (isIncrementNode(node)) {
    score += 1 + nesting;
  }

  const childNesting = isNestingNode(node) ? nesting + 1 : nesting;
  for (const child of node.getChildren()) {
    score += walkNode(child, childNesting).score;
  }

  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getText();
    if (operator === "&&" || operator === "||") {
      score += 1;
    }
  }

  return { score };
}

function isIncrementNode(node: MorphNode): boolean {
  return Node.isIfStatement(node)
    || Node.isForStatement(node)
    || Node.isForOfStatement(node)
    || Node.isForInStatement(node)
    || Node.isWhileStatement(node)
    || Node.isDoStatement(node)
    || Node.isCatchClause(node)
    || Node.isConditionalExpression(node)
    || (Node.isCaseClause(node) && node.getExpression() !== undefined);
}

function isNestingNode(node: MorphNode): boolean {
  return Node.isIfStatement(node)
    || Node.isForStatement(node)
    || Node.isForOfStatement(node)
    || Node.isForInStatement(node)
    || Node.isWhileStatement(node)
    || Node.isDoStatement(node)
    || Node.isCatchClause(node)
    || Node.isSwitchStatement(node);
}
