import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { DebtIssue, ScanResult, Severity } from "../core/types.js";

type GitLabCodeQualitySeverity = "info" | "minor" | "major" | "critical" | "blocker";

interface GitLabCodeQualityIssue {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: GitLabCodeQualitySeverity;
  location: {
    path: string;
    lines: {
      begin: number;
    };
  };
}

export function renderGitLabCodeQuality(result: ScanResult): string {
  const issues = result.issues.map((issue) => toGitLabCodeQualityIssue(issue, result));
  return `${JSON.stringify(issues, null, 2)}\n`;
}

function toGitLabCodeQualityIssue(issue: DebtIssue, result: ScanResult): GitLabCodeQualityIssue {
  return {
    description: issue.message,
    check_name: issue.ruleId,
    fingerprint: issue.fingerprint ?? issue.id,
    severity: toGitLabSeverity(issue.severity),
    location: {
      path: normalizeReportPath(issue.file, result),
      lines: {
        begin: issue.location?.startLine ?? 1,
      },
    },
  };
}

function toGitLabSeverity(severity: Severity): GitLabCodeQualitySeverity {
  if (severity === "high") return "critical";
  if (severity === "medium") return "major";
  if (severity === "low") return "minor";
  return "info";
}

function normalizeReportPath(file: string, result: ScanResult): string {
  const repoRoot = repoRootForTarget(result.options.target);
  const normalizedFile = file.replaceAll("\\", "/").replace(/^\.\//, "");
  if (isAbsolute(normalizedFile)) {
    const relativePath = relative(repoRoot, normalizedFile).replaceAll("\\", "/");
    return relativePath && !relativePath.startsWith("..") ? relativePath : normalizedFile;
  }

  const targetPrefix = repoRelativeTargetPrefix(result.options.target, repoRoot);
  if (!targetPrefix || pathStartsWith(normalizedFile, targetPrefix)) {
    return normalizedFile;
  }
  return `${targetPrefix}/${normalizedFile.replace(/^\/+/, "")}`;
}

function repoRelativeTargetPrefix(target: string, repoRoot: string): string {
  if (!target || target === ".") return "";
  const targetPath = isAbsolute(target) ? target : resolve(repoRoot, target);
  const issueRoot = safeIsFile(targetPath) ? dirname(targetPath) : targetPath;
  const relativePath = relative(repoRoot, issueRoot).replaceAll("\\", "/");
  if (!relativePath || relativePath === "." || relativePath.startsWith("..") || isAbsolute(relativePath)) return "";
  return relativePath.replace(/\/+$/, "");
}

function repoRootForTarget(target: string): string {
  const targetPath = isAbsolute(target) ? target : resolve(process.cwd(), target || ".");
  const start = safeIsFile(targetPath) ? dirname(targetPath) : targetPath;
  for (let current = start; ; current = dirname(current)) {
    if (existsSync(resolve(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return process.cwd();
  }
}

function safeIsFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function pathStartsWith(filePath: string, prefix: string): boolean {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}
