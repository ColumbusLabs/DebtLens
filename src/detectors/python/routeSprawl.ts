import type { DebtIssue, Detector, DetectorContext, SourceFileInfo } from "../../core/types.js";
import { createIssue } from "../../utils/createIssue.js";
import { extractPythonModule } from "./parse.js";

const HTTP_ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const MAX_DJANGO_URL_CALL_LINES = 20;

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
  const ignoredTextLines = collectPythonMultilineStringLines(file.content);

  for (const fn of moduleInfo.functions) {
    for (const decorator of fn.decorators ?? []) {
      const route = describeRouteDecorator(decorator.text, decorator.line, routeReceivers);
      if (!route) continue;
      addRoute(routes, seen, route);
    }
  }

  if (!moduleInfo.usedAstSidecar) {
    for (const route of collectTextDecoratorRoutes(file.content, routeReceivers, ignoredTextLines)) {
      addRoute(routes, seen, route);
    }
  }

  if (hasDjangoUrlEvidence(file.content, moduleInfo.imports)) {
    for (const route of collectDjangoUrlPatterns(file.content, ignoredTextLines)) {
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
  ignoredLines: Set<number>,
): PythonRouteRegistration[] {
  const routes: PythonRouteRegistration[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (ignoredLines.has(index + 1)) continue;
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

function collectDjangoUrlPatterns(content: string, ignoredLines: Set<number>): PythonRouteRegistration[] {
  const routes: PythonRouteRegistration[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (ignoredLines.has(index + 1)) continue;
    const route = describeDjangoUrlCall(lines, index, ignoredLines);
    if (route) routes.push(route);
  }

  return routes;
}

function describeDjangoUrlCall(
  lines: string[],
  startIndex: number,
  ignoredLines: Set<number>,
): PythonRouteRegistration | undefined {
  const startLine = lines[startIndex] ?? "";
  const startMatch = startLine.match(/^\s*(path|re_path)\s*\(/);
  if (!startMatch) return undefined;

  const endIndex = Math.min(lines.length, startIndex + MAX_DJANGO_URL_CALL_LINES);
  const chunkLines: string[] = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    if (ignoredLines.has(index + 1)) break;
    if (index > startIndex && /^\s*(path|re_path)\s*\(/.test(lines[index] ?? "")) break;
    chunkLines.push(lines[index] ?? "");

    const match = chunkLines.join("\n").match(/^\s*(path|re_path)\s*\(\s*(?:[rubfRUBF]*)?(["'])([^"']*)\2/);
    if (!match) continue;
    return {
      method: match[1] === "re_path" ? "DJANGO_RE_PATH" : "DJANGO_PATH",
      path: normalizeDisplayPath(match[3] ?? "<configured route>"),
      line: startIndex + 1,
      source: "django-urlconf",
    };
  }

  return undefined;
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

function collectPythonMultilineStringLines(content: string): Set<number> {
  const lines = new Set<number>();
  let delimiter: "\"\"\"" | "'''" | undefined;
  let line = 1;
  let index = 0;

  while (index < content.length) {
    const char = content[index] ?? "";

    if (delimiter) {
      lines.add(line);
      if (content.startsWith(delimiter, index)) {
        index += delimiter.length;
        delimiter = undefined;
        continue;
      }
      if (char === "\n") {
        line += 1;
      }
      index += 1;
      continue;
    }

    if (char === "#") {
      index = skipPythonComment(content, index);
      continue;
    }

    if (content.startsWith('"""', index) || content.startsWith("'''", index)) {
      delimiter = content.slice(index, index + 3) as "\"\"\"" | "'''";
      lines.add(line);
      index += delimiter.length;
      continue;
    }

    if (char === "\"" || char === "'") {
      index = skipPythonShortString(content, index, char);
      continue;
    }

    if (char === "\n") {
      line += 1;
    }
    index += 1;
  }

  return lines;
}

function skipPythonComment(content: string, startIndex: number): number {
  let index = startIndex;
  while (index < content.length && content[index] !== "\n") {
    index += 1;
  }
  return index;
}

function skipPythonShortString(content: string, startIndex: number, quote: "\"" | "'"): number {
  let index = startIndex + 1;
  while (index < content.length) {
    const char = content[index] ?? "";
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) {
      return index + 1;
    }
    if (char === "\n") {
      return index;
    }
    index += 1;
  }
  return index;
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
