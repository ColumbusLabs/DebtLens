#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const reportPath = process.argv[2];
if (!reportPath) {
  process.exit(0);
}

const result = JSON.parse(readFileSync(reportPath, "utf8"));
const issues = Array.isArray(result.issues) ? result.issues : [];
const maxIssues = parseMaxIssues(process.env.DEBTLENS_AZURE_MAX_COUNT);
const errorOn = parseSeverity(process.env.DEBTLENS_AZURE_ERROR_ON || "high", "Azure error-on");
const selected = [...issues].sort(compareIssues).slice(0, maxIssues);

for (const issue of selected) {
  const properties = [
    `type=${azureIssueType(issue.severity, errorOn)}`,
    issue.file ? `sourcepath=${escapeProperty(sourcePath(issue.file))}` : "",
    issue.location?.startLine ? `linenumber=${escapeProperty(String(issue.location.startLine))}` : "",
    issue.location?.startColumn ? `columnnumber=${escapeProperty(String(issue.location.startColumn))}` : "",
    issue.ruleId ? `code=${escapeProperty(String(issue.ruleId))}` : "",
  ].filter(Boolean).join(";");
  const message = `${issue.message ?? "Maintainability finding"} (${issue.ruleId ?? "unknown-rule"})`;
  console.log(`##vso[task.logissue ${properties};]${escapeData(message)}`);
}

if (issues.length > selected.length) {
  console.log(`##[warning]DebtLens Azure annotations capped: ${issues.length - selected.length} finding(s) omitted. See the DebtLens report artifact for full details.`);
}

function parseMaxIssues(value) {
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid Azure max count "${value}". Expected a non-negative integer.`);
  }
  return parsed;
}

function parseSeverity(value, name) {
  const normalized = String(value).toLowerCase();
  const severities = ["info", "low", "medium", "high"];
  if (severities.includes(normalized)) return normalized;
  throw new Error(`Invalid ${name} "${value}". Expected ${severities.join(", ")}.`);
}

function azureIssueType(severity, errorOn) {
  return severityRank(severity) >= severityRank(errorOn) ? "error" : "warning";
}

function sourcePath(file) {
  const normalized = repoRelativeIssuePath(file);
  if (isAbsolute(normalized) || !process.env.BUILD_SOURCESDIRECTORY) return normalized;
  return resolve(process.env.BUILD_SOURCESDIRECTORY, normalized).replaceAll("\\", "/");
}

function repoRelativeIssuePath(file) {
  const repoRoot = repoRootForTarget(result.options?.target);
  const normalizedFile = String(file).replaceAll("\\", "/").replace(/^\.\//, "");
  if (isAbsolute(normalizedFile)) {
    const relativePath = relative(repoRoot, normalizedFile).replaceAll("\\", "/");
    return relativePath && !relativePath.startsWith("..") ? relativePath : normalizedFile;
  }

  const targetPrefix = repoRelativeTargetPrefix(result.options?.target, repoRoot);
  if (!targetPrefix || pathStartsWith(normalizedFile, targetPrefix)) {
    return normalizedFile;
  }
  return `${targetPrefix}/${normalizedFile.replace(/^\/+/, "")}`;
}

function repoRelativeTargetPrefix(target, repoRoot) {
  if (!target || target === ".") return "";
  const targetPath = isAbsolute(target) ? target : resolve(repoRoot, target);
  const issueRoot = safeIsFile(targetPath) ? dirname(targetPath) : targetPath;
  const relativePath = relative(repoRoot, issueRoot).replaceAll("\\", "/");
  if (!relativePath || relativePath === "." || relativePath.startsWith("..") || isAbsolute(relativePath)) return "";
  return relativePath.replace(/\/+$/, "");
}

function repoRootForTarget(target) {
  const rawTarget = typeof target === "string" ? target : "";
  const targetPath = isAbsolute(rawTarget) ? rawTarget : resolve(process.cwd(), rawTarget || ".");
  const start = safeIsFile(targetPath) ? dirname(targetPath) : targetPath;
  for (let current = start; ; current = dirname(current)) {
    if (existsSync(resolve(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return process.cwd();
  }
}

function safeIsFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function pathStartsWith(filePath, prefix) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function compareIssues(left, right) {
  const severityDelta = severityRank(right.severity) - severityRank(left.severity);
  if (severityDelta !== 0) return severityDelta;
  const confidenceDelta = Number(right.confidence ?? 0) - Number(left.confidence ?? 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  const fileDelta = String(left.file ?? "").localeCompare(String(right.file ?? ""));
  if (fileDelta !== 0) return fileDelta;
  return Number(left.location?.startLine ?? 0) - Number(right.location?.startLine ?? 0);
}

function severityRank(severity) {
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  return 1;
}

function escapeData(value) {
  return String(value)
    .replaceAll("%", "%AZP25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll("]", "%5D");
}

function escapeProperty(value) {
  return escapeData(value)
    .replaceAll(";", "%3B");
}
