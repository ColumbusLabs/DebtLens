import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { IncomingHttpHeaders } from "node:http";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(repoRoot, "scripts", "post-bitbucket-code-insights.mjs");

interface RequestRecord {
  method: string;
  pathname: string;
  headers: IncomingHttpHeaders;
  body: string;
}

interface ScriptResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

describe("post-bitbucket-code-insights script", () => {
  it("creates a Code Insights report and capped annotations", async () => {
    const requests: RequestRecord[] = [];
    const result = await withMockBitbucket(requests, async (apiUrl) => runPostCodeInsights(apiUrl), (_request, response) => {
      return json(response, { ok: true });
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /posted Bitbucket Code Insights report with 2 annotation\(s\)/);
    assert.match(result.stdout, /1 finding\(s\) omitted/);

    const putReport = requests.find((request) => request.method === "PUT");
    assert.ok(putReport);
    assert.equal(putReport.pathname, "/repositories/acme/widgets/commit/abc123/reports/debtlens");
    assert.equal(putReport.headers.authorization, "Bearer test-token");
    const report = JSON.parse(putReport.body);
    assert.equal(report.title, "DebtLens maintainability report");
    assert.equal(report.report_type, "BUG");
    assert.equal(report.reporter, "DebtLens");
    assert.equal(report.result, "FAILED");
    assert.equal(report.link, "https://bitbucket.example/reports/debtlens");
    assert.ok(report.details.includes("1 high, 0 medium, 2 low, 0 info"));

    const postAnnotations = requests.find((request) => request.method === "POST");
    assert.ok(postAnnotations);
    assert.equal(postAnnotations.pathname, "/repositories/acme/widgets/commit/abc123/reports/debtlens/annotations");
    const annotations = JSON.parse(postAnnotations.body);
    assert.equal(annotations.length, 2);
    assert.equal(annotations[0].annotation_type, "CODE_SMELL");
    assert.equal(annotations[0].severity, "HIGH");
    assert.equal(annotations[0].path, "examples/react/src/High.tsx");
    assert.equal(annotations[0].line, 4);
    assert.match(annotations[0].external_id, /^debtlens-[a-f0-9]{24}$/);
    assert.equal(annotations[1].severity, "LOW");
  });

  it("uses unique external ids for repeated canonical fingerprints", async () => {
    const requests: RequestRecord[] = [];
    const duplicateReport = makeReport();
    duplicateReport.issues = duplicateReport.issues.slice(1).map((issue, index) => ({
      ...issue,
      fingerprint: "shared-fingerprint",
      id: `duplicate-${index}`,
      file: "src/Todo.ts",
      location: { startLine: index === 0 ? 8 : 12 },
    }));
    duplicateReport.summary.totalIssues = duplicateReport.issues.length;
    const result = await withMockBitbucket(requests, async (apiUrl) =>
      runPostCodeInsights(apiUrl, { DEBTLENS_BITBUCKET_ANNOTATIONS_MAX_COUNT: "10" }, duplicateReport), (_request, response) =>
      json(response, { ok: true }));

    assert.equal(result.status, 0, result.stderr);
    const postAnnotations = requests.find((request) => request.method === "POST");
    assert.ok(postAnnotations);
    const annotations = JSON.parse(postAnnotations.body);
    assert.equal(annotations.length, 2);
    assert.notEqual(annotations[0].external_id, annotations[1].external_id);
    assert.match(annotations[0].external_id, /^debtlens-[a-f0-9]{24}$/);
    assert.match(annotations[1].external_id, /^debtlens-[a-f0-9]{24}$/);
  });

  it("supports Basic auth repository variables", async () => {
    const requests: RequestRecord[] = [];
    const result = await withMockBitbucket(requests, async (apiUrl) =>
      runPostCodeInsights(apiUrl, {
        BITBUCKET_STEP_OAUTH_TOKEN: "",
        BITBUCKET_TOKEN: "",
        BB_TOKEN: "",
        DEBTLENS_BITBUCKET_AUTH_HEADER: "",
        BITBUCKET_USERNAME: "bot@example.com",
        BITBUCKET_API_TOKEN: "api-token",
      }), (_request, response) => json(response, { ok: true }));

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests[0]?.headers.authorization, `Basic ${Buffer.from("bot@example.com:api-token", "utf8").toString("base64")}`);
  });

  it("skips quietly when credentials are unavailable", async () => {
    const result = await runPostCodeInsights("http://127.0.0.1:9", {
      BITBUCKET_STEP_OAUTH_TOKEN: "",
      BITBUCKET_TOKEN: "",
      BB_TOKEN: "",
      BITBUCKET_USERNAME: "",
      BITBUCKET_API_TOKEN: "",
      DEBTLENS_BITBUCKET_AUTH_HEADER: "",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skipping Bitbucket Code Insights/);
  });

  it("warns without failing by default when Bitbucket rejects the report", async () => {
    const requests: RequestRecord[] = [];
    const result = await withMockBitbucket(requests, async (apiUrl) => runPostCodeInsights(apiUrl), (_request, response) =>
      json(response, { message: "forbidden" }, 403));

    assert.equal(result.status, 0);
    assert.match(result.stderr, /DebtLens warning: Failed to create Bitbucket report: 403/);
    assert.match(result.stderr, /DEBTLENS_BITBUCKET_FAIL_ON_ERROR=true/);
  });

  it("fails when Bitbucket rejects the report and fail-on-error is enabled", async () => {
    const requests: RequestRecord[] = [];
    const result = await withMockBitbucket(requests, async (apiUrl) =>
      runPostCodeInsights(apiUrl, { DEBTLENS_BITBUCKET_FAIL_ON_ERROR: "true" }), (_request, response) =>
      json(response, { message: "forbidden" }, 403));

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Failed to create Bitbucket report: 403/);
  });

  it("chunks Bitbucket annotations into 100-item requests", async () => {
    const requests: RequestRecord[] = [];
    const result = await withMockBitbucket(requests, async (apiUrl) =>
      runPostCodeInsights(apiUrl, { DEBTLENS_BITBUCKET_ANNOTATIONS_MAX_COUNT: "205" }, makeReportWithIssues(205)), (_request, response) =>
      json(response, { ok: true }));

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /205 annotation\(s\)/);
    const annotationRequests = requests.filter((request) => request.method === "POST");
    assert.equal(annotationRequests.length, 3);
    assert.equal(JSON.parse(annotationRequests[0]!.body).length, 100);
    assert.equal(JSON.parse(annotationRequests[1]!.body).length, 100);
    assert.equal(JSON.parse(annotationRequests[2]!.body).length, 5);
  });
});

async function withMockBitbucket(
  requests: RequestRecord[],
  run: (apiUrl: string) => Promise<ScriptResult>,
  handler: (request: IncomingMessage, response: ServerResponse, body: string) => void,
): Promise<ScriptResult> {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const url = new URL(request.url ?? "", "http://localhost");
      requests.push({
        method: request.method ?? "GET",
        pathname: url.pathname,
        headers: request.headers,
        body,
      });
      handler(request, response, body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function runPostCodeInsights(apiUrl: string, env: NodeJS.ProcessEnv = {}, report = makeReport()): Promise<ScriptResult> {
  const dir = mkdtempSync(join(tmpdir(), "debtlens-bitbucket-"));
  try {
    const reportPath = join(dir, "report.json");
    writeFileSync(reportPath, JSON.stringify(report), "utf8");

    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath, reportPath], {
        cwd: repoRoot,
        env: {
          ...process.env,
          BITBUCKET_STEP_OAUTH_TOKEN: "test-token",
          BITBUCKET_WORKSPACE: "acme",
          BITBUCKET_REPO_SLUG: "widgets",
          BITBUCKET_COMMIT: "abc123",
          BITBUCKET_CLONE_DIR: repoRoot,
          BITBUCKET_API_URL: apiUrl,
          DEBTLENS_BITBUCKET_ANNOTATIONS_MAX_COUNT: "2",
          DEBTLENS_BITBUCKET_REPORT_LINK: "https://bitbucket.example/reports/debtlens",
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("close", (status) => {
        resolve({ status, stdout, stderr });
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeReport() {
  return {
    schemaVersion: 1,
    issues: [{
      id: "high",
      fingerprint: "stable-high",
      ruleId: "prop-drilling",
      ruleName: "Prop drilling",
      severity: "high",
      confidence: 0.9,
      message: "High issue",
      file: "./src/High.tsx",
      location: { startLine: 4 },
      tags: [],
    }, {
      id: "low",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low",
      confidence: 0.8,
      message: "Low issue",
      file: "src/Todo.ts",
      location: { startLine: 8 },
      tags: [],
    }, {
      id: "low-2",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low",
      confidence: 0.7,
      message: "Another low issue",
      file: "src/Todo.ts",
      location: { startLine: 12 },
      tags: [],
    }],
    summary: {
      totalIssues: 3,
      bySeverity: { high: 1, medium: 0, low: 2, info: 0 },
      byRule: { "prop-drilling": 1, "todo-comment": 2 },
      filesScanned: 3,
      rulesRun: 8,
      elapsedMs: 10,
    },
    options: { target: join(repoRoot, "examples", "react"), include: [], exclude: [], minSeverity: "info" },
  };
}

function makeReportWithIssues(count: number) {
  const base = makeReport();
  base.issues = Array.from({ length: count }, (_value, index) => ({
    ...base.issues[index % base.issues.length]!,
    id: `issue-${index}`,
    fingerprint: `stable-${index}`,
    severity: index % 3 === 0 ? "high" : index % 3 === 1 ? "medium" : "low",
    confidence: 1 - (index % 10) / 100,
    file: `src/File${index}.tsx`,
    location: { startLine: index + 1 },
  }));
  base.summary.totalIssues = count;
  base.summary.bySeverity = {
    high: base.issues.filter((issue) => issue.severity === "high").length,
    medium: base.issues.filter((issue) => issue.severity === "medium").length,
    low: base.issues.filter((issue) => issue.severity === "low").length,
    info: 0,
  };
  base.summary.byRule = { "prop-drilling": count, "todo-comment": 0 };
  return base;
}

function json(response: ServerResponse, payload: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}
