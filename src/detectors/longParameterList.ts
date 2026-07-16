import { Node, SyntaxKind } from "ts-morph";
import type { ArrowFunction, FunctionDeclaration, FunctionExpression, MethodDeclaration, ParameterDeclaration } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { collectFunctionLikes } from "../utils/ast.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

const FRAMEWORK_SINGLE_PARAM_NAMES = new Set(["props", "state", "action", "context", "event", "req", "res", "next"]);

export const longParameterListDetector: Detector = {
  id: "long-parameter-list",
  name: "Long parameter list",
  description: "Flags functions with too many parameters or multiple boolean flag parameters.",
  defaultSeverity: "medium",
  tags: ["function-design", "maintainability", "api-design"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxParams = context.getThreshold("long-parameter-list.maxParams", 5);
    const maxBooleans = context.getThreshold("long-parameter-list.maxBooleans", 2);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      for (const fn of collectFunctionLikes(file)) {
        maybePushIssue(issues, fn.name, fn.node, file.relativePath, maxParams, maxBooleans);
      }

      for (const method of file.sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
        maybePushIssue(issues, method.getName(), method, file.relativePath, maxParams, maxBooleans);
      }
    }

    return issues;
  },
};

function maybePushIssue(
  issues: DebtIssue[],
  name: string,
  node: FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration,
  file: string,
  maxParams: number,
  maxBooleans: number,
): void {
  const params = getParameters(node);
  if (params.length === 0) return;
  if (shouldSkipSignature(name, params)) return;

  const booleanCount = countBooleanParams(params);
  const overParamBudget = params.length > maxParams;
  const overBooleanBudget = booleanCount >= maxBooleans;
  if (!overParamBudget && !overBooleanBudget) return;

  const body = Node.isMethodDeclaration(node) ? node.getBody() : getFunctionBodyNode(node);
  const span = body ? nodeLineSpan(body) : nodeLineSpan(node);
  const confidence = computeConfidence(params.length, maxParams, booleanCount, maxBooleans);

  issues.push(createIssue({
    detector: longParameterListDetector,
    severity: overParamBudget && overBooleanBudget ? "high" : "medium",
    confidence,
    file,
    location: { startLine: span.startLine, endLine: span.endLine },
    message: overBooleanBudget && overParamBudget
      ? `${name} has ${params.length} parameters including ${booleanCount} boolean flags.`
      : overBooleanBudget
        ? `${name} has ${booleanCount} boolean parameters that read like a boolean trap.`
        : `${name} has ${params.length} parameters.`,
    evidence: [
      `Parameters: ${params.length} / ${maxParams}`,
      `Boolean parameters: ${booleanCount} / ${maxBooleans}`,
      `Signature: ${truncateSignature(node)}`,
    ],
    suggestion: overBooleanBudget
      ? "Replace boolean flags with an options object, named constants, or split the function by behavior."
      : "Group related inputs into a focused options object or split the function into smaller helpers.",
  }));
}

function getParameters(node: FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration): ParameterDeclaration[] {
  if (Node.isMethodDeclaration(node)) {
    return node.getParameters();
  }
  return node.getParameters();
}

function getFunctionBodyNode(node: FunctionDeclaration | ArrowFunction | FunctionExpression): ReturnType<FunctionDeclaration["getBody"]> {
  return node.getBody();
}

function shouldSkipSignature(name: string, params: ParameterDeclaration[]): boolean {
  if (params.length === 1) {
    const paramName = params[0]?.getName().toLowerCase() ?? "";
    if (FRAMEWORK_SINGLE_PARAM_NAMES.has(paramName)) return true;
    if (paramName === "props" || paramName.endsWith("props")) return true;
  }
  if (params.length === 2) {
    const names = params.map((param) => param.getName().toLowerCase());
    if (names[0] === "state" && names[1] === "action") return true;
  }
  if (name === "render" && params.length <= 2) return true;
  return false;
}

function countBooleanParams(params: ParameterDeclaration[]): number {
  let count = 0;
  for (const param of params) {
    const typeNode = param.getTypeNode();
    if (typeNode?.getText() === "boolean") {
      count += 1;
      continue;
    }
    const initializer = param.getInitializer()?.getText();
    if (initializer === "true" || initializer === "false") {
      count += 1;
    }
  }
  return count;
}

function computeConfidence(paramCount: number, maxParams: number, booleanCount: number, maxBooleans: number): number {
  const paramRatio = paramCount / Math.max(1, maxParams);
  const booleanRatio = booleanCount / Math.max(1, maxBooleans);
  const ratio = Math.max(paramRatio, booleanRatio);
  return Math.min(0.95, 0.62 + (ratio - 1) * 0.22 + (booleanCount >= maxBooleans ? 0.08 : 0));
}

function truncateSignature(node: FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration): string {
  const text = node.getText().split("{")[0]?.trim() ?? node.getText();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
