#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  compareIssues,
  parseAnnotationLimit,
  repoRelativeIssuePath,
  severityRank,
} from "./lib/report-utils.mjs";

const reportPath = process.argv[2];
if (!reportPath) {
  process.exit(0);
}

const result = JSON.parse(readFileSync(reportPath, "utf8"));
const issues = Array.isArray(result.issues) ? result.issues : [];
const maxIssues = parseAnnotationLimit(process.env.DEBTLENS_AZURE_MAX_COUNT, {
  defaultValue: 50,
  name: "Azure max count",
});
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
  const normalized = repoRelativeIssuePath(file, result);
  if (isAbsolute(normalized) || !process.env.BUILD_SOURCESDIRECTORY) return normalized;
  return resolve(process.env.BUILD_SOURCESDIRECTORY, normalized).replaceAll("\\", "/");
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
