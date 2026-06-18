import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";

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

function gitRawWithInput(cwd: string, args: string[], input: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "ignore"],
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
    root = canonicalize(git(cwd, ["rev-parse", "--show-toplevel"]));
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
    root = canonicalize(git(cwd, ["rev-parse", "--show-toplevel"]));
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

const scannableRefPattern = /\.(tsx?|jsx?)$/i;

/**
 * Snapshot scannable source files at a git ref for diff-base scanning.
 * Returns `null` outside a git work tree.
 */
export function getRefSnapshot(cwd: string, ref: string): ChangedFiles | null {
  if (!isGitRepo(cwd)) return null;

  let root: string;
  try {
    root = canonicalize(git(cwd, ["rev-parse", "--show-toplevel"]));
    git(cwd, ["rev-parse", "--verify", ref]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not resolve diff base ref "${ref}": ${message}`);
  }

  const output = git(cwd, ["ls-tree", "-r", "--name-only", ref]);
  const relativePaths = output
    .split("\n")
    .map((line) => line.trim())
    .filter((path) => path && scannableRefPattern.test(path));

  const files = relativePaths.map((path) => resolve(root, path));
  const contents = Object.fromEntries(relativePaths.map((path) => {
    const absolutePath = resolve(root, path);
    return [canonicalize(absolutePath), gitRaw(cwd, ["show", `${ref}:${path}`])];
  }));

  return { root, files, contents };
}

/**
 * Return the canonical absolute paths that git ignores. Returns `null` outside a
 * work tree so callers can keep scanning normally when git context is unavailable.
 */
export function getIgnoredFiles(cwd: string, files: string[]): Set<string> | null {
  if (!isGitRepo(cwd)) return null;
  if (files.length === 0) return new Set();

  let root: string;
  try {
    root = canonicalize(git(cwd, ["rev-parse", "--show-toplevel"]));
  } catch {
    return null;
  }

  const canonicalByRelative = new Map<string, string>();
  for (const file of files) {
    const absolute = canonicalize(resolve(file));
    const relativePath = relative(root, absolute).replaceAll("\\", "/");
    if (relativePath && !relativePath.startsWith("..")) {
      canonicalByRelative.set(relativePath, absolute);
    }
  }

  if (canonicalByRelative.size === 0) return new Set();

  let output = "";
  try {
    output = gitRawWithInput(root, ["check-ignore", "--stdin"], `${[...canonicalByRelative.keys()].join("\n")}\n`);
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: number }).status
      : undefined;
    if (status !== 1) return new Set();
  }

  return new Set(
    output
      .split("\n")
      .map((line) => canonicalByRelative.get(line.trim()))
      .filter((path): path is string => Boolean(path)),
  );
}

/**
 * Return the age in whole days of the commit that introduced `line` in `file`.
 * Returns `null` outside git repos and `undefined` when the line cannot be blamed,
 * including uncommitted "Not Committed Yet" blame records.
 */
export function getLineIntroducedDaysAgo(
  cwd: string,
  file: string,
  line: number,
  nowMs = Date.now(),
): number | null | undefined {
  if (!isGitRepo(cwd)) return null;
  if (!Number.isInteger(line) || line < 1) return undefined;

  let root: string;
  let blamePath = file;
  try {
    root = canonicalize(git(cwd, ["rev-parse", "--show-toplevel"]));
    const relativePath = relative(root, canonicalize(resolve(file))).replaceAll("\\", "/");
    if (relativePath && !relativePath.startsWith("..")) {
      blamePath = relativePath;
    }
  } catch {
    return null;
  }

  let output = "";
  try {
    output = gitRaw(root, ["blame", "--line-porcelain", "-L", `${line},${line}`, "--", blamePath]);
  } catch {
    return undefined;
  }

  const firstLine = output.split("\n")[0] ?? "";
  if (/^0{40}\s/.test(firstLine)) return undefined;

  const authorTime = output
    .split("\n")
    .find((entry) => entry.startsWith("author-time "))
    ?.slice("author-time ".length);
  if (!authorTime) return undefined;

  const introducedMs = Number(authorTime) * 1000;
  if (!Number.isFinite(introducedMs)) return undefined;

  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((nowMs - introducedMs) / dayMs));
}

function canonicalize(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** Canonical absolute path for stable comparisons across symlinks and platforms. */
export function canonicalizePath(path: string): string {
  return canonicalize(path);
}
