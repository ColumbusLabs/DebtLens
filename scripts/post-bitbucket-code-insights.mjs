#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const reportPath = process.argv[2];
const authHeader = authorizationHeader();
const workspace = process.env.BITBUCKET_WORKSPACE;
const repoSlug = process.env.BITBUCKET_REPO_SLUG;
const commit = process.env.BITBUCKET_COMMIT;
const reportId = process.env.DEBTLENS_BITBUCKET_REPORT_ID || "debtlens";
const apiBase = process.env.BITBUCKET_API_URL || "https://api.bitbucket.org/2.0";
const failOnError = process.env.DEBTLENS_BITBUCKET_FAIL_ON_ERROR === "true";

if (!reportPath || !authHeader || !workspace || !repoSlug || !commit) {
  console.log("DebtLens: skipping Bitbucket Code Insights (missing report path, credentials, workspace, repository slug, or commit).");
  process.exit(0);
}

const result = JSON.parse(readFileSync(reportPath, "utf8"));
const issues = Array.isArray(result.issues) ? result.issues : [];
const maxAnnotations = parseMaxAnnotations(process.env.DEBTLENS_BITBUCKET_ANNOTATIONS_MAX_COUNT);
const selected = [...issues].sort(compareIssues).slice(0, maxAnnotations);
const headers = {
  Authorization: authHeader,
  Accept: "application/json",
  "Content-Type": "application/json",
};

try {
  await putReport();
  if (selected.length > 0) {
    await postAnnotations(selected);
  }
  const annotationSuffix = selected.length === issues.length
    ? ""
    : ` (${issues.length - selected.length} finding(s) omitted by annotation cap)`;
  console.log(`DebtLens: posted Bitbucket Code Insights report with ${selected.length} annotation(s)${annotationSuffix}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (failOnError) {
    throw error;
  }
  console.warn(`DebtLens warning: ${message}. Bitbucket Code Insights were not posted. Set DEBTLENS_BITBUCKET_FAIL_ON_ERROR=true to fail on posting errors.`);
}

async function putReport() {
  const response = await fetch(reportUrl(), {
    method: "PUT",
    headers,
    body: JSON.stringify({
      title: "DebtLens maintainability report",
      details: reportDetails(),
      report_type: "BUG",
      reporter: "DebtLens",
      result: issues.length > 0 ? "FAILED" : "PASSED",
      ...(process.env.DEBTLENS_BITBUCKET_REPORT_LINK ? { link: process.env.DEBTLENS_BITBUCKET_REPORT_LINK } : {}),
      data: [
        { title: "Total findings", type: "NUMBER", value: numberSummary("totalIssues") },
        { title: "High findings", type: "NUMBER", value: numberSeverity("high") },
        { title: "Medium findings", type: "NUMBER", value: numberSeverity("medium") },
        { title: "Low findings", type: "NUMBER", value: numberSeverity("low") },
        { title: "Info findings", type: "NUMBER", value: numberSeverity("info") },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create Bitbucket report: ${response.status}`);
  }
}

async function postAnnotations(annotations) {
  for (const chunk of chunks(annotations.map(toAnnotation), 100)) {
    const response = await fetch(`${reportUrl()}/annotations`, {
      method: "POST",
      headers,
      body: JSON.stringify(chunk),
    });
    if (!response.ok) {
      throw new Error(`Failed to create Bitbucket annotations: ${response.status}`);
    }
  }
}

function reportUrl() {
  return `${apiBase.replace(/\/+$/, "")}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/commit/${encodeURIComponent(commit)}/reports/${encodeURIComponent(reportId)}`;
}

function reportDetails() {
  const total = numberSummary("totalIssues");
  const high = numberSeverity("high");
  const medium = numberSeverity("medium");
  const low = numberSeverity("low");
  const info = numberSeverity("info");
  return `DebtLens found ${total} maintainability finding(s): ${high} high, ${medium} medium, ${low} low, ${info} info.`;
}

function toAnnotation(issue) {
  return {
    external_id: stableAnnotationId(issue),
    title: `${issue.ruleId ?? "debtlens"}: ${issue.severity ?? "finding"}`,
    annotation_type: "CODE_SMELL",
    result: "FAILED",
    summary: String(issue.message ?? "Maintainability finding").slice(0, 450),
    details: annotationDetails(issue),
    severity: bitbucketSeverity(issue.severity),
    ...(issue.file ? { path: normalizePath(issue.file, result) } : {}),
    ...(issue.location?.startLine ? { line: issue.location.startLine } : {}),
  };
}

function annotationDetails(issue) {
  const lines = [
    `Rule: ${issue.ruleId ?? "unknown-rule"}`,
    `Severity: ${issue.severity ?? "unknown"}`,
    `Confidence: ${Number(issue.confidence ?? 0).toFixed(2)}`,
  ];
  if (issue.suggestion) lines.push(`Suggestion: ${issue.suggestion}`);
  if (Array.isArray(issue.evidence) && issue.evidence.length > 0) {
    lines.push(`Evidence: ${issue.evidence.join("; ")}`);
  }
  return lines.join("\n");
}

function stableAnnotationId(issue) {
  const seed = String(issue.fingerprint ?? issue.id ?? `${issue.ruleId}:${issue.file}:${issue.location?.startLine ?? 1}`);
  return `debtlens-${createHash("sha1").update(seed).digest("hex").slice(0, 24)}`;
}

function bitbucketSeverity(severity) {
  if (severity === "high") return "HIGH";
  if (severity === "medium") return "MEDIUM";
  if (severity === "low" || severity === "info") return "LOW";
  return "LOW";
}

function authorizationHeader() {
  if (process.env.DEBTLENS_BITBUCKET_AUTH_HEADER) return process.env.DEBTLENS_BITBUCKET_AUTH_HEADER;

  const token = process.env.BITBUCKET_STEP_OAUTH_TOKEN
    || process.env.BITBUCKET_TOKEN
    || process.env.BB_TOKEN;
  if (token) return `Bearer ${token}`;

  const username = process.env.BITBUCKET_USERNAME;
  const password = process.env.BITBUCKET_API_TOKEN
    || process.env.BITBUCKET_APP_PASSWORD
    || process.env.BITBUCKET_PASSWORD;
  if (username && password) {
    return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
  }

  return "";
}

function normalizePath(file, scanResult) {
  const repoRoot = repoRootForTarget(scanResult.options?.target);
  const normalizedFile = String(file).replaceAll("\\", "/").replace(/^\.\//, "");
  if (isAbsolute(normalizedFile)) {
    const relativePath = relative(repoRoot, normalizedFile).replaceAll("\\", "/");
    return relativePath && !relativePath.startsWith("..") ? relativePath : normalizedFile;
  }

  const targetPrefix = repoRelativeTargetPrefix(scanResult.options?.target, repoRoot);
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
  const cloneRoot = process.env.BITBUCKET_CLONE_DIR ? resolve(process.env.BITBUCKET_CLONE_DIR) : "";
  const rawTarget = typeof target === "string" ? target : "";
  const targetPath = isAbsolute(rawTarget) ? rawTarget : resolve(process.cwd(), rawTarget || ".");
  if (cloneRoot && pathStartsWithin(cloneRoot, targetPath)) return cloneRoot;

  const start = safeIsFile(targetPath) ? dirname(targetPath) : targetPath;
  for (let current = start; ; current = dirname(current)) {
    if (existsSync(resolve(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return cloneRoot || process.cwd();
  }
}

function safeIsFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function pathStartsWithin(parent, child) {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function pathStartsWith(filePath, prefix) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function numberSummary(key) {
  return Number(result.summary?.[key] ?? issues.length ?? 0);
}

function numberSeverity(severity) {
  return Number(result.summary?.bySeverity?.[severity] ?? 0);
}

function parseMaxAnnotations(value) {
  if (!value) return 100;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000) {
    throw new Error(`Invalid Bitbucket annotation max count "${value}". Expected an integer from 0 to 1000.`);
  }
  return parsed;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
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
