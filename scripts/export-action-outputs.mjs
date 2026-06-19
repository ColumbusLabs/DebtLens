#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";

const reportPath = process.argv[2];
const outputPath = process.env.GITHUB_OUTPUT;

if (!reportPath || !outputPath) {
  process.exit(0);
}

let result;
try {
  result = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`DebtLens: could not read scan JSON for Action outputs (${message}); emitting fallback outputs.\n`);
}

const byRule = result?.summary?.byRule ?? {};
const topRule = Object.entries(byRule)
  .sort((left, right) => {
    const countDelta = Number(right[1]) - Number(left[1]);
    if (countDelta !== 0) return countDelta;
    return String(left[0]).localeCompare(String(right[0]));
  })[0];
const scanStatus = process.env.DEBTLENS_SCAN_STATUS ?? "0";
const jsonPath = process.env.DEBTLENS_JSON_OUTPUT || process.env.DEBTLENS_JSON_PATH || "";
const artifactName = process.env.DEBTLENS_UPLOAD_JSON_ARTIFACT === "true"
  ? process.env.DEBTLENS_JSON_ARTIFACT_NAME || "debtlens-scan-result"
  : "";

const outputs = {
  "scan-status": scanStatus,
  "gate-status": scanStatus === "0" ? "passed" : "failed",
  "total-issues": String(result?.summary?.totalIssues ?? 0),
  "high-issues": String(result?.summary?.bySeverity?.high ?? 0),
  "medium-issues": String(result?.summary?.bySeverity?.medium ?? 0),
  "low-issues": String(result?.summary?.bySeverity?.low ?? 0),
  "info-issues": String(result?.summary?.bySeverity?.info ?? 0),
  "top-rule": topRule ? String(topRule[0]) : "",
  "top-rule-count": topRule ? String(topRule[1]) : "0",
  "json-path": jsonPath,
  "json-artifact-name": artifactName,
  "report-path": process.env.DEBTLENS_REPORT_OUTPUT || "",
  "report-format": process.env.DEBTLENS_REPORT_FORMAT || "",
};

appendFileSync(outputPath, Object.entries(outputs)
  .map(([name, value]) => `${name}=${sanitizeOutputValue(value)}`)
  .join("\n") + "\n");

function sanitizeOutputValue(value) {
  return String(value).replaceAll("\r", " ").replaceAll("\n", " ");
}
