#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  compareIssues,
  parseAnnotationLimit,
  pathStartsWith,
} from "./lib/report-utils.mjs";

const reportPath = process.argv[2];
if (!reportPath) {
  process.exit(0);
}

const result = JSON.parse(readFileSync(reportPath, "utf8"));
const maxAnnotations = parseAnnotationLimit(process.env.DEBTLENS_ANNOTATIONS_MAX_COUNT, {
  defaultValue: 50,
  name: "annotations max count",
});
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
  const workspacePath = workspaceRoot();
  if (workspacePath) {
    const targetPath = isAbsolute(target) ? resolve(target) : resolve(process.cwd(), target || ".");
    if (isPathWithin(workspacePath, targetPath)) {
      const issueRoot = safeIsFile(targetPath) ? dirname(targetPath) : targetPath;
      const targetRelativePath = normalizeWorkflowPath(relative(workspacePath, issueRoot));
      return targetRelativePath === "." ? "" : targetRelativePath.replace(/\/+$/, "");
    }
  }

  if (!target || target === ".") return "";
  if (isAbsolute(target)) return "";
  const normalizedTarget = normalizeWorkflowPath(target).replace(/\/+$/, "");
  return normalizedTarget === "." ? "" : normalizedTarget;
}

function workspaceRoot() {
  return process.env.GITHUB_WORKSPACE ? canonicalPath(process.env.GITHUB_WORKSPACE) : "";
}

function safeIsFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isPathWithin(parent, child) {
  const relativePath = relative(canonicalPath(parent), canonicalPath(child));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function canonicalPath(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

function normalizeWorkflowPath(filePath) {
  return String(filePath).replaceAll("\\", "/");
}

function annotationLevel(severity) {
  if (severity === "high") return "error";
  if (severity === "info") return "notice";
  return "warning";
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
