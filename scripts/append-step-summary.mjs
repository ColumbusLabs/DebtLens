import { appendFileSync, readFileSync } from "node:fs";
import { renderStepSummary } from "../dist/reporters/stepSummaryReporter.js";

const reportPath = process.argv[2];
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!reportPath || !stepSummaryPath) {
  process.exit(0);
}

const result = JSON.parse(readFileSync(reportPath, "utf8"));
appendFileSync(stepSummaryPath, renderStepSummary(result));
