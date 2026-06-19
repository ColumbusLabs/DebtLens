import { appendFileSync, readFileSync } from "node:fs";
import { normalizeComparableScanSnapshot } from "../dist/core/scanComparison.js";
import { renderStepSummary } from "../dist/reporters/stepSummaryReporter.js";

const reportPath = process.argv[2];
const previousReportPath = process.argv[3];
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!reportPath || !stepSummaryPath) {
  process.exit(0);
}

const result = JSON.parse(readFileSync(reportPath, "utf8"));
let previousResult;
let previousReportWarning;
if (previousReportPath) {
  try {
    const parsed = JSON.parse(readFileSync(previousReportPath, "utf8"));
    normalizeComparableScanSnapshot(parsed, { label: "previous" });
    previousResult = parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    previousReportWarning = `Previous report ignored: ${message}`;
    console.log(`DebtLens: ${previousReportWarning}.`);
  }
}
appendFileSync(stepSummaryPath, renderStepSummary(result, {
  previousResult,
  previousReportWarning,
  gate: {
    scanStatus: Number(process.env.DEBTLENS_SCAN_STATUS ?? 0),
    failOn: process.env.DEBTLENS_FAIL_ON || undefined,
    failOnConfidence: parseOptionalConfidence(process.env.DEBTLENS_FAIL_ON_CONFIDENCE),
    failOnRegression: process.env.DEBTLENS_FAIL_ON_REGRESSION === "true",
  },
  reports: {
    format: process.env.DEBTLENS_REPORT_FORMAT || undefined,
    reportPath: process.env.DEBTLENS_REPORT_OUTPUT || undefined,
    jsonPath: process.env.DEBTLENS_JSON_OUTPUT || process.env.DEBTLENS_JSON_PATH || undefined,
    jsonArtifactName: process.env.DEBTLENS_UPLOAD_JSON_ARTIFACT === "true"
      ? process.env.DEBTLENS_JSON_ARTIFACT_NAME || "debtlens-scan-result"
      : undefined,
  },
}));

function parseOptionalConfidence(value) {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return undefined;
  return parsed;
}
