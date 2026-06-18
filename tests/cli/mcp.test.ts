import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runMcp(input: string) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "mcp"], {
    cwd: repoRoot,
    encoding: "utf8",
    input,
  });
}

describe("debtlens mcp", () => {
  it("lists scan, doctor, rules, and explain tools", () => {
    const result = runMcp(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    const response = JSON.parse(result.stdout.trim());

    assert.equal(result.status, 0);
    assert.deepEqual(response.result.tools.map((tool: { name: string }) => tool.name), [
      "scan",
      "doctor",
      "rules",
      "explain",
    ]);
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
});
