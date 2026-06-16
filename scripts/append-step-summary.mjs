import { appendFileSync, readFileSync } from "node:fs";
import { renderStepSummary } from "../dist/reporters/stepSummaryReporter.js";

const reportPath = process.argv[2];
const previousReportPath = process.argv[3];
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!reportPath || !stepSummaryPath) {
  process.exit(0);
}

const result = JSON.parse(readFileSync(reportPath, "utf8"));
let previousResult;
if (previousReportPath) {
  try {
    const parsed = JSON.parse(readFileSync(previousReportPath, "utf8"));
    if (isScanResultLike(parsed)) {
      previousResult = parsed;
    } else {
      console.log("DebtLens: previous report ignored (expected ScanResult schemaVersion 1 summary shape).");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`DebtLens: previous report ignored (${message}).`);
  }
}
appendFileSync(stepSummaryPath, renderStepSummary(result, { previousResult }));

function isScanResultLike(value) {
  const summary = value?.summary;
  const bySeverity = summary?.bySeverity;
  return value?.schemaVersion === 1 &&
    typeof summary?.totalIssues === "number" &&
    typeof bySeverity?.high === "number" &&
    typeof bySeverity?.medium === "number" &&
    typeof bySeverity?.low === "number" &&
    typeof bySeverity?.info === "number";
}
