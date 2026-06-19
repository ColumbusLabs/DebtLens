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
  sarifCategory: process.env.DEBTLENS_SARIF_CATEGORY || undefined,
  junitFailOn: parseOptionalSeverity(process.env.DEBTLENS_JUNIT_FAIL_ON, "JUnit fail-on"),
  markdownHeatmapLimit: parseOptionalInteger(process.env.DEBTLENS_MARKDOWN_HEATMAP),
  prCommentDeltaOnly: process.env.DEBTLENS_PR_COMMENT_DELTA_ONLY === "true",
  prCommentMaxFindings: parseOptionalInteger(process.env.DEBTLENS_PR_COMMENT_MAX_FINDINGS, { allowZero: true, name: "PR comment max findings" }),
  prCommentMaxBytes: parseOptionalInteger(process.env.DEBTLENS_PR_COMMENT_MAX_BYTES),
  prCommentArtifactLink: process.env.DEBTLENS_PR_COMMENT_FULL_REPORT_URL || undefined,
});

if (outputPath) {
  const target = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, report, "utf8");
} else {
  process.stdout.write(report);
}

function parseOptionalInteger(value, options = {}) {
  if (!value) return undefined;
  const parsed = Number(value);
  const min = options.allowZero === true ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < min) {
    const name = options.name ?? "markdown heatmap limit";
    const expectation = options.allowZero === true ? "a non-negative integer" : "a positive integer";
    throw new Error(`Invalid ${name} "${value}". Expected ${expectation}.`);
  }
  return parsed;
}

function parseFormat(value) {
  const formats = ["terminal", "json", "markdown", "pr-comment", "sarif", "html", "junit", "gitlab-codequality"];
  if (formats.includes(value)) return value;
  throw new Error(`Invalid format "${value}". Expected ${formats.join(", ")}.`);
}

function parseOptionalSeverity(value, name) {
  if (!value) return undefined;
  const severities = ["info", "low", "medium", "high"];
  const normalized = value.toLowerCase();
  if (severities.includes(normalized)) return normalized;
  throw new Error(`Invalid ${name} "${value}". Expected ${severities.join(", ")}.`);
}

function parseGroupBy(value) {
  if (!value) return undefined;
  const groups = ["severity", "rule", "file"];
  if (groups.includes(value)) return value;
  throw new Error(`Invalid group "${value}". Expected ${groups.join(", ")}.`);
}

function getGitHubSourceUrlBase(env) {
  const serverUrl = env.GITHUB_SERVER_URL;
  const source = getGitHubSource(env);
  const repository = source.repository ?? env.GITHUB_REPOSITORY;
  const sha = source.sha ?? env.GITHUB_SHA;
  if (!serverUrl || !repository || !sha) return undefined;
  return `${serverUrl.replace(/\/+$/, "")}/${repository}/blob/${sha}`;
}

function getGitHubSource(env) {
  return readPullRequestHeadSource(env.GITHUB_EVENT_PATH);
}

function readPullRequestHeadSource(eventPath) {
  if (!eventPath) return {};
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    const repository = event.pull_request?.head?.repo?.full_name;
    const sha = event.pull_request?.head?.sha;
    return {
      repository: typeof repository === "string" && repository.length > 0 ? repository : undefined,
      sha: typeof sha === "string" && sha.length > 0 ? sha : undefined,
    };
  } catch {
    return {};
  }
}
