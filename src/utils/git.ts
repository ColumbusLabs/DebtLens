import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
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
