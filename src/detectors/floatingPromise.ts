import { Node, SyntaxKind } from "ts-morph";
import type { CallExpression, Expression, ExpressionStatement, Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

export const floatingPromiseDetector: Detector = {
  id: "floating-promise",
  name: "Floating promise",
  description: "Flags promise-returning calls that are not awaited, returned, void-marked, or error-handled.",
  defaultSeverity: "medium",
  tags: ["async", "promises", "react", "maintainability"],
  detect(context: DetectorContext): DebtIssue[] {
    const allowVoid = context.getThreshold("floating-promise.allowVoid", 1) >= 1;
    const maxPerFile = context.getThreshold("floating-promise.maxPerFile", 12);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      let countForFile = 0;
      for (const statement of file.sourceFile.getDescendantsOfKind(SyntaxKind.ExpressionStatement)) {
        if (countForFile >= maxPerFile) break;

        const call = extractFloatingCall(statement, allowVoid);
        if (!call) continue;
        if (isSkippedContext(call)) continue;
        if (hasCatchOnChain(call)) continue;

        const promiseLike = assessPromiseLike(call, context);
        if (!promiseLike) continue;

        const effectHook = getEnclosingEffectHook(call);
        const span = nodeLineSpan(call);
        const evidence = [
          `Expression: ${truncate(call.getText())}`,
          "Not awaited, returned, assigned, void-marked, or passed as an argument",
          ...(effectHook ? ["Inside React effect without cleanup or error handling"] : []),
          ...promiseLike.evidence,
        ];

        issues.push(createIssue({
          detector: floatingPromiseDetector,
          severity: effectHook ? "medium" : floatingPromiseDetector.defaultSeverity,
          confidence: promiseLike.confidence,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: effectHook
            ? `Promise work inside ${effectHook} is not awaited or error-handled.`
            : "Promise-returning call is not awaited, returned, or explicitly handled.",
          evidence,
          suggestion: effectHook
            ? "Await the promise inside the effect, chain .catch(), or move async work into a named helper with explicit error handling."
            : "Await the call, return it to the caller, attach .catch(), or prefix with void when fire-and-forget is intentional.",
        }));

        countForFile += 1;
      }
    }

    return issues;
  },
};

function extractFloatingCall(statement: ExpressionStatement, allowVoid: boolean): CallExpression | undefined {
  let expression = unwrapParentheses(statement.getExpression());
  if (Node.isVoidExpression(expression)) {
    if (allowVoid) return undefined;
    expression = unwrapParentheses(expression.getExpression());
  }
  return Node.isCallExpression(expression) ? expression : undefined;
}

function isSkippedContext(node: MorphNode): boolean {
  return isInsideAwait(node)
    || isInsideReturn(node)
    || isInsideVariableDeclaration(node)
    || isPassedAsArgument(node);
}

function isInsideAwait(node: MorphNode): boolean {
  return node.getFirstAncestorByKind(SyntaxKind.AwaitExpression) !== undefined;
}

function isInsideReturn(node: MorphNode): boolean {
  return node.getFirstAncestorByKind(SyntaxKind.ReturnStatement) !== undefined;
}

function isInsideVariableDeclaration(node: MorphNode): boolean {
  return node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration) !== undefined;
}

function isPassedAsArgument(node: MorphNode): boolean {
  const parent = node.getParent();
  if (!parent) return false;
  if (!Node.isCallExpression(parent) && !Node.isNewExpression(parent)) return false;
  return parent.getArguments().some((argument) => argument === node);
}

function hasCatchOnChain(call: CallExpression): boolean {
  let current: MorphNode = call;
  while (Node.isCallExpression(current)) {
    const callee = current.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === "catch") {
      return true;
    }

    if (Node.isPropertyAccessExpression(callee) && Node.isCallExpression(callee.getExpression())) {
      current = callee.getExpression();
      continue;
    }

    break;
  }

  return false;
}

interface PromiseAssessment {
  confidence: number;
  evidence: string[];
}

function assessPromiseLike(call: CallExpression, context: DetectorContext): PromiseAssessment | undefined {
  const evidence: string[] = [];
  let confidence = 0.68;

  if (chainUsesMethod(call, "then")) {
    evidence.push("Promise chain uses .then()");
    confidence = 0.8;
  }

  const rootCall = getInnermostCall(call);
  const rootName = getCallTargetName(rootCall);
  if (rootName === "fetch") {
    evidence.push("Calls fetch()");
    confidence = Math.max(confidence, 0.82);
  }

  if (rootName === "Promise") {
    evidence.push("Calls Promise.*");
    confidence = Math.max(confidence, 0.84);
  }

  if (isAsyncCallee(rootCall)) {
    evidence.push("Calls async function");
    confidence = Math.max(confidence, 0.8);
  }

  const typeText = getPromiseReturnTypeText(call);
  if (typeText) {
    evidence.push(`Type checker reports ${typeText}`);
    confidence = Math.max(confidence, 0.88);
  }

  if (evidence.length === 0) return undefined;
  return { confidence, evidence };
}

function chainUsesMethod(call: CallExpression, methodName: string): boolean {
  let current: MorphNode = call;
  while (Node.isCallExpression(current)) {
    const callee = current.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === methodName) {
      return true;
    }

    if (Node.isPropertyAccessExpression(callee) && Node.isCallExpression(callee.getExpression())) {
      current = callee.getExpression();
      continue;
    }

    break;
  }

  return false;
}

function getInnermostCall(call: CallExpression): CallExpression {
  let current = call;
  while (true) {
    const callee = current.getExpression();
    if (Node.isPropertyAccessExpression(callee)) {
      const inner = callee.getExpression();
      if (Node.isCallExpression(inner)) {
        current = inner;
        continue;
      }
    }
    break;
  }

  return current;
}

function getCallTargetName(call: CallExpression): string | undefined {
  const expression = call.getExpression();
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) {
    if (Node.isIdentifier(expression.getExpression())) {
      return expression.getExpression().getText();
    }
    return expression.getName();
  }
  return undefined;
}

function isAsyncCallee(call: CallExpression): boolean {
  const expression = call.getExpression();
  if (!Node.isIdentifier(expression)) return false;

  const declarations = expression.getSymbol()?.getDeclarations() ?? [];
  for (const declaration of declarations) {
    if (
      (Node.isFunctionDeclaration(declaration)
        || Node.isFunctionExpression(declaration)
        || Node.isArrowFunction(declaration))
      && declaration.isAsync()
    ) {
      return true;
    }
  }

  return false;
}

function getPromiseReturnTypeText(call: CallExpression): string | undefined {
  try {
    const returnType = call.getReturnType();
    const text = returnType.getText(call);
    if (/Promise\s*<|Promise$/i.test(text)) {
      return truncate(text, 80);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getEnclosingEffectHook(node: MorphNode): string | undefined {
  for (const ancestor of node.getAncestors()) {
    if (!Node.isArrowFunction(ancestor) && !Node.isFunctionExpression(ancestor)) continue;

    const parent = ancestor.getParent();
    if (!Node.isCallExpression(parent)) continue;

    const hookName = getExpressionName(parent.getExpression());
    if (!hookName || !EFFECT_HOOKS.has(hookName)) continue;
    if (parent.getArguments()[0] !== ancestor) continue;
    return hookName;
  }

  return undefined;
}

function getExpressionName(expression: MorphNode): string | undefined {
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  return undefined;
}

function unwrapParentheses(expression: Expression): Expression {
  let current: Expression = expression;
  while (Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current;
}

function truncate(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}
