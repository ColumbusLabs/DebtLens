import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractPythonModule } from "./parse.js";

const HTTP_ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

interface PythonRouteRegistration {
  method: string;
  path: string;
  line: number;
  source: "decorator" | "django-urlconf";
}

export const pythonRouteSprawlDetector: Detector = {
  id: "python-route-sprawl",
  name: "Python route sprawl",
  description: "Flags Flask, Blueprint, or Django URL modules that register too many routes in one Python file.",
  defaultSeverity: "medium",
  tags: ["python", "routes", "framework", "module-boundaries"],
  languages: ["python"],
  detect(context: DetectorContext): DebtIssue[] {
    const maxRoutes = context.getThreshold("python-route-sprawl.maxRoutes", 8);
    const issues: DebtIssue[] = [];

    for (const file of context.files) {
      const routes = collectPythonRouteRegistrations(file, context.addWarning);
      if (routes.length < maxRoutes) continue;
      const span = fileLineSpan(file);

      issues.push(createIssue({
        detector: pythonRouteSprawlDetector,
        severity: routes.length >= maxRoutes * 1.5 ? "high" : "medium",
        confidence: 0.78,
        file: file.relativePath,
        location: { startLine: span.startLine, endLine: span.endLine },
        message: `${file.relativePath} registers ${routes.length} Python web routes in one module.`,
        evidence: routes
          .slice(0, 10)
          .map((route) => `${route.method} ${route.path} at line ${route.line}`),
        suggestion: "Split routes by resource, blueprint, or Django app boundary so one module does not own too many endpoints.",
      }));
    }

    return issues;
  },
};

function collectPythonRouteRegistrations(
  file: SourceFileInfo,
  addWarning: (warning: string) => void,
): PythonRouteRegistration[] {
  const moduleInfo = extractPythonModule(file, { addWarning });
  const routes: PythonRouteRegistration[] = [];
  const seen = new Set<string>();
  const routeReceivers = collectFlaskRouteReceivers(file.content);

  for (const fn of moduleInfo.functions) {
    for (const decorator of fn.decorators ?? []) {
      const route = describeRouteDecorator(decorator.text, decorator.line, routeReceivers);
      if (!route) continue;
      addRoute(routes, seen, route);
    }
  }

  for (const route of collectTextDecoratorRoutes(file.content, routeReceivers)) {
    addRoute(routes, seen, route);
  }

  if (hasDjangoUrlEvidence(file.content, moduleInfo.imports)) {
    for (const route of collectDjangoUrlPatterns(file.content)) {
      addRoute(routes, seen, route);
    }
  }

  return routes.sort((left, right) => left.line - right.line || left.path.localeCompare(right.path));
}

function addRoute(
  routes: PythonRouteRegistration[],
  seen: Set<string>,
  route: PythonRouteRegistration,
): void {
  const key = `${route.source}:${route.line}:${route.method}:${route.path}`;
  if (seen.has(key)) return;
  seen.add(key);
  routes.push(route);
}

function collectTextDecoratorRoutes(
  content: string,
  routeReceivers: Set<string>,
): PythonRouteRegistration[] {
  const routes: PythonRouteRegistration[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = (lines[index] ?? "").match(/^\s*@(.+)$/);
    if (!match) continue;
    const route = describeRouteDecorator(match[1] ?? "", index + 1, routeReceivers);
    if (route) routes.push(route);
  }

  return routes;
}

function describeRouteDecorator(
  rawText: string,
  line: number,
  routeReceivers: Set<string>,
): PythonRouteRegistration | undefined {
  const text = rawText.trim().replace(/^@/, "");
  const match = text.match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(([\s\S]*)\)$/);
  if (!match) return undefined;

  const callee = match[1] ?? "";
  if (!isKnownRouteReceiver(callee, routeReceivers)) return undefined;
  const args = match[2] ?? "";
  const methodName = callee.split(".").at(-1)?.toLowerCase() ?? "";
  const path = extractRoutePath(args);
  if (!path) return undefined;

  if (methodName === "route") {
    const configuredMethods = extractConfiguredMethods(args);
    return {
      method: configuredMethods.length ? configuredMethods.join(",") : "ROUTE",
      path,
      line,
      source: "decorator",
    };
  }

  if (!HTTP_ROUTE_METHODS.has(methodName)) return undefined;
  return {
    method: methodName.toUpperCase(),
    path,
    line,
    source: "decorator",
  };
}

function collectFlaskRouteReceivers(content: string): Set<string> {
  const receivers = new Set(["app", "bp", "blueprint"]);
  const hasFlaskImport = /\bfrom\s+flask\s+import\b|\bimport\s+flask\b/.test(content);
  if (!hasFlaskImport && !/\b(?:Blueprint|Flask)\s*\(/.test(content)) return new Set();

  for (const match of content.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*(?:flask\.)?(?:Blueprint|Flask)\s*\(/gm)) {
    const name = match[1];
    if (name) receivers.add(name);
  }

  return receivers;
}

function isKnownRouteReceiver(callee: string, routeReceivers: Set<string>): boolean {
  const parts = callee.split(".");
  if (parts.length < 2) return false;
  return parts.slice(0, -1).some((part) => routeReceivers.has(part));
}

function collectDjangoUrlPatterns(content: string): PythonRouteRegistration[] {
  const routes: PythonRouteRegistration[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^\s*(path|re_path)\s*\(\s*(?:[rubfRUBF]*)?(["'])(.*?)\2/);
    if (!match) continue;
    routes.push({
      method: match[1] === "re_path" ? "DJANGO_RE_PATH" : "DJANGO_PATH",
      path: normalizeDisplayPath(match[3] ?? "<configured route>"),
      line: index + 1,
      source: "django-urlconf",
    });
  }

  return routes;
}

function hasDjangoUrlEvidence(
  content: string,
  imports: Array<{ kind: "import" | "from"; module?: string; names: string[] }>,
): boolean {
  if (/\burlpatterns\s*=/.test(content)) return true;
  return imports.some((entry) =>
    entry.kind === "from"
    && entry.module === "django.urls"
    && entry.names.some((name) => ["path", "re_path"].includes(name.split(/\s+as\s+/)[0] ?? "")));
}

function extractRoutePath(args: string): string | undefined {
  const match = args.match(/\brule\s*=\s*(?:[rubfRUBF]*)?(["'])(\/[^"']*)\1/)
    ?? args.match(/(?:^|[,(]\s*)(?:[rubfRUBF]*)?(["'])(\/[^"']*)\1/);
  return match ? normalizeDisplayPath(match[2] ?? "") : undefined;
}

function extractConfiguredMethods(args: string): string[] {
  const methodsMatch = args.match(/\bmethods\s*=\s*[\[(]([^\])]+)[\])]/);
  if (!methodsMatch) return [];

  return [...(methodsMatch[1] ?? "").matchAll(/["']([A-Za-z]+)["']/g)]
    .map((match) => (match[1] ?? "").toUpperCase())
    .filter(Boolean);
}

function normalizeDisplayPath(path: string): string {
  return path.length > 80 ? `${path.slice(0, 77)}...` : path;
}

function fileLineSpan(file: SourceFileInfo): { startLine: number; endLine: number } {
  return {
    startLine: 1,
    endLine: Math.max(1, file.content.split(/\r?\n/).length),
  };
}
