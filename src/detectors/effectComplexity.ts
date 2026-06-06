import { Node, SyntaxKind } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

export const effectComplexityDetector: Detector = {
  id: "effect-complexity",
  name: "Effect complexity",
  description: "Flags React effect hooks that are long, branchy, or overloaded with dependencies.",
  defaultSeverity: "medium",
  tags: ["react", "effects", "complexity"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxLines = context.getThreshold("effect-complexity.maxLines", 30);
    const maxDependencies = context.getThreshold("effect-complexity.maxDependencies", 8);

    for (const file of context.files) {
      for (const call of file.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expression = call.getExpression();
        const expressionName = Node.isIdentifier(expression)
          ? expression.getText()
          : Node.isPropertyAccessExpression(expression)
            ? expression.getName()
            : undefined;

        if (!expressionName || !EFFECT_HOOKS.has(expressionName)) continue;

        const [callback, dependencies] = call.getArguments();
        if (!callback) continue;

        const span = nodeLineSpan(callback);
        const branchCount = callback.getDescendants().filter((node) => {
          const kind = node.getKind();
          return kind === SyntaxKind.IfStatement
            || kind === SyntaxKind.ConditionalExpression
            || kind === SyntaxKind.ForStatement
            || kind === SyntaxKind.ForOfStatement
            || kind === SyntaxKind.WhileStatement
            || kind === SyntaxKind.SwitchStatement;
        }).length;

        const dependencyCount = dependencies && Node.isArrayLiteralExpression(dependencies)
          ? dependencies.getElements().length
          : 0;

        const hasAsyncWork = callback.getDescendantsOfKind(SyntaxKind.AwaitExpression).length > 0;
        const callCount = callback.getDescendantsOfKind(SyntaxKind.CallExpression).length;

        if (span.lines < maxLines && dependencyCount < maxDependencies && branchCount < 4 && callCount < 8) continue;

        issues.push(createIssue({
          detector: effectComplexityDetector,
          severity: span.lines >= maxLines * 1.5 || branchCount >= 6 ? "high" : "medium",
          confidence: 0.8,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `This ${expressionName} spans ${span.lines} lines, has ${dependencyCount} dependencies, ${branchCount} branches, and ${callCount} nested calls.`,
          evidence: [
            `Lines: ${span.lines} / ${maxLines}`,
            `Dependencies: ${dependencyCount} / ${maxDependencies}`,
            `Branches: ${branchCount}`,
            hasAsyncWork ? "Contains async work" : "No await detected",
          ],
          suggestion: "Split unrelated effects, move imperative workflows into named functions, or replace derived state effects with memoized values.",
        }));
      }
    }

    return issues;
  },
};
