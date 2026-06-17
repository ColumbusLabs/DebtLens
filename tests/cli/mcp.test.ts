import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

  it("passes cwd through to scan subprocesses", () => {
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
});
