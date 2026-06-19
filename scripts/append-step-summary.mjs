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
if (previousReportPath) {
  try {
    const parsed = JSON.parse(readFileSync(previousReportPath, "utf8"));
    normalizeComparableScanSnapshot(parsed, { label: "previous" });
    previousResult = parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`DebtLens: previous report ignored (${message}).`);
  }
}
appendFileSync(stepSummaryPath, renderStepSummary(result, { previousResult }));
