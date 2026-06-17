import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

function runBenchmark(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["scripts/benchmark.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("benchmark script", () => {
  it("passes the small fixture within a configurable CI budget", () => {
    const result = runBenchmark(["--small-only"], {
      DEBTLENS_BENCHMARK_BUDGETS: "small=5000",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /small: \d+ms \(5 files\) budget < 5000ms OK/);
  });

  it("fails when a fixture exceeds the configured budget", () => {
    const result = runBenchmark(["--small-only", "--budget", "small=1"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /small: \d+ms \(5 files\) budget < 1ms FAIL/);
  });

  it("rejects malformed budget overrides", () => {
    const result = runBenchmark(["--small-only", "--budget", "missing"], {
      DEBTLENS_BENCHMARK_BUDGETS: "small=5000",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLI budget override must use fixture=ms/);
  });
});
