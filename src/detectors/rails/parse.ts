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
const RESOURCE_ACTIONS = ["index", "show", "new", "create", "edit", "update", "destroy"];
const SINGULAR_RESOURCE_ACTIONS = ["show", "new", "create", "edit"];

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
    const count = estimateRouteActionCount(line, "resources");
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
    const count = estimateRouteActionCount(line, "resource");
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

function estimateRouteActionCount(line: string, source: "resources" | "resource"): number {
  const defaultActions = source === "resources" ? RESOURCE_ACTIONS : SINGULAR_RESOURCE_ACTIONS;
  const only = extractRailsActionOption(line, "only");
  if (only) return only.length || defaultActions.length;

  const except = extractRailsActionOption(line, "except");
  if (except) {
    const excluded = new Set(except);
    return defaultActions.filter((action) => !excluded.has(action)).length;
  }

  return defaultActions.length;
}

function extractRailsActionOption(line: string, option: "only" | "except"): string[] | undefined {
  const optionIndex = line.search(new RegExp(`\\b${option}:`));
  if (optionIndex === -1) return undefined;
  const rawOption = line.slice(optionIndex + option.length + 1).trimStart();
  const raw = readRailsActionList(rawOption);
  if (!raw) return undefined;
  if (raw.startsWith("%")) {
    return parseActionWords(raw.slice(3, -1));
  }
  if (raw.startsWith("[")) {
    return [...raw.matchAll(/:(\w+)|["'](\w+)["']/g)]
      .map((match) => match[1] ?? match[2] ?? "")
      .filter(Boolean);
  }
  return [raw.replace(/^:/, "").replace(/^["']|["']$/g, "")].filter(Boolean);
}

function readRailsActionList(raw: string): string | undefined {
  const percentArray = raw.match(/^%[iI]([\[(])/);
  if (percentArray) {
    const open = percentArray[1] ?? "[";
    const close = open === "[" ? "]" : ")";
    const endIndex = raw.indexOf(close, 3);
    return endIndex === -1 ? undefined : raw.slice(0, endIndex + 1);
  }

  if (raw.startsWith("[")) {
    const endIndex = raw.indexOf("]");
    return endIndex === -1 ? undefined : raw.slice(0, endIndex + 1);
  }

  return raw.match(/^(:\w+|"[^"]+"|'[^']+')/)?.[1];
}

function parseActionWords(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((action) => action.replace(/^:/, "").trim())
    .filter(Boolean);
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
