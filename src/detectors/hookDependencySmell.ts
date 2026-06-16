import { Node, SyntaxKind } from "ts-morph";
import type { ArrayLiteralExpression, Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

const DEPENDENCY_ARRAY_INDEX_BY_HOOK = new Map<string, number>([
  ["useCallback", 1],
  ["useEffect", 1],
  ["useInsertionEffect", 1],
  ["useLayoutEffect", 1],
  ["useMemo", 1],
  ["useImperativeHandle", 2],
]);

export const hookDependencySmellDetector: Detector = {
  id: "hook-dependency-smell",
  name: "Hook dependency smell",
  description: "Flags React hook dependency arrays that contain inline literals recreated each render.",
  defaultSeverity: "low",
  tags: ["react", "hooks", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const call of file.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const hookName = getHookName(call.getExpression());
        const dependencyArrayIndex = hookName ? DEPENDENCY_ARRAY_INDEX_BY_HOOK.get(hookName) : undefined;
        if (dependencyArrayIndex === undefined) continue;

        const dependencyArray = call.getArguments()[dependencyArrayIndex];
        if (!dependencyArray || !Node.isArrayLiteralExpression(dependencyArray)) continue;

        const unstableDependencies = getUnstableInlineDependencies(dependencyArray);
        if (unstableDependencies.length === 0) continue;

        const span = nodeLineSpan(dependencyArray);
        issues.push(createIssue({
          detector: hookDependencySmellDetector,
          severity: unstableDependencies.length >= 2 ? "medium" : "low",
          confidence: 0.78,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${hookName} has ${unstableDependencies.length} inline dependency value${unstableDependencies.length === 1 ? "" : "s"} that will be recreated each render.`,
          evidence: unstableDependencies.map((dependency) => `${dependency.kind}: ${dependency.text}`),
          suggestion: "Move the value to a stable identifier with useMemo/useCallback, or depend on the primitive inputs that actually drive the hook.",
        }));
      }
    }

    return issues;
  },
};

function getHookName(expression: MorphNode): string | undefined {
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  return undefined;
}

function getUnstableInlineDependencies(dependencyArray: ArrayLiteralExpression): Array<{ kind: string; text: string }> {
  const dependencies: Array<{ kind: string; text: string }> = [];

  for (const element of dependencyArray.getElements()) {
    const unwrapped = unwrapExpression(element);
    const kind = getInlineDependencyKind(unwrapped);
    if (!kind) continue;

    dependencies.push({
      kind,
      text: unwrapped.getText().replace(/\s+/g, " ").slice(0, 120),
    });
  }

  return dependencies;
}

function unwrapExpression(node: MorphNode): MorphNode {
  let current = node;
  while (
    Node.isParenthesizedExpression(current)
    || Node.isAsExpression(current)
    || Node.isTypeAssertion(current)
    || Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function getInlineDependencyKind(node: MorphNode): string | undefined {
  if (Node.isObjectLiteralExpression(node)) return "inline object";
  if (Node.isArrayLiteralExpression(node)) return "inline array";
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) return "inline function";
  return undefined;
}
