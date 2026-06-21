import type { SourceFileInfo } from "../../core/types.js";
import { maskRubyComments } from "../ruby/parse.js";

export interface RailsRoute {
  method: string;
  path: string;
  line: number;
  source: "verb" | "resources" | "resource" | "root" | "match";
}

export interface RailsControllerAction {
  name: string;
  line: number;
  visibility: "public" | "private" | "protected";
}

const HTTP_VERBS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "mount"]);

export function extractRailsRoutes(file: SourceFileInfo): RailsRoute[] {
  if (!isRailsRoutesFile(file.relativePath)) return [];

  const routes: RailsRoute[] = [];
  const seen = new Set<string>();
  const lines = file.content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = maskRubyComments(lines[index] ?? "").trim();
    if (!line || line.startsWith("#")) continue;

    for (const route of describeRailsRouteLine(line, index + 1)) {
      const key = route.source === "verb" || route.source === "root" || route.source === "match"
        ? `${route.source}:${route.line}:${route.method}:${route.path}`
        : `${route.source}:${route.line}:${routes.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(route);
    }
  }

  return routes.sort((left, right) => left.line - right.line || left.path.localeCompare(right.path));
}

export function extractRailsControllerActions(file: SourceFileInfo): RailsControllerAction[] {
  if (!isRailsControllerFile(file.relativePath)) return [];

  const actions: RailsControllerAction[] = [];
  const lines = file.content.split(/\r?\n/);
  let visibility: RailsControllerAction["visibility"] = "public";

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = maskRubyComments(rawLine).trim();
    if (!line) continue;

    const visibilityMatch = line.match(/^(private|protected|public)\b/);
    if (visibilityMatch) {
      visibility = visibilityMatch[1] as RailsControllerAction["visibility"];
      continue;
    }

    const defMatch = line.match(/^def\s+([A-Za-z_]\w*[!?]?)/);
    if (!defMatch) continue;
    const name = defMatch[1] ?? "";
    if (name === "initialize" || name.startsWith("_")) continue;

    actions.push({
      name,
      line: index + 1,
      visibility,
    });
  }

  return actions.filter((action) => action.visibility === "public");
}

function describeRailsRouteLine(line: string, lineNumber: number): RailsRoute[] {
  const routes: RailsRoute[] = [];

  const verbMatch = line.match(/^(get|post|put|patch|delete|head|options|mount)\s+['"]([^'"]+)['"]/i);
  if (verbMatch) {
    routes.push({
      method: (verbMatch[1] ?? "GET").toUpperCase(),
      path: normalizeDisplayPath(verbMatch[2] ?? "<configured route>"),
      line: lineNumber,
      source: "verb",
    });
    return routes;
  }

  const resourcesMatch = line.match(/^resources\s+:(\w+)/);
  if (resourcesMatch) {
    const resource = resourcesMatch[1] ?? "resource";
    const onlyMatch = line.match(/only:\s*\[([^\]]+)\]/);
    const exceptMatch = line.match(/except:\s*\[([^\]]+)\]/);
    const count = estimateResourcesCount(onlyMatch?.[1], exceptMatch?.[1]);
    for (let index = 0; index < count; index += 1) {
      routes.push({
        method: "RESOURCES",
        path: `/${resource}`,
        line: lineNumber,
        source: "resources",
      });
    }
    return routes;
  }

  const resourceMatch = line.match(/^resource\s+:(\w+)/);
  if (resourceMatch) {
    const resource = resourceMatch[1] ?? "resource";
    const count = line.includes("only:") ? estimateResourceOnlyCount(line) : 4;
    for (let index = 0; index < count; index += 1) {
      routes.push({
        method: "RESOURCE",
        path: `/${resource}`,
        line: lineNumber,
        source: "resource",
      });
    }
    return routes;
  }

  if (/^root\s+/.test(line)) {
    routes.push({
      method: "ROOT",
      path: "/",
      line: lineNumber,
      source: "root",
    });
    return routes;
  }

  const matchRoute = line.match(/^match\s+['"]([^'"]+)['"]/);
  if (matchRoute) {
    routes.push({
      method: "MATCH",
      path: normalizeDisplayPath(matchRoute[1] ?? "<configured route>"),
      line: lineNumber,
      source: "match",
    });
  }

  return routes;
}

function estimateResourcesCount(only?: string, except?: string): number {
  const defaultActions = ["index", "show", "new", "create", "edit", "update", "destroy"];
  if (only) {
    const selected = [...only.matchAll(/:(\w+)/g)].map((match) => match[1] ?? "");
    return selected.length || 7;
  }
  if (except) {
    const excluded = new Set([...except.matchAll(/:(\w+)/g)].map((match) => match[1] ?? ""));
    return defaultActions.filter((action) => !excluded.has(action)).length;
  }
  return 7;
}

function estimateResourceOnlyCount(line: string): number {
  const onlyMatch = line.match(/only:\s*\[([^\]]+)\]/);
  if (!onlyMatch) return 4;
  return [...(onlyMatch[1] ?? "").matchAll(/:(\w+)/g)].length || 4;
}

function isRailsRoutesFile(relativePath: string): boolean {
  return /(?:^|\/)routes\.rb$/i.test(relativePath.replace(/\\/g, "/"));
}

function isRailsControllerFile(relativePath: string): boolean {
  return /_controller\.rb$/i.test(relativePath.replace(/\\/g, "/"));
}

function normalizeDisplayPath(path: string): string {
  return path.length > 80 ? `${path.slice(0, 77)}...` : path;
}

export function isRailsRouteEvidence(content: string): boolean {
  return /\bRails\.application\.routes\.draw\b/.test(content)
    || HTTP_VERBS.has("get") && /\b(get|post|put|patch|delete|resources|resource|root|match)\b/.test(content);
}
