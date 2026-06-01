import { Node, SyntaxKind } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes, getFunctionBody } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { isHookName } from "../utils/identifiers.js";
import { nodeLineSpan } from "../utils/lines.js";

export const deadAbstractionDetector: Detector = {
  id: "dead-abstraction",
  name: "Dead abstraction",
  description: "Flags wrappers that add naming but very little behavior.",
  defaultSeverity: "low",
  tags: ["abstraction", "cleanup", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxWrapperLines = context.getThreshold("dead-abstraction.maxWrapperLines", 8);

    for (const file of context.files) {
      // Route modules (Expo Router / Next.js app & pages dirs) are thin wrappers by
      // convention — a route that renders its screen is not a dead abstraction.
      if (isRouteFile(file.relativePath)) continue;
      for (const fn of collectFunctionLikes(file)) {
        const body = getFunctionBody(fn.node);
        if (!body) continue;
        const span = nodeLineSpan(body);
        if (span.lines > maxWrapperLines) continue;

        const wrapper = describeWrapper(body, extractParamNames(fn.node));
        if (!wrapper) continue;

        issues.push(createIssue({
          detector: deadAbstractionDetector,
          severity: fn.classification === "hook" ? "medium" : "low",
          confidence: wrapper.confidence,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${fn.name} looks like a thin wrapper: ${wrapper.description}.`,
          evidence: [body.getText().replace(/\s+/g, " ").slice(0, 180)],
          suggestion: "Keep the wrapper only if it creates a stable domain boundary. Otherwise inline it or add the missing behavior where this abstraction belongs.",
        }));
      }
    }

    return issues;
  },
};

function describeWrapper(body: Node, paramNames: string[] | null): { description: string; confidence: number } | undefined {
  if (Node.isBlock(body)) {
    const statements = body.getStatements();
    if (statements.length !== 1) return undefined;
    const only = statements[0];
    if (!only) return undefined;

    if (Node.isReturnStatement(only)) {
      const expression = only.getExpression();
      if (!expression) return undefined;
      return describeExpression(expression, paramNames);
    }

    if (Node.isExpressionStatement(only)) {
      return describeExpression(only.getExpression(), paramNames);
    }
  }

  return describeExpression(body, paramNames);
}

function isRouteFile(relativePath: string): boolean {
  return /(^|\/)(app|pages)\//.test(relativePath);
}

/** Param identifier names in order, or null if any param is destructured/non-trivial. */
function extractParamNames(node: { getParameters: () => { getNameNode: () => Node }[] }): string[] | null {
  const names: string[] = [];
  for (const param of node.getParameters()) {
    const nameNode = param.getNameNode();
    if (!Node.isIdentifier(nameNode)) return null;
    names.push(nameNode.getText());
  }
  return names;
}

/** True if a call forwards exactly the wrapper's params, in order, unchanged. */
function isPassThrough(call: CallExpression, paramNames: string[]): boolean {
  const args = call.getArguments();
  if (args.length !== paramNames.length) return false;
  return args.every((arg, index) => Node.isIdentifier(arg) && arg.getText() === paramNames[index]);
}

function describeExpression(expression: Node, paramNames: string[] | null): { description: string; confidence: number } | undefined {
  if (Node.isCallExpression(expression)) {
    const callee = expression.getExpression();
    const calleeName = Node.isIdentifier(callee)
      ? callee.getText()
      : Node.isPropertyAccessExpression(callee)
        ? callee.getName()
        : "";
    // A hook that just composes another hook (useCallback, a store selector, etc.) is
    // idiomatic composition, not a dead abstraction.
    if (isHookName(calleeName)) return undefined;
    // Only flag a delegation when it adds nothing: a pure pass-through of the params.
    // `f(a, b) => g(a, b)` is dead; `f(a) => g(transform(a))` or `g(a, CONST)` is not.
    if (!paramNames || !isPassThrough(expression, paramNames)) return undefined;
    return { description: `it only delegates to ${callee.getText()}(...)`, confidence: 0.8 };
  }

  if (Node.isIdentifier(expression)) {
    return { description: `it only returns ${expression.getText()}`, confidence: 0.76 };
  }

  if (Node.isPropertyAccessExpression(expression)) {
    return { description: `it only returns ${expression.getText()}`, confidence: 0.72 };
  }

  if (expression.getKind() === SyntaxKind.JsxElement || expression.getKind() === SyntaxKind.JsxSelfClosingElement) {
    return { description: "it only forwards to a single JSX element", confidence: 0.68 };
  }

  return undefined;
}
