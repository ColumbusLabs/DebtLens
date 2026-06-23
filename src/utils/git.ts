import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FileChurnMetric } from "../core/types.js";

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

export function getCurrentGitSha(cwd: string): string | undefined {
  if (!isGitRepo(cwd)) return undefined;
  const sha = gitSafe(cwd, ["rev-parse", "HEAD"]).trim();
  return sha || undefined;
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

export interface FileChurnOptions {
  days?: number;
  range?: string;
  now?: Date;
}

export interface FileChurn {
  root: string;
  window: {
    days?: number;
    since?: string;
    range?: string;
  };
  files: FileChurnMetric[];
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

const scannableRefPattern = /\.(tsx?|jsx?|py|vue|svelte|kt|kts|swift|rb)$/i;

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
 * Collect per-file churn from git history for the requested current file paths.
 * Returns `null` outside a git work tree, ignores files outside the repository,
 * and keeps in-repository files with zero counts so callers can rank a complete
 * file set. Churn is current-path based; pre-rename history is not followed.
 */
export function getFileChurn(cwd: string, files: string[], options: FileChurnOptions = {}): FileChurn | null {
  if (!isGitRepo(cwd)) return null;

  let root: string;
  try {
    root = canonicalize(git(cwd, ["rev-parse", "--show-toplevel"]));
  } catch {
    return null;
  }

  const window = buildChurnWindow(options);
  if (window.range) validateChurnRange(root, window.range);

  const requestedFiles = repositoryFiles(root, cwd, files);
  const stats = new Map<string, { commits: Set<string>; additions: number; deletions: number }>();
  for (const repositoryPath of requestedFiles.keys()) {
    stats.set(repositoryPath, { commits: new Set(), additions: 0, deletions: 0 });
  }

  if (requestedFiles.size > 0 && (window.range || hasGitHistory(root))) {
    const logArgs = [
      "-c",
      "core.quotePath=false",
      "log",
      "--numstat",
      "--format=__DEBTLENS_COMMIT__%H",
    ];
    if (window.range) logArgs.push(window.range);
    if (window.since) logArgs.push(`--since=${window.since}`);
    logArgs.push("--", ...requestedFiles.keys());

    let output = "";
    try {
      output = gitRaw(root, logArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (window.range) {
        throw new Error(`Could not collect git churn for range "${window.range}": ${message}`);
      }
      throw new Error(`Could not collect git churn: ${message}`);
    }

    applyNumstat(output, stats);
  }

  return {
    root,
    window,
    files: [...requestedFiles.keys()].map((repositoryPath) => {
      const fileStats = stats.get(repositoryPath);
      const additions = fileStats?.additions ?? 0;
      const deletions = fileStats?.deletions ?? 0;
      return {
        file: repositoryPath,
        repositoryPath,
        commits: fileStats?.commits.size ?? 0,
        additions,
        deletions,
        changedLines: additions + deletions,
      };
    }),
  };
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

function buildChurnWindow(options: FileChurnOptions): FileChurn["window"] {
  if (options.range !== undefined && options.days !== undefined) {
    throw new Error("Specify either git churn days or git churn range, not both.");
  }

  if (options.range !== undefined) {
    const range = options.range.trim();
    if (!range) throw new Error("Git churn range must not be empty.");
    return { range };
  }

  if (options.days !== undefined) {
    if (!Number.isFinite(options.days) || options.days < 0) {
      throw new Error("Git churn days must be a non-negative finite number.");
    }
    const now = options.now ?? new Date();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) throw new Error("Git churn now must be a valid Date.");
    const since = new Date(nowMs - options.days * 24 * 60 * 60 * 1000).toISOString();
    return { days: options.days, since };
  }

  return {};
}

function validateChurnRange(root: string, range: string): void {
  try {
    gitRaw(root, ["rev-list", "--max-count=1", range, "--"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not resolve git churn range "${range}": ${message}`);
  }
}

function hasGitHistory(root: string): boolean {
  return gitSafe(root, ["rev-parse", "--verify", "HEAD"]) !== "";
}

function repositoryFiles(root: string, cwd: string, files: string[]): Map<string, string> {
  const repositoryFilesByPath = new Map<string, string>();
  for (const file of files) {
    const absolute = canonicalize(resolve(cwd, file));
    const relativePath = relative(root, absolute);
    if (!isInRepository(relativePath)) continue;
    const repositoryPath = relativePath.replaceAll("\\", "/");
    if (!repositoryFilesByPath.has(repositoryPath)) {
      repositoryFilesByPath.set(repositoryPath, repositoryPath);
    }
  }
  return repositoryFilesByPath;
}

function isInRepository(relativePath: string): boolean {
  return relativePath !== ""
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
}

function applyNumstat(
  output: string,
  stats: Map<string, { commits: Set<string>; additions: number; deletions: number }>,
): void {
  let activeCommit: string | undefined;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") continue;

    if (line.startsWith("__DEBTLENS_COMMIT__")) {
      activeCommit = line.slice("__DEBTLENS_COMMIT__".length);
      continue;
    }

    if (!activeCommit) continue;

    const firstTab = line.indexOf("\t");
    const secondTab = firstTab === -1 ? -1 : line.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;

    const additions = parseNumstatCount(line.slice(0, firstTab));
    const deletions = parseNumstatCount(line.slice(firstTab + 1, secondTab));
    if (additions === undefined || deletions === undefined) continue;

    const repositoryPath = line.slice(secondTab + 1);
    const fileStats = stats.get(repositoryPath);
    if (!fileStats) continue;

    fileStats.commits.add(activeCommit);
    fileStats.additions += additions;
    fileStats.deletions += deletions;
  }
}

function parseNumstatCount(value: string): number | undefined {
  if (value === "-") return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Canonical absolute path for stable comparisons across symlinks and platforms. */
export function canonicalizePath(path: string): string {
  return canonicalize(path);
}
