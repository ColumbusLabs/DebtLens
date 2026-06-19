import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { buildScanArgv } from "../../src/cli/argv.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

describe("debtlens watch", () => {
  it("builds a scan command from watch options", () => {
    const args = buildScanArgv("examples/react", {
      cwd: repoRoot,
      rules: "todo-comment",
      format: "json",
      gate: "new-code",
      quiet: true,
      blameAge: true,
      auditSuppressions: true,
      debounce: 10,
    });

    assert.deepEqual(args, [
      "scan",
      "examples/react",
      "--rules",
      "todo-comment",
      "--format",
      "json",
      "--gate",
      "new-code",
      "--cwd",
      repoRoot,
      "--quiet",
      "--audit-suppressions",
      "--blame-age",
    ]);
  });

  it("runs an initial scan and exits cleanly on SIGINT", async () => {
    const child = spawn(process.execPath, [
      "--import",
      "tsx",
      cliEntrypoint,
      "watch",
      "examples/react",
      "--rules",
      "todo-comment",
      "--format",
      "json",
      "--debounce",
      "100",
    ], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("DebtLens watch: watching")) {
        child.kill("SIGINT");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => child.kill("SIGTERM"), 10000);
    const close = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timeout);

    assert.ok(close.code === 0 || close.signal === "SIGINT", stderr);
    assert.match(stdout, /DebtLens watch: watching/);
  });
});
