import { realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import fg from "fast-glob";
import type { ScanOptions } from "./types.js";
import { getIgnoredFiles } from "../utils/git.js";

export interface FileSelection {
  paths: string[];
  totalMatchedFiles: number;
  maxFilesApplied: boolean;
}

export async function resolveFilePaths(options: ScanOptions): Promise<string[]> {
  return (await resolveFileSelection(options)).paths;
}

export async function resolveFileSelection(options: ScanOptions): Promise<FileSelection> {
  const stats = statSync(options.target);
  const isFile = stats.isFile();
  const changed = options.changedFiles
    ? new Set(options.changedFiles.map(canonicalize))
    : undefined;
  const gitignoreCwd = isFile ? dirname(options.target) : options.target;

  if (isFile) {
    if (changed && !changed.has(canonicalize(options.target))) return emptySelection();
    if (options.respectGitignore && isIgnoredByGit(gitignoreCwd, options.target)) return emptySelection();
    return { paths: [options.target], totalMatchedFiles: 1, maxFilesApplied: false };
  }

  let paths = await fg(options.include, {
    cwd: options.target,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: options.exclude,
    dot: false,
    unique: true,
  });
  paths = paths.filter((path) => isPathWithinRoot(path, options.target));

  if (changed) {
    paths = paths.filter((path) => changed.has(canonicalize(path)));
  }

  if (options.respectGitignore) {
    const ignored = getIgnoredFiles(gitignoreCwd, paths);
    if (ignored !== null) {
      paths = paths.filter((path) => !ignored.has(canonicalize(path)));
    }
  }

  paths.sort((a, b) => a.localeCompare(b));

  const totalMatchedFiles = paths.length;
  const limitedPaths = paths.slice(0, options.maxFiles ?? paths.length);

  return {
    paths: limitedPaths,
    totalMatchedFiles,
    maxFilesApplied: limitedPaths.length < totalMatchedFiles,
  };
}

function emptySelection(): FileSelection {
  return { paths: [], totalMatchedFiles: 0, maxFilesApplied: false };
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

function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const file = normalizeForComparison(canonicalize(filePath));
  const root = normalizeForComparison(canonicalize(rootPath));
  if (file === root) return true;
  const rel = relative(root, file).replaceAll("\\", "/");
  return rel.length > 0 && rel !== ".." && !rel.startsWith("../");
}

function normalizeForComparison(path: string): string {
  return resolve(path).replaceAll("\\", "/");
}
