#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const reportPath = process.argv[2];
if (!reportPath) {
  process.exit(0);
}

const result = JSON.parse(readFileSync(reportPath, "utf8"));
const maxAnnotations = parseMaxAnnotations(process.env.DEBTLENS_ANNOTATIONS_MAX_COUNT);
const issues = Array.isArray(result.issues) ? result.issues : [];
const selected = [...issues].sort(compareIssues).slice(0, maxAnnotations);

for (const issue of selected) {
  const annotationPath = annotationFilePath(issue, result);
  const file = annotationPath ? `file=${escapeProperty(annotationPath)}` : "";
  const line = issue.location?.startLine ? `line=${escapeProperty(String(issue.location.startLine))}` : "";
  const title = `title=${escapeProperty(`DebtLens ${issue.severity ?? "finding"} ${issue.ruleId ?? ""}`.trim())}`;
  const properties = [file, line, title].filter(Boolean).join(",");
  const level = annotationLevel(issue.severity);
  const message = `${issue.message ?? "Maintainability finding"} (${issue.ruleId ?? "unknown-rule"})`;
  console.log(`::${level} ${properties}::${escapeData(message)}`);
}

if (issues.length > selected.length) {
  console.log(`::notice title=${escapeProperty("DebtLens annotations capped")}::${escapeData(`${issues.length - selected.length} finding(s) omitted from workflow annotations. See the DebtLens report artifact for full details.`)}`);
}

function parseMaxAnnotations(value) {
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid annotations max count "${value}". Expected a non-negative integer.`);
  }
  return parsed;
}

function annotationFilePath(issue, result) {
  if (!issue.file) return "";
  const rawFile = String(issue.file);
  if (isAbsolute(rawFile)) {
    const workspacePath = workspaceRoot();
    if (workspacePath && isPathWithin(workspacePath, rawFile)) {
      return normalizeWorkflowPath(relative(workspacePath, rawFile));
    }
    return normalizeWorkflowPath(rawFile);
  }

  const normalizedFile = normalizeWorkflowPath(rawFile);
  const targetPrefix = repoRelativeTargetPrefix(result);
  if (!targetPrefix || pathStartsWith(normalizedFile, targetPrefix)) {
    return normalizedFile;
  }
  return `${targetPrefix}/${normalizedFile.replace(/^\/+/, "")}`;
}

function repoRelativeTargetPrefix(result) {
  const target = typeof result?.options?.target === "string" ? result.options.target : "";
  if (!target || target === ".") return "";

  const workspacePath = workspaceRoot();
  if (workspacePath) {
    const targetPath = isAbsolute(target) ? resolve(target) : resolve(process.cwd(), target);
    if (isPathWithin(workspacePath, targetPath)) {
      const issueRoot = safeIsFile(targetPath) ? dirname(targetPath) : targetPath;
      const targetRelativePath = normalizeWorkflowPath(relative(workspacePath, issueRoot));
      return targetRelativePath === "." ? "" : targetRelativePath.replace(/\/+$/, "");
    }
  }

  if (isAbsolute(target)) return "";
  const normalizedTarget = normalizeWorkflowPath(target).replace(/\/+$/, "");
  return normalizedTarget === "." ? "" : normalizedTarget;
}

function workspaceRoot() {
  return process.env.GITHUB_WORKSPACE ? resolve(process.env.GITHUB_WORKSPACE) : "";
}

function safeIsFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isPathWithin(parent, child) {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function pathStartsWith(filePath, prefix) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function normalizeWorkflowPath(filePath) {
  return String(filePath).replaceAll("\\", "/");
}

function annotationLevel(severity) {
  if (severity === "high") return "error";
  if (severity === "info") return "notice";
  return "warning";
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
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function escapeProperty(value) {
  return escapeData(value)
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}
