import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

function git(cwd: string, args: string[]): string {
  return gitRaw(cwd, args).trim();
}

function gitRaw(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function gitSafe(cwd: string, args: string[]): string {
  try {
    return git(cwd, args);
  } catch {
    return "";
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    return git(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
  } catch {
    return false;
  }
}

export interface ChangedFiles {
  root: string;
  files: string[];
  contents?: Record<string, string>;
}

/**
 * Collect changed files as absolute paths. Returns `null` when `cwd` is not inside a
 * git work tree, so the caller can degrade gracefully.
 *
 * - With `base`, includes the committed diff `base...HEAD` (merge-base — the PR's own
 *   changes). An unknown `base` throws a clear error.
 * - Always unions in uncommitted working-tree changes vs HEAD and untracked files.
 * - Deletions are excluded (`--diff-filter=d`) since deleted files cannot be scanned.
 */
export function getChangedFiles(cwd: string, base?: string): ChangedFiles | null {
  if (!isGitRepo(cwd)) return null;

  let root: string;
  try {
    root = git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    return null;
  }

  const relative = new Set<string>();
  const add = (output: string) => {
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) relative.add(trimmed);
    }
  };

  if (base) {
    try {
      add(git(cwd, ["diff", "--name-only", "--diff-filter=d", `${base}...HEAD`]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not diff against base ref "${base}": ${message}`);
    }
  }

  // Uncommitted changes vs HEAD (staged + unstaged) and untracked files. Best-effort:
  // a brand-new repo with no commits has no HEAD, which is fine.
  add(gitSafe(cwd, ["diff", "--name-only", "--diff-filter=d", "HEAD"]));
  add(gitSafe(cwd, ["ls-files", "--others", "--exclude-standard"]));

  return { root, files: [...relative].map((path) => resolve(root, path)) };
}

/**
 * Collect staged files as absolute paths for pre-commit scans. Returns `null` when
 * `cwd` is not inside a git work tree, matching `getChangedFiles` graceful behavior.
 */
export function getStagedFiles(cwd: string): ChangedFiles | null {
  if (!isGitRepo(cwd)) return null;

  let root: string;
  try {
    root = git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    return null;
  }

  const output = git(cwd, ["diff", "--cached", "--name-only", "--diff-filter=d"]);
  const relativePaths = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const files = relativePaths.map((path) => resolve(root, path));
  const contents = Object.fromEntries(relativePaths.map((path) => {
    const absolutePath = resolve(root, path);
    return [canonicalize(absolutePath), gitRaw(cwd, ["show", `:${path}`])];
  }));

  return { root, files, contents };
}

function canonicalize(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}
