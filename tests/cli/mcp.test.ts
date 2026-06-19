import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createBaseline } from "../../src/core/baseline.js";
import type { DebtIssue } from "../../src/core/types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runMcp(input: string) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "mcp"], {
    cwd: repoRoot,
    encoding: "utf8",
    input,
  });
}

function request(id: number, method: string, params?: Record<string, unknown>): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`;
}

function parseResponses(stdout: string): Array<Record<string, any>> {
  return stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function runMcp2025Tool(id: number, name: string, args: Record<string, unknown>) {
  const result = runMcp(
    request(1000 + id, "initialize", { protocolVersion: "2025-06-18" }) +
    request(id, "tools/call", { name, arguments: args }),
  );
  const responses = parseResponses(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(responses[0].result.protocolVersion, "2025-06-18");
  return responses[1];
}

describe("debtlens mcp", () => {
  it("initializes with tools capability metadata", () => {
    const result = runMcp(`${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" })}\n`);
    const response = JSON.parse(result.stdout.trim());

    assert.equal(result.status, 0);
    assert.equal(response.result.protocolVersion, "2024-11-05");
    assert.deepEqual(response.result.capabilities, { tools: {} });
    assert.equal(response.result.serverInfo.name, "debtlens");
  });

  it("negotiates the structured-content MCP protocol when requested", () => {
    const result = runMcp(request(1, "initialize", { protocolVersion: "2025-06-18" }));
    const response = JSON.parse(result.stdout.trim());

    assert.equal(result.status, 0);
    assert.equal(response.result.protocolVersion, "2025-06-18");
    assert.deepEqual(response.result.capabilities, { tools: {} });
    assert.equal(response.result.serverInfo.name, "debtlens");
  });

  it("lists scan, doctor, rules, explain, and workflow tools", () => {
    const result = runMcp(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    const response = JSON.parse(result.stdout.trim());

    assert.equal(result.status, 0);
    assert.deepEqual(response.result.tools.map((tool: { name: string }) => tool.name), [
      "scan",
      "doctor",
      "rules",
      "explain",
      "adopt",
      "compare",
      "suppress",
      "baseline_diff",
      "baseline_prune_preview",
    ]);
    const scanTool = response.result.tools.find((tool: { name: string }) => tool.name === "scan");
    assert.ok(scanTool);
    assert.ok(scanTool.inputSchema.properties.hotspots);
    assert.ok(scanTool.inputSchema.properties.churnDays);
    assert.ok(scanTool.inputSchema.properties.churnRange);
  });

  it("calls the rules tool through the CLI", () => {
    const result = runMcp(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "rules", arguments: { format: "json" } },
    })}\n`);
    const response = JSON.parse(result.stdout.trim());

    assert.equal(result.status, 0);
    assert.equal(response.result.isError, false);
    assert.match(response.result.content[0].text, /large-component/);
  });

  it("runs scan in-process with cwd and package options", () => {
    const result = runMcp(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "scan",
        arguments: {
          cwd: join(repoRoot, "tests", "fixtures", "monorepo"),
          target: ".",
          package: "pkg-a",
          rules: "todo-comment",
          format: "json",
        },
      },
    })}\n`);
    const response = JSON.parse(result.stdout.trim());

    assert.equal(result.status, 0);
    assert.equal(response.result.isError, false);
    const parsed = JSON.parse(response.result.content[0].text);
    assert.equal(parsed.summary.totalIssues, 1);
    assert.match(parsed.issues[0].file, /^src\/index\.ts$/);
  });

  it("passes hotspot scan options through MCP scan calls", () => {
    const root = mkdtempSync(join(tmpdir(), "debtlens-mcp-hotspots-"));
    try {
      execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: root, stdio: "ignore" });
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "app.ts"), "// TODO mcp hotspot\nexport const value = 1;\n");
      execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
      writeFileSync(join(root, "src", "app.ts"), "// TODO mcp hotspot\nexport const value = 2;\n");
      execFileSync("git", ["add", "src/app.ts"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "update app"], { cwd: root, stdio: "ignore" });

      const result = runMcp(request(31, "tools/call", {
        name: "scan",
        arguments: {
          cwd: root,
          target: ".",
          rules: "todo-comment",
          format: "json",
          hotspots: true,
          churnDays: 30,
        },
      }));
      const response = JSON.parse(result.stdout.trim());
      const parsed = JSON.parse(response.result.content[0].text);

      assert.equal(result.status, 0);
      assert.equal(response.result.isError, false);
      assert.equal(parsed.summary.hotspots.source, "git");
      assert.equal(parsed.summary.hotspots.window.days, 30);
      assert.equal(parsed.summary.hotspots.ranking[0].file, "src/app.ts");
      assert.ok(parsed.summary.hotspots.ranking[0].churn.commits >= 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves relative cwd once for scan and doctor calls", () => {
    const scanResult = runMcp(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "scan",
        arguments: {
          cwd: "tests/fixtures/monorepo",
          target: ".",
          package: "pkg-a",
          rules: "todo-comment",
          format: "json",
        },
      },
    })}\n`);
    const scanResponse = JSON.parse(scanResult.stdout.trim());

    assert.equal(scanResult.status, 0);
    assert.equal(scanResponse.result.isError, false);
    const parsed = JSON.parse(scanResponse.result.content[0].text);
    assert.equal(parsed.summary.totalIssues, 1);
    assert.match(parsed.issues[0].file, /^src\/index\.ts$/);

    const doctorResult = runMcp(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "doctor",
        arguments: {
          cwd: "tests/fixtures/monorepo",
          target: ".",
          package: "pkg-a",
        },
      },
    })}\n`);
    const doctorResponse = JSON.parse(doctorResult.stdout.trim());

    assert.equal(doctorResult.status, 0);
    assert.equal(doctorResponse.result.isError, false);
    assert.match(doctorResponse.result.content[0].text, /Package: pkg-a/);
    assert.match(doctorResponse.result.content[0].text, /Matched files: 1/);
  });

  it("ignores write-capable scan arguments from MCP tool calls", () => {
    const root = mkdtempSync(join(tmpdir(), "debtlens-mcp-write-"));
    const output = join(root, "scan.json");
    const baseline = join(root, "baseline.json");

    try {
      const result = runMcp(`${JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "scan",
          arguments: {
            cwd: "tests/fixtures/monorepo",
            target: ".",
            package: "pkg-a",
            rules: "todo-comment",
            format: "json",
            output,
            writeBaseline: baseline,
          },
        },
      })}\n`);
      const response = JSON.parse(result.stdout.trim());

      assert.equal(result.status, 0);
      assert.equal(response.result.isError, false);
      assert.equal(existsSync(output), false);
      assert.equal(existsSync(baseline), false);
      assert.match(response.result.content[0].text, /todo-comment/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("omits structured workflow data for legacy MCP clients", () => {
    const result = runMcp(
      request(700, "initialize") +
      request(701, "tools/call", {
        name: "suppress",
        arguments: {
          rule: "todo-comment",
          reason: "tracked in JIRA-123",
        },
      }),
    );
    const responses = parseResponses(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(responses[0].result.protocolVersion, "2024-11-05");
    assert.equal(responses[1].result.isError, false);
    assert.equal("structuredContent" in responses[1].result, false);
    assert.equal(responses[1].result.content[0].text, "// debtlens-disable-next-line todo-comment -- tracked in JIRA-123");
  });

  it("runs a read-only adoption workflow with structured planning data", () => {
    const root = mkdtempSync(join(tmpdir(), "debtlens-mcp-adopt-"));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "app.ts"), "// TODO: adopt this\nexport const value = 1;\n");

      const response = runMcp2025Tool(7, "adopt", {
        cwd: root,
        target: ".",
        rules: "todo-comment",
        format: "markdown",
      });

      assert.equal(response.result.isError, false);
      assert.match(response.result.content[0].text, /DebtLens Adoption Report/);
      assert.equal(response.result.structuredContent.summary.totalIssues, 1);
      assert.equal(response.result.structuredContent.recommendedMinSeverity, "low");
      assert.equal(response.result.structuredContent.dryRun, true);
      assert.ok(response.result.structuredContent.rolloutPlan.length > 0);
      assert.equal(existsSync(join(root, "debtlens.config.json")), false);
      assert.equal(existsSync(join(root, "debtlens-baseline.json")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("compares two reports with structured deltas", () => {
    const root = mkdtempSync(join(tmpdir(), "debtlens-mcp-compare-"));
    try {
      writeFileSync(join(root, "previous.json"), `${JSON.stringify(scanResult([
        issue({ id: "old", fingerprint: "old", file: "src/old.ts" }),
      ]))}\n`);
      writeFileSync(join(root, "current.json"), `${JSON.stringify(scanResult([
        issue({ id: "new", fingerprint: "new", file: "src/new.ts", severity: "high" }),
      ]))}\n`);

      const response = runMcp2025Tool(8, "compare", {
        cwd: root,
        previous: "previous.json",
        current: "current.json",
        format: "json",
      });

      assert.equal(response.result.isError, false);
      assert.equal(response.result.structuredContent.delta.new, 1);
      assert.equal(response.result.structuredContent.delta.resolved, 1);
      assert.equal(response.result.structuredContent.topNewFiles[0].file, "src/new.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("generates suppression directives with structured metadata", () => {
    const response = runMcp2025Tool(9, "suppress", {
      rule: "TODO-Comment",
      reason: "tracked in JIRA-123",
      file: true,
    });

    assert.equal(response.result.isError, false);
    assert.equal(response.result.content[0].text, "// debtlens-disable-file todo-comment -- tracked in JIRA-123");
    assert.deepEqual(response.result.structuredContent, {
      directive: "// debtlens-disable-file todo-comment -- tracked in JIRA-123",
      kind: "file",
      ruleId: "todo-comment",
      reason: "tracked in JIRA-123",
    });
  });

  it("previews baseline drift and prune without writing the baseline file", () => {
    const root = mkdtempSync(join(tmpdir(), "debtlens-mcp-baseline-"));
    try {
      mkdirSync(join(root, "src"));
      const baselinePath = join(root, "debtlens-baseline.json");
      const cachePath = join(root, ".debtlens-cache.json");
      writeFileSync(baselinePath, `${JSON.stringify(createBaseline([
        issue({ id: "old", file: "src/app.ts" }) as DebtIssue,
      ]), null, 2)}\n`);
      const before = readFileSync(baselinePath, "utf8");
      writeFileSync(join(root, "src", "app.ts"), "export const value = 1;\n");

      const result = runMcp(`${JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "baseline_diff",
          arguments: {
            cwd: root,
            target: ".",
            baseline: "debtlens-baseline.json",
            rules: "todo-comment",
          },
        },
      })}\n`);
      const response = JSON.parse(result.stdout.trim());

      assert.equal(result.status, 0);
      assert.equal(response.result.isError, false);
      assert.equal("structuredContent" in response.result, false);
      const diffReport = JSON.parse(response.result.content[0].text);
      assert.equal(diffReport.delta.resolved, 1);
      assert.equal(diffReport.wroteBaseline, false);
      assert.equal(readFileSync(baselinePath, "utf8"), before);

      const structuredResponse = runMcp2025Tool(1010, "baseline_diff", {
        cwd: root,
        target: ".",
        baseline: "debtlens-baseline.json",
        rules: "todo-comment",
        cache: cachePath,
      });

      assert.equal(structuredResponse.result.isError, false);
      assert.equal(existsSync(cachePath), false);
      assert.equal(structuredResponse.result.structuredContent.delta.resolved, 1);
      assert.equal(structuredResponse.result.structuredContent.wroteBaseline, false);
      assert.equal(readFileSync(baselinePath, "utf8"), before);

      const pruneResponse = runMcp2025Tool(11, "baseline_prune_preview", {
        cwd: root,
        target: ".",
        baseline: "debtlens-baseline.json",
        rules: "todo-comment",
        cache: cachePath,
      });

      assert.equal(pruneResponse.result.isError, false);
      assert.equal(existsSync(cachePath), false);
      assert.equal(pruneResponse.result.structuredContent.delta.resolved, 1);
      assert.equal(pruneResponse.result.structuredContent.wroteBaseline, false);
      assert.equal(readFileSync(baselinePath, "utf8"), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function scanResult(issues: Array<Record<string, unknown>>) {
  const bySeverity = { info: 0, low: 0, medium: 0, high: 0 };
  const byRule: Record<string, number> = {};
  for (const finding of issues) {
    bySeverity[finding.severity as keyof typeof bySeverity] += 1;
    byRule[String(finding.ruleId)] = (byRule[String(finding.ruleId)] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    issues,
    summary: {
      totalIssues: issues.length,
      bySeverity,
      byRule,
      filesScanned: 1,
      rulesRun: 1,
      elapsedMs: 1,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "info" },
  };
}

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue",
    fingerprint: "issue",
    ruleId: "todo-comment",
    ruleName: "Todo comment",
    severity: "low",
    confidence: 0.8,
    message: "Comment contains a todo marker.",
    file: "src/app.ts",
    location: { startLine: 1 },
    tags: [],
    ...overrides,
  };
}
