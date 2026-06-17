import { Node, SyntaxKind } from "ts-morph";
import type { CallExpression, Node as MorphNode } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { nodeLineSpan } from "../utils/lines.js";

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "del", "head", "options", "all", "use"]);

interface HandlerCandidate {
  method: string;
  name: string;
  body: MorphNode;
}

export const handlerDepthDetector: Detector = {
  id: "handler-depth",
  name: "Handler depth",
  description: "Flags Node route handlers with deeply nested middleware/control-flow bodies.",
  defaultSeverity: "medium",
  tags: ["node", "routes", "complexity"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxDepth = context.getThreshold("handler-depth.maxDepth", 4);
    const maxMiddleware = context.getThreshold("handler-depth.maxMiddleware", 5);

    for (const file of context.files) {
      for (const candidate of collectHandlerCandidates(file.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression))) {
        const depth = maxControlDepth(candidate.body);
        const nestedCallbacks = nestedCallbackCount(candidate.body);
        const middlewareCount = candidate.method === "use" ? countMiddlewareArguments(candidate.body) : 0;
        const overDepth = depth >= maxDepth;
        const overCallbacks = nestedCallbacks >= maxDepth;
        const overMiddleware = middlewareCount >= maxMiddleware;
        if (!overDepth && !overCallbacks && !overMiddleware) continue;

        const span = nodeLineSpan(candidate.body);
        issues.push(createIssue({
          detector: handlerDepthDetector,
          severity: depth >= maxDepth + 2 || nestedCallbacks >= maxDepth + 2 ? "high" : "medium",
          confidence: 0.76,
          file: file.relativePath,
          location: { startLine: span.startLine, endLine: span.endLine },
          message: `${candidate.name} has route-handler nesting depth ${Math.max(depth, nestedCallbacks)}.`,
          evidence: [
            `Control depth: ${depth} / ${maxDepth}`,
            `Nested callbacks: ${nestedCallbacks} / ${maxDepth}`,
            ...(middlewareCount > 0 ? [`Middleware arguments: ${middlewareCount} / ${maxMiddleware}`] : []),
          ],
          suggestion: "Move validation, loading, and response branches into named middleware or service helpers so the handler reads as a flat request workflow.",
        }));
      }
    }

    return issues;
  },
};

function collectHandlerCandidates(calls: CallExpression[]): HandlerCandidate[] {
  const candidates: HandlerCandidate[] = [];

  for (const call of calls) {
    const expression = call.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;

    const method = expression.getName();
    if (!ROUTE_METHODS.has(method)) continue;

    const args = call.getArguments();
    const firstArg = args[0];
    if (!firstArg || !isRoutePathArgument(firstArg)) continue;

    for (const argument of args.slice(1)) {
      if (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) {
        const body = argument.getBody();
        candidates.push({
          method,
          name: `${expression.getText()} handler`,
          body,
        });
      }
    }
  }

  return candidates;
}

function maxControlDepth(node: MorphNode): number {
  let maxDepth = 0;

  const visit = (current: MorphNode, depth: number) => {
    const nextDepth = isNestingNode(current) ? depth + 1 : depth;
    maxDepth = Math.max(maxDepth, nextDepth);
    for (const child of current.getChildren()) {
      visit(child, nextDepth);
    }
  };

  visit(node, 0);
  return maxDepth;
}

function nestedCallbackCount(node: MorphNode): number {
  let maxDepth = 0;

  const visit = (current: MorphNode, depth: number) => {
    const nextDepth = Node.isArrowFunction(current) || Node.isFunctionExpression(current) ? depth + 1 : depth;
    maxDepth = Math.max(maxDepth, nextDepth);
    for (const child of current.getChildren()) {
      visit(child, nextDepth);
    }
  };

  visit(node, 0);
  return maxDepth;
}

function countMiddlewareArguments(node: MorphNode): number {
  const parent = node.getParent();
  const call = parent?.getFirstAncestorByKind(SyntaxKind.CallExpression);
  return call?.getArguments().length ?? 0;
}

function isNestingNode(node: MorphNode): boolean {
  const kind = node.getKind();
  return kind === SyntaxKind.IfStatement
    || kind === SyntaxKind.ForStatement
    || kind === SyntaxKind.ForOfStatement
    || kind === SyntaxKind.ForInStatement
    || kind === SyntaxKind.WhileStatement
    || kind === SyntaxKind.DoStatement
    || kind === SyntaxKind.SwitchStatement
    || kind === SyntaxKind.TryStatement
    || kind === SyntaxKind.CatchClause;
}

function isRoutePathArgument(node: MorphNode): boolean {
  return Node.isStringLiteral(node)
    || Node.isNoSubstitutionTemplateLiteral(node)
    || Node.isRegularExpressionLiteral(node);
}
