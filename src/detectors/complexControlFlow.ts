import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes, getFunctionBody } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

export const complexControlFlowDetector: Detector = {
  id: "complex-control-flow",
  name: "Complex control flow",
  description: "Flags functions whose branching and nesting make behavior hard to review.",
  defaultSeverity: "medium",
  tags: ["complexity", "maintainability", "review"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxComplexity = context.getThreshold("complex-control-flow.maxComplexity", 12);
    const maxDepth = context.getThreshold("complex-control-flow.maxDepth", 4);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const fn of collectFunctionLikes(file)) {
        const body = getFunctionBody(fn.node);
        if (!body) continue;
        const complexity = computeCyclomaticComplexity(body);
        const depth = computeMaxControlDepth(body);
        if (complexity < maxComplexity && depth < maxDepth) continue;
        const span = nodeLineSpan(body);
        const overage = Math.max(complexity / maxComplexity, depth / maxDepth);
        issues.push(createIssue({
          detector: complexControlFlowDetector,
          severity: overage >= 1.5 ? "high" : "medium",
          confidence: Math.min(0.95, 0.64 + (overage - 1) * 0.28),
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${fn.name} has complex control flow with score ${complexity} and nesting depth ${depth}.`,
          evidence: [
            `Complexity score: ${complexity} / ${maxComplexity}`,
            `Max nesting depth: ${depth} / ${maxDepth}`,
          ],
          suggestion: "Extract decision tables, guard clauses, or focused helpers so each branch can be reviewed independently.",
        }));
      }
    }

    return issues;
  },
};

function computeCyclomaticComplexity(node: MorphNode): number {
  let score = 1;
  for (const descendant of node.getDescendants()) {
    switch (descendant.getKind()) {
      case SyntaxKind.IfStatement:
      case SyntaxKind.ForStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.ForInStatement:
      case SyntaxKind.WhileStatement:
      case SyntaxKind.DoStatement:
      case SyntaxKind.CatchClause:
      case SyntaxKind.ConditionalExpression:
      case SyntaxKind.CaseClause:
        score += 1;
        break;
      case SyntaxKind.BinaryExpression: {
        const operator = descendant.asKind(SyntaxKind.BinaryExpression)?.getOperatorToken().getText();
        if (operator === "&&" || operator === "||" || operator === "??") score += 1;
        break;
      }
      default:
        break;
    }
  }
  return score;
}

function computeMaxControlDepth(node: MorphNode): number {
  let maxDepth = 0;
  const visit = (current: MorphNode, depth: number) => {
    const nextDepth = isControlNode(current) ? depth + 1 : depth;
    maxDepth = Math.max(maxDepth, nextDepth);
    for (const child of current.getChildren()) {
      visit(child, nextDepth);
    }
  };
  visit(node, 0);
  return maxDepth;
}

function isControlNode(node: MorphNode): boolean {
  return Node.isIfStatement(node)
    || Node.isForStatement(node)
    || Node.isForOfStatement(node)
    || Node.isForInStatement(node)
    || Node.isWhileStatement(node)
    || Node.isDoStatement(node)
    || Node.isSwitchStatement(node)
    || Node.isCatchClause(node)
    || Node.isConditionalExpression(node);
}
