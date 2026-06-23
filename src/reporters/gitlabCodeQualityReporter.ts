import { createHash } from "node:crypto";
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
  const fingerprintCounts = countFingerprints(result.issues);
  const fingerprintOccurrences = new Map<string, number>();
  const issues = result.issues.map((issue) => toGitLabCodeQualityIssue(issue, result, fingerprintCounts, fingerprintOccurrences));
  return `${JSON.stringify(issues, null, 2)}\n`;
}

function toGitLabCodeQualityIssue(
  issue: DebtIssue,
  result: ScanResult,
  fingerprintCounts: ReadonlyMap<string, number>,
  fingerprintOccurrences: Map<string, number>,
): GitLabCodeQualityIssue {
  const path = normalizeReportPath(issue.file, result);
  const line = issue.location?.startLine ?? 1;
  return {
    description: issue.message,
    check_name: issue.ruleId,
    fingerprint: providerFingerprint(issue, path, line, fingerprintCounts, fingerprintOccurrences),
    severity: toGitLabSeverity(issue.severity),
    location: {
      path,
      lines: {
        begin: line,
      },
    },
  };
}

function countFingerprints(issues: DebtIssue[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const fingerprint = issue.fingerprint ?? issue.id;
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  return counts;
}

function providerFingerprint(
  issue: DebtIssue,
  path: string,
  line: number,
  fingerprintCounts: ReadonlyMap<string, number>,
  fingerprintOccurrences: Map<string, number>,
): string {
  const fingerprint = issue.fingerprint ?? issue.id;
  if ((fingerprintCounts.get(fingerprint) ?? 0) <= 1) return fingerprint;

  const occurrence = fingerprintOccurrences.get(fingerprint) ?? 0;
  fingerprintOccurrences.set(fingerprint, occurrence + 1);
  const locationHash = createHash("sha1")
    .update(`${fingerprint}:${path}:${line}:${issue.location?.startColumn ?? 1}:${occurrence}`)
    .digest("hex")
    .slice(0, 12);
  return `${fingerprint}-${locationHash}`;
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
