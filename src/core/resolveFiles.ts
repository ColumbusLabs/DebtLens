import { realpathSync, statSync } from "node:fs";
import fg from "fast-glob";
import type { ScanOptions } from "./types.js";
import { getIgnoredFiles } from "../utils/git.js";

export async function resolveFilePaths(options: ScanOptions): Promise<string[]> {
  const stats = statSync(options.target);
  const isFile = stats.isFile();
  const changed = options.changedFiles
    ? new Set(options.changedFiles.map(canonicalize))
    : undefined;

  if (isFile) {
    if (changed && !changed.has(canonicalize(options.target))) return [];
    if (options.respectGitignore && isIgnoredByGit(options.cwd, options.target)) return [];
    return [options.target];
  }

  let paths = await fg(options.include, {
    cwd: options.target,
    absolute: true,
    onlyFiles: true,
    ignore: options.exclude,
    dot: false,
    unique: true,
  });

  if (changed) {
    paths = paths.filter((path) => changed.has(canonicalize(path)));
  }

  if (options.respectGitignore) {
    const ignored = getIgnoredFiles(options.cwd, paths);
    if (ignored !== null) {
      paths = paths.filter((path) => !ignored.has(canonicalize(path)));
    }
  }

  paths.sort((a, b) => a.localeCompare(b));

  return paths.slice(0, options.maxFiles ?? paths.length);
}

function isIgnoredByGit(cwd: string, path: string): boolean {
  const ignored = getIgnoredFiles(cwd, [path]);
  return ignored !== null && ignored.has(canonicalize(path));
}

export function canonicalize(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}
