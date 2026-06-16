#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderReport } from "../dist/reporters/index.js";

const [reportPath, format = "terminal", outputPath = ""] = process.argv.slice(2);

if (!reportPath) {
  throw new Error("Usage: render-scan-result.mjs <scan-result.json> [format] [output]");
}

const result = JSON.parse(readFileSync(reportPath, "utf8"));
const parsedFormat = parseFormat(format);
const report = renderReport(result, parsedFormat, {
  color: process.stdout.isTTY === true && process.env.NO_COLOR !== "1",
  quiet: process.env.DEBTLENS_QUIET === "true",
  sourceUrlBase: getGitHubSourceUrlBase(process.env),
  groupBy: parseGroupBy(process.env.DEBTLENS_GROUP_BY),
  sarifCompact: process.env.DEBTLENS_SARIF_COMPACT === "true",
  markdownHeatmapLimit: parseOptionalInteger(process.env.DEBTLENS_MARKDOWN_HEATMAP),
  prCommentDeltaOnly: process.env.DEBTLENS_PR_COMMENT_DELTA_ONLY === "true",
});

if (outputPath) {
  const target = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, report, "utf8");
} else {
  process.stdout.write(report);
}

function parseOptionalInteger(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid markdown heatmap limit "${value}". Expected a positive integer.`);
  }
  return parsed;
}

function parseFormat(value) {
  const formats = ["terminal", "json", "markdown", "pr-comment", "sarif", "html", "junit"];
  if (formats.includes(value)) return value;
  throw new Error(`Invalid format "${value}". Expected ${formats.join(", ")}.`);
}

function parseGroupBy(value) {
  if (!value) return undefined;
  const groups = ["severity", "rule", "file"];
  if (groups.includes(value)) return value;
  throw new Error(`Invalid group "${value}". Expected ${groups.join(", ")}.`);
}

function getGitHubSourceUrlBase(env) {
  const serverUrl = env.GITHUB_SERVER_URL;
  const repository = env.GITHUB_REPOSITORY;
  const sha = env.GITHUB_SHA;
  if (!serverUrl || !repository || !sha) return undefined;
  return `${serverUrl.replace(/\/+$/, "")}/${repository}/blob/${sha}`;
}
