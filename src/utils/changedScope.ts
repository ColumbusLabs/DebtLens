import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ScanOptions, SourceFileInfo } from "../core/types.js";

export interface ChangedPathScope {
  paths: ReadonlySet<string>;
}

export function buildChangedPathScope(options: Pick<ScanOptions, "changedFiles" | "target">): ChangedPathScope | undefined {
  if (options.changedFiles === undefined) return undefined;

  const paths = new Set<string>();
  for (const path of options.changedFiles) {
    addPathVariants(paths, path, options.target);
  }

  return { paths };
}

export function isSourceFileChanged(scope: ChangedPathScope | undefined, file: SourceFileInfo): boolean {
  return isChangedPath(scope, file.relativePath, file.absolutePath);
}

export function isChangedPath(scope: ChangedPathScope | undefined, relativePath: string, absolutePath?: string): boolean {
  if (!scope) return false;
  if (scope.paths.has(normalizePath(relativePath))) return true;
  return absolutePath !== undefined && scope.paths.has(normalizePath(absolutePath));
}

function addPathVariants(paths: Set<string>, path: string, target: string): void {
  paths.add(normalizePath(path));
  if (!isAbsolute(path)) {
    paths.add(normalizePath(resolve(target, path)));
  }
}

function normalizePath(path: string): string {
  try {
    return realpathSync.native(path).replaceAll("\\", "/");
  } catch {
    return path.replaceAll("\\", "/");
  }
}
