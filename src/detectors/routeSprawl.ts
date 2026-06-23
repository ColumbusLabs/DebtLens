import { Node, SyntaxKind } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { DebtIssue, Detector, DetectorContext } from "../core/types.js";
import { createIssue } from "../utils/createIssue.js";
import { isRoutePathArgument } from "../utils/nextSurface.js";
import { nodeLineSpan } from "../utils/lines.js";

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "del", "head", "options", "all"]);

interface RouteRegistration {
  method: string;
  path: string;
  line: number;
}

export const routeSprawlDetector: Detector = {
  id: "route-sprawl",
  name: "Route sprawl",
  description: "Flags Node route modules that register too many endpoints in one file.",
  defaultSeverity: "medium",
  tags: ["node", "routes", "module-boundaries"],
  detect(context: DetectorContext): DebtIssue[] {
    const issues: DebtIssue[] = [];
    const maxRoutes = context.getThreshold("route-sprawl.maxRoutes", 8);

    for (const file of context.files) {
      const registrations = collectRouteRegistrations(file.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression));
      if (registrations.length < maxRoutes) continue;

      const span = nodeLineSpan(file.sourceFile);
      issues.push(createIssue({
        detector: routeSprawlDetector,
        severity: registrations.length >= maxRoutes * 1.5 ? "high" : "medium",
        confidence: 0.8,
        file: file.relativePath,
        location: { startLine: span.startLine, endLine: span.endLine },
        message: `${file.relativePath} registers ${registrations.length} routes in one module.`,
        evidence: registrations
          .slice(0, 10)
          .map((route) => `${route.method.toUpperCase()} ${route.path} at line ${route.line}`),
        suggestion: "Split endpoints by resource or workflow so each route module has a smaller ownership surface.",
      }));
    }

    return issues;
  },
};

function collectRouteRegistrations(calls: CallExpression[]): RouteRegistration[] {
  const registrations: RouteRegistration[] = [];

  for (const call of calls) {
    const expression = call.getExpression();
    const route = describeRouteCall(call, expression);
    if (route) registrations.push(route);
  }

  return registrations;
}

function describeRouteCall(call: CallExpression, expression: Node): RouteRegistration | undefined {
  if (Node.isPropertyAccessExpression(expression)) {
    const method = expression.getName();
    if (method === "route") {
      const [firstArg] = call.getArguments();
      if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) return undefined;
      const methodProperty = firstArg.getProperty("method");
      const pathProperty = firstArg.getProperty("url") ?? firstArg.getProperty("path");
      if (!methodProperty || !pathProperty) return undefined;

      return {
        method: propertyInitializerText(methodProperty).replaceAll(/['"]/g, "").toLowerCase() || "route",
        path: propertyInitializerText(pathProperty) || "<configured route>",
        line: call.getStartLineNumber(),
      };
    }

    if (!ROUTE_METHODS.has(method)) return undefined;

    const args = call.getArguments();
    if (args.length < 2) return undefined;
    const [firstArg] = args;
    if (!firstArg || !isRoutePathArgument(firstArg)) return undefined;

    return {
      method,
      path: firstArg.getText().slice(0, 80),
      line: call.getStartLineNumber(),
    };
  }

  if (Node.isIdentifier(expression) && expression.getText() === "route") {
    const [firstArg] = call.getArguments();
    if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) return undefined;
    const methodProperty = firstArg.getProperty("method");
    const pathProperty = firstArg.getProperty("url") ?? firstArg.getProperty("path");
    if (!methodProperty || !pathProperty) return undefined;

    return {
      method: propertyInitializerText(methodProperty).replaceAll(/['"]/g, "").toLowerCase() || "route",
      path: propertyInitializerText(pathProperty) || "<configured route>",
      line: call.getStartLineNumber(),
    };
  }

  return undefined;
}

function propertyInitializerText(property: Node): string {
  if (Node.isPropertyAssignment(property)) {
    return property.getInitializer()?.getText().slice(0, 80) ?? "";
  }
  return property.getText().slice(0, 80);
}
